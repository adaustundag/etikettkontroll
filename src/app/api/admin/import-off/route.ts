import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { assertOptionalBoolean, assertOptionalInt, payloadErrorResponse, readBoundedJsonObject } from '@/lib/payload'
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
  // Authority = explicitly appointed role, never earned reputation.
  if (me.role !== 'moderator' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Moderator authority required (operator-appointed role).' }, { status: 403 })
  }

  const limited = enforceRateLimit(req, 'import-off', 4, 60_000, me.id)
  if (limited) return limited

  try {
    const body = await readBoundedJsonObject(req, 8 * 1024)
    const summary = await importOffPages({
      startPage: assertOptionalInt(body.startPage, 'startPage', 1, 1000),
      pages: assertOptionalInt(body.pages, 'pages', 1, 5),
      withImages: assertOptionalBoolean(body.withImages, 'withImages'),
    })
    return NextResponse.json(summary)
  } catch (err) {
    const mapped = payloadErrorResponse(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('import-off error', err)
    const detail = err instanceof Error ? err.message.slice(0, 300) : String(err)
    return NextResponse.json({ error: `Import failed: ${detail}. Safe to re-run — existing barcodes are skipped.` }, { status: 502 })
  }
}
