// Shared server-side helpers for the public change feed (home, /api/stats,
// /api/changes). Pure DB-shape logic — no React, no request scope.

import { db } from '@/lib/db'
import { formatValue } from '@/lib/label'
import { NUMERIC_FIELDS, type ChangeChip, type LabelField } from '@/lib/types'

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
export function summarizeChanges(
  rev: { version: number; changedFields: string } & Record<string, unknown>,
  prev: Record<string, unknown> | null,
): ChangeChip[] {
  if (!prev || rev.version === 1) return []
  let fields: string[] = []
  try {
    fields = JSON.parse(rev.changedFields) as string[]
  } catch {
    fields = []
  }
  const out: ChangeChip[] = []
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

type RevisionLike = {
  productId: string
  version: number
  changedFields: string
  status: string
  finalizedAt: Date | null
  createdAt: Date
  product: { name: string; barcode: string }
  submittedBy: { id: string; name: string }
}

/**
 * Attach previous-snapshot diffs to a batch of published revisions (one small
 * findFirst per revision with version > 1). Keeps N+1 cost bounded by page size.
 */
export async function withDiffs<T extends RevisionLike>(revisions: T[]): Promise<(T & { diff: ChangeChip[] })[]> {
  return Promise.all(
    revisions.map(async (r) => {
      const prev =
        r.version > 1
          ? await db.productRevision.findFirst({
              where: {
                productId: r.productId,
                version: { lt: r.version },
                status: { in: ['approved', 'auto_approved', 'superseded'] },
              },
              orderBy: { version: 'desc' },
            })
          : null
      return { ...r, diff: summarizeChanges(r, prev as Record<string, unknown> | null) }
    }),
  )
}

