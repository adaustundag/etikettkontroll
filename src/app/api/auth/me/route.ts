import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { computeTrust } from '@/lib/trust'
import { emailVerifiedFor } from '@/lib/verify-email'
import type { MeDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json(null as MeDTO)
  const [trust, emailVerified] = await Promise.all([computeTrust(user.id), emailVerifiedFor(user)])
  const me: MeDTO = {
    id: user.id,
    name: user.name,
    email: user.email,
    karma: user.karma,
    trustLevel: trust.level,
    trustLabel: trust.label,
    approvedCount: trust.approvedCount,
    totalCount: trust.totalCount,
    approvalRate: trust.approvalRate,
    emailVerified,
  }
  return NextResponse.json(me)
}
