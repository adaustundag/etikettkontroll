import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { computeTrust, rejectsNeededFor } from '@/lib/trust'
import { publishRevision } from '@/lib/revisions'

export const dynamic = 'force-dynamic'

type ReviewResult = {
  finalized: boolean
  status: 'pending' | 'approved' | 'rejected'
  approvedCount: number
  rejectedCount: number
  reviewerKarma: number
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ error: 'Sign in to review.' }, { status: 401 })

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
  if (trust.level < 2) {
    return NextResponse.json(
      { error: 'Reviewing unlocks at Trusted level (100 karma, 10+ approved edits).' },
      { status: 403 },
    )
  }

  const revision = await db.productRevision.findUnique({
    where: { id },
    include: {
      submittedBy: { select: { id: true, name: true, karma: true, trustLevel: true } },
      reviews: { select: { reviewerId: true } },
    },
  })
  if (!revision) return NextResponse.json({ error: 'Revision not found.' }, { status: 404 })
  if (revision.status !== 'pending') {
    return NextResponse.json({ error: 'This revision was already finalized.' }, { status: 409 })
  }
  if (revision.submittedById === me.id) {
    return NextResponse.json({ error: 'You cannot review your own submission.' }, { status: 403 })
  }
  if (revision.reviews.some((r) => r.reviewerId === me.id)) {
    return NextResponse.json({ error: 'You have already reviewed this revision.' }, { status: 409 })
  }

  const result = await db.$transaction(async (tx) => {
    await tx.review.create({
      data: { revisionId: revision.id, reviewerId: me.id, verdict, comment },
    })

    // Reviewers earn +1 karma per cast vote.
    await tx.user.update({ where: { id: me.id }, data: { karma: { increment: 1 } } })
    await tx.karmaEvent.create({
      data: { userId: me.id, delta: 1, reason: 'review_cast', refId: revision.id },
    })
    const reviewerKarma = me.karma + 1

    let finalized = false
    let newStatus: 'pending' | 'approved' | 'rejected' = 'pending'

    if (verdict === 'approve') {
      const approvedCount = revision.approvedCount + 1
      // A Moderator's approval merges any pending revision (Gerrit-style +2).
      const shouldPublish = trust.level === 3 || approvedCount >= revision.requiredApprovals
      await tx.productRevision.update({ where: { id: revision.id }, data: { approvedCount } })
      if (shouldPublish) {
        await publishRevision(tx, revision.id)
        finalized = true
        newStatus = 'approved'
        await tx.user.update({
          where: { id: revision.submittedById },
          data: { karma: { increment: 2 } },
        })
        await tx.karmaEvent.create({
          data: { userId: revision.submittedById, delta: 2, reason: 'revision_approved', refId: revision.id },
        })
      }
      return {
        finalized,
        status: newStatus,
        approvedCount,
        rejectedCount: revision.rejectedCount,
        reviewerKarma,
      } satisfies ReviewResult
    }

    // reject
    const rejectedCount = revision.rejectedCount + 1
    await tx.productRevision.update({ where: { id: revision.id }, data: { rejectedCount } })
    if (rejectedCount >= rejectsNeededFor(trust.level)) {
      await tx.productRevision.update({
        where: { id: revision.id },
        data: { status: 'rejected', finalizedAt: new Date() },
      })
      finalized = true
      newStatus = 'rejected'
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
      finalized,
      status: newStatus,
      approvedCount: revision.approvedCount,
      rejectedCount,
      reviewerKarma,
    } satisfies ReviewResult
  })

  return NextResponse.json(result)
}
