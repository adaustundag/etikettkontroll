import type { NextRequest } from 'next/server'
import { escapeHtml } from '@/lib/sanitize'

/**
 * Email delivery (Resend) + helpers shared by the magic-link sign-in flow and
 * the registration confirmation mail. No provider configured = sendEmail
 * returns false and callers degrade gracefully.
 */

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

// escapeHtml lives in lib/sanitize.ts (single source of truth, Task 30C);
// re-exported here because email templates are its primary consumers.
export { escapeHtml }

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
// Priority: explicit APP_URL → proxy headers (Railway) → request origin.
// HOSTNAME/PORT must never be used here: behind a reverse proxy they resolve
// to 0.0.0.0:<port>, producing dead links (seen live on Railway).
//
// 30D hardening: in production, forwarded headers are NOT trusted — a forged
// x-forwarded-host would route confirmation/sign-in links (and their tokens)
// to an attacker-controlled origin. Production requires a configured APP_URL
// that is a clean HTTPS origin; missing/invalid config fails closed. Dev/test
// keeps the header fallback so the sandbox/preview keeps working.
export function publicOrigin(req: NextRequest): string {
  const appUrl = process.env.APP_URL?.trim()
  if (appUrl) {
    const validated = validatePublicOrigin(appUrl)
    if (validated) return validated
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'APP_URL is set but not a valid public origin (expect https://host with no path/credentials) — refusing to build trust links.',
      )
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'APP_URL is not configured — public origin cannot be trusted from forwarded headers in production.',
    )
  }
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  if (host) return `${proto || 'https'}://${host}`
  return req.nextUrl.origin
}

/** Accept only https://host[:443] — no credentials, query, fragment or path. */
export function validatePublicOrigin(candidate: string): string | null {
  try {
    const u = new URL(candidate)
    if (u.protocol !== 'https:') return null
    if (u.username || u.password) return null
    if (u.search || u.hash) return null
    if (u.pathname !== '/' && u.pathname !== '') return null
    if (u.port && u.port !== '443') return null
    return u.origin
  } catch {
    return null
  }
}
