import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDiffs } from '@/lib/revision-diff'
import { BOT_EMAIL } from '@/lib/off-import'
import type { ChangesDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const MAX_PAGE = 500
const DEMO_DOMAIN = '@etikettkontroll.se'

/**
 * GET /api/changes?page=N — public, paginated stream of VERIFIED publications
 * with field-level value diffs. Append-only: superseded revisions keep their
 * events, so history survives when newer publications become current.
 * Imports and demo/bot activity never appear here.
 */
export async function GET(req: NextRequest) {
  const raw = Number.parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE) : 1

  const rows = await db.productRevision.findMany({
    where: {
      status: { in: ['approved', 'auto_approved', 'superseded'] },
      verifiedAt: { not: null },
      product: { quarantined: false },
      submittedBy: { email: { not: { endsWith: DEMO_DOMAIN }, notIn: [BOT_EMAIL] } },
    },
    orderBy: { finalizedAt: 'desc' },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1, // one extra row to detect the next page
    include: { product: { select: { name: true, barcode: true } }, submittedBy: { select: { id: true, name: true } } },
  })

  const hasMore = rows.length > PAGE_SIZE
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const withPrev = await withDiffs(pageRows)

  const dto: ChangesDTO = {
    items: withPrev.map(({ diff, ...r }) => ({
      id: r.id,
      productName: r.product.name,
      barcode: r.product.barcode,
      version: r.version,
      status: 'approved' as const,
      verified: true,
      userName: r.submittedBy.name,
      userId: r.submittedBy.id,
      createdAt: (r.finalizedAt ?? r.createdAt).toISOString(),
      changes: diff,
    })),
    page,
    hasMore,
  }
  return NextResponse.json(dto)
}
