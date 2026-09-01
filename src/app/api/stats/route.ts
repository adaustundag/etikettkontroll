import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { formatValue } from '@/lib/label'
import { NUMERIC_FIELDS, type LabelField, type StatsDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

const IMAGE_FIELDS = new Set(['frontImage', 'ingredientsImage', 'nutritionImage'])

function unitFor(field: string): string {
  if (field === 'calories') return ' kcal'
  if (NUMERIC_FIELDS.includes(field as LabelField)) return ' g'
  return ''
}

/**
 * Field-level value summary for the public change feed: compare a published
 * revision against the previous approved/superseded snapshot. Image fields are
 * omitted (values are opaque URLs); text values are truncated for chip display.
 */
function summarizeChanges(
  rev: { version: number; changedFields: string } & Record<string, unknown>,
  prev: Record<string, unknown> | null,
): StatsDTO['recent'][number]['changes'] {
  if (!prev || rev.version === 1) return []
  let fields: string[] = []
  try {
    fields = JSON.parse(rev.changedFields) as string[]
  } catch {
    fields = []
  }
  const out: StatsDTO['recent'][number]['changes'] = []
  for (const f of fields) {
    if (IMAGE_FIELDS.has(f)) continue
    const key = f as LabelField
    const rawFrom = prev[f]
    const rawTo = rev[f]
    if (rawFrom === undefined && rawTo === undefined) continue
    const numeric = NUMERIC_FIELDS.includes(key)
    const fmt = (v: unknown): string => {
      const s = formatValue(key, v == null ? null : (v as string | number))
      if (s === '—') return s
      if (numeric) return `${s}${unitFor(f)}`
      return s.length > 36 ? `${s.slice(0, 36)}…` : s
    }
    const from = fmt(rawFrom)
    const to = fmt(rawTo)
    if (from === to) continue
    out.push({ field: f, from: from === '—' ? null : from, to: to === '—' ? null : to })
  }
  return out
}

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

  // Previous snapshots for value diffs — one small query per published change.
  const withPrev = await Promise.all(
    recent.map(async (r) => ({
      r,
      prev:
        r.version > 1
          ? await db.productRevision.findFirst({
              where: {
                productId: r.productId,
                version: { lt: r.version },
                status: { in: ['approved', 'auto_approved', 'superseded'] },
              },
              orderBy: { version: 'desc' },
            })
          : null,
    })),
  )

  const dto: StatsDTO = {
    products,
    contributors: revisionsByUser.length,
    pendingCount,
    approvedCount,
    recent: withPrev.map(({ r, prev }) => ({
      id: r.id,
      productName: r.product.name,
      barcode: r.product.barcode,
      version: r.version,
      status: r.status as 'approved' | 'auto_approved',
      userName: r.submittedBy.name,
      userId: r.submittedBy.id,
      createdAt: (r.finalizedAt ?? r.createdAt).toISOString(),
      changes: summarizeChanges(r, prev as Record<string, unknown> | null),
    })),
  }
  return NextResponse.json(dto)
}
