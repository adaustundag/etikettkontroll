import { NextRequest } from 'next/server'
import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { finishSession } from '@/lib/oauth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { cleanText, truncateDisplay } from '@/lib/sanitize'

export const dynamic = 'force-dynamic'

// GET /api/auth/magic/verify?token=...[&popup=1] — consume the link, sign in
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  // Token-guessing bound: 30/min per IP (tokens are 256-bit, this is belt & suspenders).
  const limited = enforceRateLimit(req, 'magic-verify', 30, 60_000)
  if (limited) return limited

  try {
    const token = url.searchParams.get('token') || ''
    if (!token || token.length > 200) return NextResponse.json({ error: 'Missing token.' }, { status: 400 })

    const record = await db.magicToken.findUnique({
      where: { tokenHash: createHash('sha256').update(token).digest('hex') },
    })
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return NextResponse.json({ error: 'This sign-in link is invalid or has expired. Please request a new one.' }, { status: 400 })
    }
    await db.magicToken.update({ where: { id: record.id }, data: { usedAt: new Date() } })

    let user = await db.user.findUnique({ where: { email: record.email } })
    if (!user) {
      // Generated display name from the email local part — display-only text
      // (30C): cleaned + grapheme-safe truncation. Never applied to the email
      // identity itself.
      const local = cleanText(record.email.split('@')[0].replace(/[._-]+/g, ' '))
      const name =
        local
          .split(' ')
          .filter(Boolean)
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(' ') || 'Member'
      user = await db.user.create({ data: { email: record.email, name: truncateDisplay(name, 40), passwordHash: null } })
    }
    if (user.disabledAt) {
      return NextResponse.json({ error: 'This account has been disabled.' }, { status: 403 })
    }

    return finishSession(user.id, url.origin, url.searchParams.get('popup') === '1')
  } catch (err) {
    console.error('magic verify error', err)
    return NextResponse.json({ error: 'Sign-in failed. Please try again.' }, { status: 500 })
  }
}
