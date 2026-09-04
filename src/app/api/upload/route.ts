import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { readBoundedBytes } from '@/lib/payload'
import { uploadsDir } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

/** Only formats the label camera flow actually produces. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_BYTES = 8 * 1024 * 1024
/** Cap for the ENTIRE multipart envelope (file + boundaries + any extra fields). */
const MAX_ENVELOPE_BYTES = 9 * 1024 * 1024

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) {
    return NextResponse.json({ error: 'Sign in to upload photos.' }, { status: 401 })
  }

  // Storage/IO flood bound: 30 uploads per minute per user.
  const limited = enforceRateLimit(req, 'upload', 30, 60_000, me.id)
  if (limited) return limited

  // Bound the multipart body BEFORE formData() materializes files: an
  // unbounded form parse would buffer the whole envelope regardless of the
  // per-file cap. Content-Length is a hint; the streaming cap applies even
  // when it is absent or understated (413 on overflow per 30B).
  const envelope = await readBoundedBytes(req, MAX_ENVELOPE_BYTES)
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.startsWith('multipart/form-data')) {
    return NextResponse.json({ error: 'No file was sent.' }, { status: 400 })
  }
  // Parse the bounded buffer as multipart. The platform parser handles the
  // boundary details; the body here is already size-capped.
  const bounded = new Request('http://internal/upload', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: envelope as unknown as BodyInit,
  })
  const form = await bounded.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was sent.' }, { status: 400 })
  }

  const ext = MIME_EXT[file.type]
  if (!ext) {
    return NextResponse.json({ error: 'Only JPEG, PNG or WebP images are supported.' }, { status: 400 })
  }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.byteLength > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large (max 8 MB).' }, { status: 400 })
  }

  // Generated name only — never trust the client-supplied filename.
  const name = `${Date.now().toString(36)}-${randomUUID()}.${ext}`
  const dir = uploadsDir()
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, name), bytes)

  return NextResponse.json({ url: `/uploads/${name}` })
}
