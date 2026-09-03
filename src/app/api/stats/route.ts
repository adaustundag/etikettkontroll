import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { withDiffs } from '@/lib/revision-diff'
import { BOT_EMAIL } from '@/lib/off-import'
import type { StatsDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const DEMO_DOMAIN = '@etikettkontroll.se'
// Humans only: OFF bot and demo identities never count as contributors.
const humanWhere = {
  submittedBy: { email: { not: { endsWith: DEMO_DOMAIN }, notIn: [BOT_EMAIL] } },
}

export async function GET() {
  const [
    products,
    verifiedRevisions,
    pendingCount,
    contributors,
    verifiedCount,
    additions,
    corrections,
    recent,
  ] = await Promise.all([
    // Catalog = products with a published, non-quarantined record.
    db.product.count({ where: { currentRevisionId: { not: null }, quarantined: false } }),
    db.productRevision.findMany({
      where: { status: { in: ['approved', 'auto_approved'] }, verifiedAt: { not: null }, ...humanWhere },
      select: { submittedById: true },
    }),
    db.productRevision.count({ where: { status: 'pending' } }),
    db.productRevision.findMany({
      // historical: any verified publication per distinct human contributor
      where: { verifiedAt: { not: null }, ...humanWhere },
      select: { submittedById: true },
      distinct: ['submittedById'],
    }),
    db.productRevision.count({ where: { verifiedAt: { not: null }, ...humanWhere } }),
    db.productRevision.count({ where: { verifiedAt: { not: null }, version: 1, ...humanWhere } }),
    db.productRevision.count({ where: { verifiedAt: { not: null }, version: { gt: 1 }, ...humanWhere } }),
    db.productRevision.findMany({
      // Recent VERIFIED publications only — imports are never "reviewed changes".
      where: {
        status: { in: ['approved', 'auto_approved', 'superseded'] },
        verifiedAt: { not: null },
        product: { quarantined: false },
        ...humanWhere,
      },
      orderBy: { finalizedAt: 'desc' },
      take: 8,
      include: {
        product: { select: { name: true, barcode: true, quarantined: true } },
        submittedBy: { select: { id: true, name: true } },
      },
    }),
  ])

  const withPrev = await withDiffs(recent)

  const dto: StatsDTO = {
    products,
    contributors: contributors.length,
    pendingCount,
    approvedCount: verifiedCount,
    verifiedCount,
    catalogAdditions: additions,
    corrections,
    recent: withPrev.map(({ diff, ...r }) => ({
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
  }
  return NextResponse.json(dto)
}
