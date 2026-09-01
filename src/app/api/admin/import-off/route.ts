import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { importOffPages } from '@/lib/off-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/import-off — moderator-triggered Open Food Facts bootstrap.
 * Body: { "startPage": 1, "pages": 2, "withImages": true }
 * L3 (moderator) only: import volume and image storage are not something
 * anonymous or low-trust callers should be able to drive.
 */
export async function POST(req: NextRequest) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ error: 'Sign in to run the import.' }, { status: 401 })
  if (me.trustLevel < 3) return NextResponse.json({ error: 'Moderator (L3) access required.' }, { status: 403 })

  const limited = enforceRateLimit(req, 'import-off', 4, 60_000, me.id)
  if (limited) return limited

  try {
    const body = (await req.json().catch(() => ({}))) as { startPage?: number; pages?: number; withImages?: boolean }
    const summary = await importOffPages({
      startPage: body.startPage,
      pages: body.pages,
      withImages: body.withImages,
    })
    return NextResponse.json(summary)
  } catch (err) {
    console.error('import-off error', err)
    const detail = err instanceof Error ? err.message.slice(0, 300) : String(err)
    return NextResponse.json({ error: `Import failed: ${detail}. Safe to re-run — existing barcodes are skipped.` }, { status: 502 })
  }
}
