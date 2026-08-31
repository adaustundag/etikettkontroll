import { existsSync } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/** Only formats the label camera flow actually produces. */
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const MAX_BYTES = 8 * 1024 * 1024

/**
 * Resolve the uploads directory for the current runtime:
 * - dev / preview:  <cwd>/public/uploads (Next serves public/ from the project root)
 * - standalone prod: .next/standalone/public/uploads (build script copies public there)
 */
function uploadsDir(): string {
  const cwd = process.cwd()
  const root = path.join(cwd, 'public', 'uploads')
  if (existsSync(root)) return root
  const standalone = path.join(cwd, '.next', 'standalone', 'public', 'uploads')
  if (existsSync(standalone)) return standalone
  return root
}

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
