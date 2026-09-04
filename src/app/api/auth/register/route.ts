import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { createToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { PayloadTooLargeError, readBoundedJson } from '@/lib/payload'
import { escapeHtml, mailConfigured, publicOrigin, sendEmail } from '@/lib/mail'

export const dynamic = 'force-dynamic'

const VERIFY_TTL_MS = 60 * 60 * 1000

/** Best-effort confirmation mail: clicking the link signs in AND verifies the address. */
async function sendConfirmationEmail(req: NextRequest, email: string, name: string): Promise<void> {
  if (!mailConfigured()) return
  try {
    const token = randomBytes(32).toString('base64url')
    await db.magicToken.deleteMany({ where: { email, usedAt: null } })
    await db.magicToken.create({
      data: {
        email,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
      },
    })
    const link = `${publicOrigin(req)}/api/auth/magic/verify?token=${token}`
    await sendEmail(
      email,
      'Confirm your email – EtikettKontroll',
      `<p>Hi ${escapeHtml(name)},</p><p>Welcome to EtikettKontroll! Click below to confirm your email address. The link works once, expires in 60 minutes, and signs you in.</p><p><a href="${link}">Confirm email</a></p><p>If you didn't create this account, you can ignore this email.</p>`,
    )
  } catch (err) {
    // Confirmation mail is convenience, never a gate — failures are logged only.
    console.error('register confirmation mail failed:', err instanceof Error ? err.message : err)
  }
}

export async function POST(req: NextRequest) {
  // Account-creation flood bound: 10 per minute per IP.
  const limited = enforceRateLimit(req, 'register', 10, 60_000)
  if (limited) return limited

  try {
    const body = (await readBoundedJson<{ name?: string; email?: string; password?: string }>(req, 64 * 1024)) ?? {}
    const name = (body.name || '').trim()
    const email = (body.email || '').trim().toLowerCase()
    const password = body.password || ''

    if (name.length < 2) return NextResponse.json({ error: 'Please use your real name (min 2 characters).' }, { status: 400 })
    if (name.length > 60) return NextResponse.json({ error: 'Name is too long (max 60 characters).' }, { status: 400 })
    if (email.length > 254) return NextResponse.json({ error: 'Email is too long (max 254 characters).' }, { status: 400 })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    if (password.length < 8) return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
    if (password.length > 200) return NextResponse.json({ error: 'Password must be at most 200 characters.' }, { status: 400 })

    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })

    const user = await db.user.create({
      data: { name, email, passwordHash: hashPassword(password) },
      select: { id: true, name: true, email: true },
    })
    // Best-effort: clicking the mailed link signs in AND verifies the address.
    void sendConfirmationEmail(req, email, name)

    // Token goes in the body as well as the cookie: the cookie is dropped in
    // cross-origin iframes (preview panel), the bearer token is not.
    const token = createToken(user.id)
    const res = NextResponse.json({ user, token })
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
    return res
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: 'Request body is too large.' }, { status: 413 })
    }
    console.error('register error', err)
    return NextResponse.json({ error: 'Registration failed. Please try again.' }, { status: 500 })
  }
}
