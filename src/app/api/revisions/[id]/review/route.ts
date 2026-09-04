import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { computeTrust, rejectsNeededFor } from '@/lib/trust'
import { evidenceCoverage, finalizePublication } from '@/lib/revisions'
import { enforceRateLimit } from '@/lib/rate-limit'
import { assertOptionalStringField, payloadErrorResponse, readBoundedJsonObject } from '@/lib/payload'
import { cleanMultiline } from '@/lib/sanitize'
import type { LabelField } from '@/lib/types'

export const dynamic = 'force-dynamic'

type ReviewResult = {
  finalized: boolean
  status: 'pending' | 'disputed' | 'approved' | 'rejected'
  approvedCount: number
  rejectedCount: number
  reviewerKarma: number
  verificationState?: string
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

const NUTRITION_CLAIM_FIELDS: LabelField[] = ['servingSize', 'calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ error: 'Sign in to review.' }, { status: 401 })

  const limited = enforceRateLimit(req, 'review', 30, 60_000, me.id)
  if (limited) return limited

  const { id } = await params
  let verdict: string | undefined
  let comment: string | null
  try {
    const body = await readBoundedJsonObject(req, 8 * 1024)
    verdict = assertOptionalStringField(body.verdict, 'verdict')
    comment = cleanMultiline(assertOptionalStringField(body.comment, 'comment') ?? '') || null
  } catch (err) {
    const mapped = payloadErrorResponse(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    throw err
  }
  if (verdict !== 'approve' && verdict !== 'reject') {
    return NextResponse.json({ error: 'Verdict must be approve or reject.' }, { status: 400 })
  }
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
  // its counts, dispute state and the "already reviewed" check — is read in
  // the same tx that writes, so concurrent votes cannot race the finalize.
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
      if (revision.disputeStatus === 'disputed') {
        throw new ReviewAbort(409, 'This revision is disputed and blocked until a moderator resolves it.')
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

      // Reviewers earn +1 karma per cast vote (event-checked → idempotent).
      const alreadyReviewerEvent = await tx.karmaEvent.findFirst({
        where: { userId: me.id, reason: 'review_cast', refId: revision.id },
        select: { id: true },
      })
      if (!alreadyReviewerEvent) {
        await tx.user.update({ where: { id: me.id }, data: { karma: { increment: 1 } } })
        await tx.karmaEvent.create({
          data: { userId: me.id, delta: 1, reason: 'review_cast', refId: revision.id },
        })
      }
      const reviewerKarma = me.karma + 1

      let approvedCount = revision.approvedCount
      let rejectedCount = revision.rejectedCount
      if (verdict === 'approve') {
        const bumped = await tx.productRevision.updateMany({
          where: { id: revision.id, status: 'pending' },
          data: { approvedCount: { increment: 1 } },
        })
        if (bumped.count === 0) throw new ReviewAbort(409, 'This revision was already finalized.')
        approvedCount += 1
      } else {
        const bumped = await tx.productRevision.updateMany({
          where: { id: revision.id, status: 'pending' },
          data: { rejectedCount: { increment: 1 } },
        })
        if (bumped.count === 0) throw new ReviewAbort(409, 'This revision was already finalized.')
        rejectedCount += 1
      }

      // A rejection that reaches its threshold finalizes the revision — but an
      // approval can never silently override rejections: coexisting verdicts
      // mark the revision disputed instead.
      if (rejectedCount > 0 && approvedCount > 0) {
        await tx.productRevision.update({
          where: { id: revision.id },
          data: { disputeStatus: 'disputed' },
        })
        return { finalized: false, status: 'disputed', approvedCount, rejectedCount, reviewerKarma }
      }
      if (rejectedCount >= rejectsNeededFor(trust.level)) {
        const finalized = await tx.productRevision.updateMany({
          where: { id: revision.id, status: 'pending' },
          data: { status: 'rejected', finalizedAt: new Date() },
        })
        if (finalized.count > 0) {
          // submitter loses 1 karma, floored at 0 (idempotent via event check)
          const submitter = await tx.user.findUnique({ where: { id: revision.submittedById } })
          const alreadyPenalty = await tx.karmaEvent.findFirst({
            where: { userId: revision.submittedById, reason: 'revision_rejected', refId: revision.id },
            select: { id: true },
          })
          if (submitter && submitter.karma > 0 && !alreadyPenalty) {
            await tx.user.update({ where: { id: submitter.id }, data: { karma: { decrement: 1 } } })
            await tx.karmaEvent.create({
              data: { userId: submitter.id, delta: -1, reason: 'revision_rejected', refId: revision.id },
            })
          }
        }
        return { finalized: true, status: 'rejected', approvedCount, rejectedCount, reviewerKarma }
      }

      if (verdict === 'approve') {
        // A Moderator's approval merges any pending revision (Gerrit-style +2);
        // otherwise the required approval count decides.
        const shouldPublish = trust.level === 3 || approvedCount >= revision.requiredApprovals
        if (!shouldPublish) {
          return { finalized: false, status: 'pending', approvedCount, rejectedCount, reviewerKarma }
        }
        // Evidence gate BEFORE any publication: claims require photos that
        // exist on disk and support exactly what is being verified.
        const changed = JSON.parse(revision.changedFields || '[]') as LabelField[]
        const coverage = evidenceCoverage(revision)
        const needsIngredient = changed.some((f) => f === 'ingredients' || f === 'ingredientsImage')
        const needsNutrition = changed.some((f) => NUTRITION_CLAIM_FIELDS.includes(f))
        const needsFront = changed.some((f) => f === 'name' || f === 'brand' || f === 'frontImage')
        if (needsIngredient && !coverage.ingredients) {
          throw new ReviewAbort(
            422,
            'Verifying ingredient claims requires an ingredient-list photo as evidence (upload it in the submit form).',
          )
        }
        if (needsNutrition && !coverage.nutrition) {
          throw new ReviewAbort(
            422,
            'Verifying nutrition/serving claims requires a nutrition-table photo as evidence (upload it in the submit form).',
          )
        }
        if (needsFront && !coverage.front) {
          throw new ReviewAbort(
            422,
            'Verifying product identity claims requires a front-of-pack photo as evidence (upload it in the submit form).',
          )
        }

        // THE single publication path: pointer, supersede, search fields,
        // verifiedAt — all atomic. Karma award is event-checked (idempotent).
        await finalizePublication(tx, revision.id)
        const alreadyReward = await tx.karmaEvent.findFirst({
          where: { userId: revision.submittedById, reason: 'revision_approved', refId: revision.id },
          select: { id: true },
        })
        if (!alreadyReward) {
          await tx.user.update({ where: { id: revision.submittedById }, data: { karma: { increment: 2 } } })
          await tx.karmaEvent.create({
            data: { userId: revision.submittedById, delta: 2, reason: 'revision_approved', refId: revision.id },
          })
        }
        return {
          finalized: true,
          status: 'approved',
          approvedCount,
          rejectedCount,
          reviewerKarma,
          verificationState: 'verified',
        }
      }

      return { finalized: false, status: 'pending', approvedCount, rejectedCount, reviewerKarma }
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
