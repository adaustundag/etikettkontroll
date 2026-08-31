import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { finishSession } from '@/lib/oauth'

export const dynamic = 'force-dynamic'

// GET /api/auth/magic/verify?token=...[&popup=1] — consume the link, sign in
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  try {
    const token = url.searchParams.get('token') || ''
    if (!token) return NextResponse.json({ error: 'Missing token.' }, { status: 400 })

    const record = await db.magicToken.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    })
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This sign-in link is invalid or has expired. Please request a new one.' }, { status: 400 })
    }
    await db.magicToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })

    let user = await db.user.findUnique({ where: { email: record.email } })
    if (!user) {
      const local = record.email.split('@')[0].replace(/[._-]+/g, ' ').trim()
      const name =
        local
          .split(' ')
          .filter(Boolean)
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(' ') || 'Member'
      user = await db.user.create({ data: { email: record.email, name: name.slice(0, 40), passwordHash: null } })
    }

    return finishSession(user.id, url.origin, url.searchParams.get('popup') === '1')
  } catch (err) {
    console.error('magic verify error', err)
    return NextResponse.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
