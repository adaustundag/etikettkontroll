import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { enforceRateLimit } from '@/lib/rate-limit'
import { assertOptionalBoolean, assertOptionalStringField, payloadErrorResponse, readBoundedJsonObject } from '@/lib/payload'
import { sendEmail, publicOrigin } from '@/lib/mail'

export const dynamic = 'force-dynamic'

const TTL_MS = 15 * 60 * 1000
const RESEND_INTERVAL_MS = 30 * 1000
const recent = new Map<string, number>() // email -> last request ts (per-process guard)

// POST /api/auth/magic/request { email, popup? } — create a one-time sign-in link
export async function POST(req: NextRequest) {
  // Email-sending + token cost: 10/min per IP (plus the per-email 30s guard below).
  const limited = enforceRateLimit(req, 'magic-request', 10, 60_000)
  if (limited) return limited

  try {
    const body = await readBoundedJsonObject(req, 8 * 1024)
    const email = (assertOptionalStringField(body.email, 'email') ?? '').trim().toLowerCase()
    const popup = assertOptionalBoolean(body.popup, 'popup') === true
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const last = recent.get(email) ?? 0
    if (Date.now() - last < RESEND_INTERVAL_MS) {
      return NextResponse.json({ error: 'Please wait a moment before requesting another link.' }, { status: 429 })
    }
    recent.set(email, Date.now())

    // CSPRNG token — Math.random() is predictable and must never guard a login.
    const token = randomBytes(32).toString('base64url')
    await db.magicToken.deleteMany({ where: { email, usedAt: null } }) // one live link per email
    await db.magicToken.create({
      data: {
        email,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    })

    const origin = publicOrigin(req)
    const popupSuffix = popup ? '&popup=1' : ''
    const link = `${origin}/api/auth/magic/verify?token=${token}${popupSuffix}`

    const sent = await sendEmail(
      email,
      'Your EtikettKontroll sign-in link',
      `<p>Hi,</p><p>Click below to sign in to EtikettKontroll. The link works once and expires in 15 minutes.</p><p><a href="${link}">Sign in</a></p><p>If you didn't request this, you can ignore this email.</p>`,
    )
    if (sent) return NextResponse.json({ ok: true, emailed: true })

    // No mail provider configured. Handing the sign-in link to whoever asked
    // would let anyone take over any address, so in production we fail loudly
    // instead (audit CRITICAL, verified live on Railway). Dev/test keeps the
    // link in the response so the flow stays scriptable end-to-end.
    if (process.env.NODE_ENV === 'production') {
      console.error('magic request: no mail provider configured — sign-in link withheld in production')
      return NextResponse.json(
        { error: 'Email sign-in is not configured. Please use another sign-in method.' },
        { status: 503 },
      )
    }
    return NextResponse.json({ ok: true, emailed: false, devLink: link })
  } catch (err) {
    const mapped = payloadErrorResponse(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('magic request error', err)
    return NextResponse.json({ error: 'Could not create a sign-in link. Please try again.' }, { status: 500 })
  }
}
