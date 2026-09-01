import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDiffs } from '@/lib/revision-diff'
import type { ChangesDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const MAX_PAGE = 500

/**
 * GET /api/changes?page=N — public, paginated stream of published revisions
 * with field-level value diffs. Powers the /andringar change-feed page.
 */
export async function GET(req: NextRequest) {
  const raw = Number.parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10)
  const page = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), MAX_PAGE) : 1

  const rows = await db.productRevision.findMany({
    where: { status: { in: ['approved', 'auto_approved'] } },
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
      status: r.status as 'approved' | 'auto_approved',
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
