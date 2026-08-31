import { readFile } from 'fs/promises'
import path from 'path'
import { NextRequest, NextResponse } from 'next/server'
import { contentTypeFor, uploadsDir } from '@/lib/uploads'

export const dynamic = 'force-dynamic'

/**
 * Serves uploaded photos from the uploads directory (volume in production).
 * In dev, files under public/uploads are served natively first — this route
 * handles the rest, which is the case that matters on a persistent volume.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params

  // Generated names only: <token>-<uuid>.<ext>. basename + regex kill traversal.
  const name = path.basename(file)
  if (name !== file || !/^[a-z0-9-]+\.(png|jpe?g|webp)$/i.test(name)) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  try {
    const buf = await readFile(path.join(uploadsDir(), name))
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': contentTypeFor(name),
        // Generated names are immutable — safe to cache forever.
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
}
