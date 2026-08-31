import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { StatsDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [products, revisionsByUser, pendingCount, approvedCount, recent] = await Promise.all([
    db.product.count(),
    db.productRevision.groupBy({ by: ['submittedById'], where: { status: { not: 'rejected' } } }),
    db.productRevision.count({ where: { status: 'pending' } }),
    db.productRevision.count({ where: { status: { in: ['approved', 'auto_approved'] } } }),
    db.productRevision.findMany({
      where: { status: { in: ['approved', 'auto_approved'] } },
      orderBy: { finalizedAt: 'desc' },
      take: 8,
      include: { product: { select: { name: true, barcode: true } }, submittedBy: { select: { id: true, name: true } } },
    }),
  ])

  const dto: StatsDTO = {
    products,
    contributors: revisionsByUser.length,
    pendingCount,
    approvedCount,
    recent: recent.map((r) => ({
      id: r.id,
      productName: r.product.name,
      barcode: r.product.barcode,
      version: r.version,
      status: r.status as 'approved' | 'auto_approved',
      userName: r.submittedBy.name,
      userId: r.submittedBy.id,
      createdAt: (r.finalizedAt ?? r.createdAt).toISOString(),
    })),
  }
  return NextResponse.json(dto)
}
