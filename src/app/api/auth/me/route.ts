import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { computeTrust } from '@/lib/trust'
import type { MeDTO } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json(null as MeDTO)
  const trust = await computeTrust(user.id)
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
  }
  return NextResponse.json(me)
}
