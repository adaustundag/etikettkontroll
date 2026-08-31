import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { computeTrust } from '@/lib/trust'
import { mapRevision, revisionInclude } from '@/lib/revisions'
import type { ProfileDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const user = await db.user.findUnique({ where: { id } })
  if (!user) return NextResponse.json({ error: 'User not found.' }, { status: 404 })

  const trust = await computeTrust(user.id)
  const [contributions, reviewsCast] = await Promise.all([
    db.productRevision.findMany({
      where: { submittedById: user.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: {
        product: { select: { barcode: true } },
        ...revisionInclude,
      },
    }),
    db.review.count({ where: { reviewerId: user.id } }),
  ])

  const dto: ProfileDTO = {
    user: {
      id: user.id,
      name: user.name,
      karma: user.karma,
      trustLevel: trust.level,
      trustLabel: trust.label,
    },
    email: user.email,
    createdAt: user.createdAt.toISOString(),
    reviewsCast,
    contributions: contributions.map(mapRevision),
  }
  return NextResponse.json(dto)
}
