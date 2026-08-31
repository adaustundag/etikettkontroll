import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { mapRevision, revisionInclude, revisionValues } from '@/lib/revisions'
import type { LabelValues, RevisionDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/queue — pending revisions awaiting review
export async function GET() {
  const pending = await db.productRevision.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: {
      // product (barcode) comes from revisionInclude
      ...revisionInclude,
    },
  })

  // Batch-load current approved values per product for the side-by-side diff.
  const productIds = [...new Set(pending.map((r) => r.productId))]
  const approved = productIds.length
    ? await db.productRevision.findMany({
        where: { productId: { in: productIds }, status: { in: ['approved', 'auto_approved'] } },
        orderBy: { version: 'desc' },
      })
    : []
  const currentByProduct = new Map<string, LabelValues>()
  for (const r of approved) {
    if (!currentByProduct.has(r.productId)) currentByProduct.set(r.productId, revisionValues(r))
  }

  const items: RevisionDTO[] = pending.map((r) => ({
    ...mapRevision(r),
    current: currentByProduct.get(r.productId) ?? null,
  }))

  return NextResponse.json(items)
}
