import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
])

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to upload photos.' }, { status: 401 })

  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
    }
    const ext = ALLOWED.get(file.type)
    if (!ext) return NextResponse.json({ error: 'Only JPEG, PNG or WebP images are allowed.' }, { status: 400 })
    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image is too large (max 8 MB).' }, { status: 400 })
    }

    const dir = path.join(process.cwd(), 'public', 'uploads')
    await mkdir(dir, { recursive: true })
    const name = `${randomUUID()}.${ext}`
    await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()))
    return NextResponse.json({ url: `/uploads/${name}` })
  } catch (err) {
    console.error('upload error', err)
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 500 })
  }
}
