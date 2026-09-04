import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { createToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { assertOptionalStringField, payloadErrorResponse, readBoundedJsonObject } from '@/lib/payload'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Brute-force bound: 10 attempts per minute per IP.
  const limited = enforceRateLimit(req, 'login', 10, 60_000)
  if (limited) return limited

  try {
    const body = await readBoundedJsonObject(req, 64 * 1024)
    const email = (assertOptionalStringField(body.email, 'email') ?? '').trim().toLowerCase()
    const password = assertOptionalStringField(body.password, 'password') ?? ''
    // Cap inputs before they reach scrypt/DB — scrypt cost scales with input length.
    if (email.length > 254 || password.length > 200) {
      return NextResponse.json({ error: 'Email or password is too long.' }, { status: 400 })
    }

    const user = await db.user.findUnique({ where: { email } })
    const hash = user?.passwordHash ?? null
    if (user && !hash) {
      return NextResponse.json(
        { error: 'This account signs in with Google, Facebook or an email link — no password is set.' },
        { status: 401 },
      )
    }
    if (!user || !hash || !verifyPassword(password, hash)) {
      return NextResponse.json({ error: 'Wrong email or password.' }, { status: 401 })
    }
    if (user.disabledAt) {
      return NextResponse.json({ error: 'This account has been disabled.' }, { status: 403 })
    }

    // Token goes in the body as well as the cookie: the cookie is dropped in
    // cross-origin iframes (preview panel), the bearer token is not.
    const token = createToken(user.id)
    const res = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email },
      token,
    })
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
    return res
  } catch (err) {
    const mapped = payloadErrorResponse(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('login error', err)
    return NextResponse.json({ error: 'Login failed. Please try again.' }, { status: 500 })
  }
}
