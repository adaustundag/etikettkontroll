import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getSessionUser } from '@/lib/auth'
import { finalizePublication } from '@/lib/revisions'
import { enforceRateLimit } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/revisions/[id]/dispute — recorded moderator resolution of a
 * disputed revision. Disputes (coexisting approvals and rejections) block
 * publication; only this endpoint, requiring an operator-appointed role and a
 * written reason, may unblock it — by upholding (publish) or upholding the
 * rejection (finalize as rejected). A plain approval vote can never silently
 * override a rejection.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await getSessionUser()
  if (!me) return NextResponse.json({ error: 'Sign in to resolve disputes.' }, { status: 401 })
  if (me.role !== 'moderator' && me.role !== 'admin') {
    return NextResponse.json({ error: 'Moderator authority required (operator-appointed role).' }, { status: 403 })
  }

  const limited = enforceRateLimit(req, 'dispute-resolve', 20, 60_000, me.id)
  if (limited) return limited

  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { resolution?: string; reason?: string }
  const resolution = body.resolution
  if (resolution !== 'approve' && resolution !== 'reject') {
    return NextResponse.json({ error: 'Resolution must be approve or reject.' }, { status: 400 })
  }
  const reason = (body.reason || '').trim()
  if (reason.length < 10 || reason.length > 500) {
    return NextResponse.json({ error: 'A written reason (10–500 characters) is required for the resolution.' }, { status: 400 })
  }

  const result = await db
    .$transaction(async (tx): Promise<{ status: 'approved' | 'rejected'; verificationState: string }> => {
      const revision = await tx.productRevision.findUnique({ where: { id } })
      if (!revision) throw new Error('__404:Revision not found.')
      if (revision.status !== 'pending') {
        throw new Error('__409:This revision was already finalized.')
      }
      if (revision.disputeStatus !== 'disputed') {
        throw new Error('__409:This revision is not disputed.')
      }

      await tx.productRevision.update({
        where: { id: revision.id },
        data: {
          disputeStatus: 'resolved',
          disputeReason: reason.slice(0, 500),
          disputeResolvedAt: new Date(),
          disputeResolvedById: me.id,
        },
      })

      if (resolution === 'approve') {
        await finalizePublication(tx, revision.id)
        return { status: 'approved', verificationState: 'verified' }
      }
      await tx.productRevision.updateMany({
        where: { id: revision.id, status: 'pending' },
        data: { status: 'rejected', finalizedAt: new Date() },
      })
      return { status: 'rejected', verificationState: 'rejected' }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : ''
      if (msg.startsWith('__')) return { __http: Number(msg.slice(2, 5)), error: msg.slice(6) } as const
      throw err
    })

  if ('__http' in result) {
    return NextResponse.json({ error: result.error }, { status: result.__http })
  }
  return NextResponse.json({ finalized: true, ...result, resolvedBy: me.id })
}
