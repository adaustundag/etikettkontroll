import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TTL_MS = 15 * 60 * 1000
const RESEND_INTERVAL_MS = 30 * 1000
const recent = new Map<string, number>() // email -> last request ts (per-process guard)

function prettyName(email: string): string {
  const local = email.split('@')[0].replace(/[._-]+/g, ' ').trim()
  const name = local
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  return (name || 'Member').slice(0, 40)
}

async function sendEmail(to: string, link: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'EtikettKontroll <onboarding@resend.dev>',
        to,
        subject: 'Your EtikettKontroll sign-in link',
        html: `<p>Hi,</p><p>Click below to sign in to EtikettKontroll. The link works once and expires in 15 minutes.</p><p><a href="${link}">Sign in</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// POST /api/auth/magic/request { email, popup? } — create a one-time sign-in link
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; popup?: boolean }
    const email = (body.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }

    const last = recent.get(email) ?? 0
    if (Date.now() - last < RESEND_INTERVAL_MS) {
      return NextResponse.json({ error: 'Please wait a moment before requesting another link.' }, { status: 429 })
    }
    recent.set(email, Date.now())

    const token = Buffer.from(new Uint8Array(32).map(() => Math.floor(Math.random() * 256))).toString('base64url')
    await db.magicToken.deleteMany({ where: { email, usedAt: null } }) // one live link per email
    await db.magicToken.create({
      data: {
        email,
        tokenHash: createHash('sha256').update(token).digest('hex'),
        expiresAt: new Date(Date.now() + TTL_MS),
      },
    })

    const origin = req.nextUrl.origin
    const popupSuffix = body.popup ? '&popup=1' : ''
    const link = `${origin}/api/auth/magic/verify?token=${token}${popupSuffix}`

    const sent = await sendEmail(email, link)
    if (sent) return NextResponse.json({ ok: true, emailed: true })

    // No mail provider configured → dev mode: hand the link back so the flow
    // stays testable end-to-end until SMTP/Resend keys are added.
    return NextResponse.json({ ok: true, emailed: false, devLink: link })
  } catch (err) {
    console.error('magic request error', err)
    return NextResponse.json({ error: 'Could not create a sign-in link. Please try again.' }, { status: 500 })
  }
}
