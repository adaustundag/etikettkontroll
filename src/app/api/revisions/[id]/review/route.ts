import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { computeTrust, rejectsNeededFor } from '@/lib/trust'
import { publishRevision } from '@/lib/revisions'
import { enforceRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

type ReviewResult = {
  finalized: boolean
  status: 'pending' | 'approved' | 'rejected'
  approvedCount: number
  rejectedCount: number
  reviewerKarma: number
}

/** Abort the transaction with an error that maps to an HTTP status. */
class ReviewAbort extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ error: 'Sign in to review.' }, { status: 401 })

  const limited = enforceRateLimit(req, 'review', 30, 60_000, me.id)
  if (limited) return limited

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { verdict?: string; comment?: string }
  const verdict = body.verdict
  if (verdict !== 'approve' && verdict !== 'reject') {
    return NextResponse.json({ error: 'Verdict must be approve or reject.' }, { status: 400 })
  }
  const comment = (body.comment || '').trim() || null
  if (comment && comment.length > 500) {
    return NextResponse.json({ error: 'Comment is too long (max 500 characters).' }, { status: 400 })
  }

  const trust = await computeTrust(me.id)
  // Reviewing is earned (Trusted) — or explicitly appointed via role.
  const canReview = trust.level >= 2 || me.role === 'moderator' || me.role === 'admin'
  if (!canReview) {
    return NextResponse.json(
      { error: 'Reviewing unlocks at Trusted level (100 karma, 10+ approved edits).' },
      { status: 403 },
    )
  }

  // Everything below happens inside one transaction: the revision — including
  // its approvedCount/rejectedCount and the "already reviewed" check — is read
  // in the same tx that writes, so two concurrent approvals can no longer both
  // pass the pending check (lost update → skipped publish, double karma).
  const result = await db
    .$transaction(async (tx): Promise<ReviewResult> => {
      const revision = await tx.productRevision.findUnique({
        where: { id },
        include: {
          submittedBy: { select: { id: true, name: true, karma: true, trustLevel: true } },
          reviews: { select: { reviewerId: true } },
        },
      })
      if (!revision) throw new ReviewAbort(404, 'Revision not found.')
      if (revision.status !== 'pending') {
        throw new ReviewAbort(409, 'This revision was already finalized.')
      }
      if (revision.submittedById === me.id) {
        throw new ReviewAbort(403, 'You cannot review your own submission.')
      }
      if (revision.reviews.some((r) => r.reviewerId === me.id)) {
        throw new ReviewAbort(409, 'You have already reviewed this revision.')
      }

      try {
        await tx.review.create({
          data: { revisionId: revision.id, reviewerId: me.id, verdict, comment },
        })
      } catch (err) {
        // DB-level unique(revisionId, reviewerId) backstop for concurrent votes.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ReviewAbort(409, 'You have already reviewed this revision.')
        }
        throw err
      }

      // Reviewers earn +1 karma per cast vote.
      await tx.user.update({ where: { id: me.id }, data: { karma: { increment: 1 } } })
      await tx.karmaEvent.create({
        data: { userId: me.id, delta: 1, reason: 'review_cast', refId: revision.id },
      })
      const reviewerKarma = me.karma + 1

      if (verdict === 'approve') {
        // Conditional bump: only lands while the revision is still pending.
        const bumped = await tx.productRevision.updateMany({
          where: { id: revision.id, status: 'pending' },
          data: { approvedCount: { increment: 1 } },
        })
        if (bumped.count === 0) throw new ReviewAbort(409, 'This revision was already finalized.')

        const approvedCount = revision.approvedCount + 1
        // A Moderator's approval merges any pending revision (Gerrit-style +2).
        const shouldPublish = trust.level === 3 || approvedCount >= revision.requiredApprovals
        if (shouldPublish) {
          await publishRevision(tx, revision.id)
          await tx.user.update({
            where: { id: revision.submittedById },
            data: { karma: { increment: 2 } },
          })
          await tx.karmaEvent.create({
            data: { userId: revision.submittedById, delta: 2, reason: 'revision_approved', refId: revision.id },
          })
          return {
            finalized: true,
            status: 'approved',
            approvedCount,
            rejectedCount: revision.rejectedCount,
            reviewerKarma,
          }
        }
        return {
          finalized: false,
          status: 'pending',
          approvedCount,
          rejectedCount: revision.rejectedCount,
          reviewerKarma,
        }
      }

      // reject
      const bumped = await tx.productRevision.updateMany({
        where: { id: revision.id, status: 'pending' },
        data: { rejectedCount: { increment: 1 } },
      })
      if (bumped.count === 0) throw new ReviewAbort(409, 'This revision was already finalized.')
      const rejectedCount = revision.rejectedCount + 1

      if (rejectedCount >= rejectsNeededFor(trust.level)) {
        const finalized = await tx.productRevision.updateMany({
          where: { id: revision.id, status: 'pending' },
          data: { status: 'rejected', finalizedAt: new Date() },
        })
        if (finalized.count > 0) {
          // submitter loses 1 karma, floored at 0
          const submitter = await tx.user.findUnique({ where: { id: revision.submittedById } })
          if (submitter && submitter.karma > 0) {
            await tx.user.update({
              where: { id: submitter.id },
              data: { karma: { decrement: 1 } },
            })
            await tx.karmaEvent.create({
              data: { userId: submitter.id, delta: -1, reason: 'revision_rejected', refId: revision.id },
            })
          }
        }
        return {
          finalized: true,
          status: 'rejected',
          approvedCount: revision.approvedCount,
          rejectedCount,
          reviewerKarma,
        }
      }
      return {
        finalized: false,
        status: 'pending',
        approvedCount: revision.approvedCount,
        rejectedCount,
        reviewerKarma,
      }
    })
    .catch((err: unknown) => {
      if (err instanceof ReviewAbort) {
        return { __http: err.status, error: err.message } as const
      }
      throw err
    })

  if ('__http' in result) {
    return NextResponse.json({ error: result.error }, { status: result.__http })
  }
  return NextResponse.json(result)
}
