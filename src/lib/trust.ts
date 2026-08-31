import { db } from '@/lib/db'

/**
 * Option B — karma-gated trust levels.
 *
 *  L0 Newcomer    : submissions need 2 approvals
 *  L1 Contributor : submissions need 1 approval (auto-publish if 1 field changed)
 *  L2 Trusted     : everything auto-publishes + may review others
 *  L3 Moderator   : like L2, but a single reject finalizes and a single
 *                   approval suffices for any pending revision
 */
export type TrustLevel = 0 | 1 | 2 | 3

export const LEVEL_LABELS: Record<TrustLevel, string> = {
  0: 'Newcomer',
  1: 'Contributor',
  2: 'Trusted',
  3: 'Moderator',
}

/** Statuses that represent live, published data. */
export const PUBLISHED_STATUSES = ['approved', 'auto_approved'] as const

export const KARMA = {
  REVISION_APPROVED: 2,
  REVISION_REJECTED: -1,
  REVIEW_CAST: 1,
} as const

export const TRUST_THRESHOLDS = {
  contributor: 30, // karma for L1
  trusted: 100, // karma for L2
  moderator: 250, // karma for L3
} as const

export type TrustInfo = {
  level: TrustLevel
  label: string
  karma: number
  approvedCount: number
  totalCount: number
  approvalRate: number
}

export async function computeTrust(userId: string): Promise<TrustInfo> {
  const [user, finalized] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { karma: true } }),
    // 'superseded' revisions were approved once — they still count as a
    // positive contribution (otherwise trust would decay as history grows).
    db.productRevision.findMany({
      where: { submittedById: userId, status: { in: ['approved', 'auto_approved', 'rejected', 'superseded'] } },
      select: { status: true },
    }),
  ])
  const totalCount = finalized.length
  const approvedCount = finalized.filter((r) => r.status !== 'rejected').length
  const approvalRate = totalCount === 0 ? 1 : approvedCount / totalCount
  const karma = user?.karma ?? 0

  let level: TrustLevel = 0
  if (karma >= TRUST_THRESHOLDS.contributor) level = 1
  if (karma >= TRUST_THRESHOLDS.trusted && approvalRate >= 0.85 && totalCount >= 3) level = 2
  if (karma >= TRUST_THRESHOLDS.moderator && approvalRate >= 0.9 && totalCount >= 5) level = 3

  // Write-back cache so list views can show trust badges without recomputing.
  if (user && user.karma !== undefined) {
    await db.user.updateMany({
      where: { id: userId, trustLevel: { not: level } },
      data: { trustLevel: level },
    })
  }

  return { level, label: LEVEL_LABELS[level], karma, approvedCount, totalCount, approvalRate }
}

export function requiredApprovalsFor(level: TrustLevel): number {
  if (level === 0) return 2
  return 1
}

export function rejectsNeededFor(level: TrustLevel): number {
  // A moderator's reject finalizes immediately; otherwise 2 reject votes.
  if (level === 3) return 1
  return 2
}
