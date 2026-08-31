import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { uploadsDir } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

/** Only formats the label camera flow actually produces. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) {
    return NextResponse.json({ error: 'Sign in to upload photos.' }, { status: 401 })
  }

  const form = await req.formData().catch(() => null)
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
