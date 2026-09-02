import type { NextRequest } from 'next/server'

/**
 * Email delivery (Resend) + helpers shared by the magic-link sign-in flow and
 * the registration confirmation mail. No provider configured = sendEmail
 * returns false and callers degrade gracefully.
 */

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const key = process.env.RESEND_API_KEY
  if (!key) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.MAIL_FROM || 'EtikettKontroll <onboarding@resend.dev>',
        to,
        subject,
        html,
      }),
    })
    return res.ok
  } catch {
    return false
  }
}

// Public origin of this deployment, used to build sign-in links.
// Priority: explicit APP_URL → proxy headers (Railway/Caddy) → request origin.
// HOSTNAME/PORT must never be used here: behind a reverse proxy they resolve
// to 0.0.0.0:<port>, producing dead links (seen live on Railway).
export function publicOrigin(req: NextRequest): string {
  const appUrl = process.env.APP_URL?.trim()
  if (appUrl) return appUrl.replace(/\/+$/, '')
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (host) return `${proto || 'https'}://${host}`
  return req.nextUrl.origin
}
