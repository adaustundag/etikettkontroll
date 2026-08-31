import { createHmac, timingSafeEqual } from 'crypto'
import { cookies, headers } from 'next/headers'
import { db } from '@/lib/db'

const DEV_SECRET = 'etikettkontroll-dev-secret'

export const SESSION_COOKIE = 'ek_session'
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000 // 30 days

type SessionPayload = { uid: string; exp: number }

/**
 * Session signing secret. In production AUTH_SECRET is REQUIRED — falling back
 * to the public dev secret would make every session token forgeable, so we
 * fail closed instead (audit CRITICAL: hardcoded fallback). Generate with:
 *   openssl rand -hex 32
 */
function secret(): string {
  const explicit = process.env.AUTH_SECRET
  if (explicit) return explicit
  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET is required in production. Generate one with: openssl rand -hex 32')
  }
  return DEV_SECRET
}

function sign(data: string): string {
  return createHmac('sha256', secret()).update(data).digest('base64url')
}

export function createToken(uid: string): string {
  const payload: SessionPayload = { uid, exp: Date.now() + SESSION_TTL_MS }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyToken(token: string): SessionPayload | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const a = Buffer.from(sig)
  const b = Buffer.from(sign(body))
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as SessionPayload
    if (!payload.uid || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }
}

/**
 * Resolve the signed-in user. Reads the `Authorization: Bearer` header first
 * (required inside cross-origin preview iframes where cookies are dropped),
 * then falls back to the httpOnly session cookie. Route handlers only.
 */
export async function getSessionUser() {
  const h = await headers()
  const authz = h.get('authorization')
  let token = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : undefined
  if (!token) {
    const jar = await cookies()
    token = jar.get(SESSION_COOKIE)?.value
  }
  if (!token) return null
  const payload = verifyToken(token)
  if (!payload) return null
  return db.user.findUnique({
    where: { id: payload.uid },
    select: { id: true, email: true, name: true, karma: true, createdAt: true },
  })
}
