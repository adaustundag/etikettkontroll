import { createHash, randomBytes } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth'

/**
 * Hand-rolled OAuth (authorization-code flow) for Google + Facebook, wired
 * into our existing HMAC session system: OAuth only proves identity, then we
 * upsert/link a User row and issue the regular ek_session cookie + bearer
 * token. No NextAuth, one session system.
 *
 * Two completion modes:
 *  - popup  (used inside the preview iframe): callback renders a tiny page
 *    that postMessages the session token to window.opener, then closes.
 *  - redirect (first-party site / magic link in a new tab): sets the cookie
 *    and redirects the top-level page back into the app.
 *
 * Configuration (all optional — UI degrades gracefully when missing):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
 *   FACEBOOK_CLIENT_ID, FACEBOOK_CLIENT_SECRET
 *   RESEND_API_KEY, MAIL_FROM        (magic-link delivery; dev mode without)
 */

export type OAuthProvider = 'google' | 'facebook'
export const OAUTH_PROVIDERS: OAuthProvider[] = ['google', 'facebook']

type ProviderConfig = {
  authorizeUrl: string
  tokenUrl: string
  scope: string
  usePkce: boolean
}

const CONFIGS: Record<OAuthProvider, ProviderConfig> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    usePkce: true,
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v19.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v19.0/oauth/access_token',
    scope: 'email public_profile',
    usePkce: false,
  },
}

export function providerConfigured(provider: OAuthProvider): boolean {
  if (provider === 'google') return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  return Boolean(process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET)
}

export function providerLabel(provider: OAuthProvider): string {
  return provider === 'google' ? 'Google' : 'Facebook'
}

// --- state cookie (start ↔ callback round trip) -----------------------------

type OAuthState = { s: string; v?: string; p: boolean; ts: number }
const STATE_COOKIE = (provider: OAuthProvider) => `ek_ox_${provider}`
const STATE_TTL_S = 600

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function readB64UrlJson<T>(value: string): T | null {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString()) as T
  } catch {
    return null
  }
}

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export async function saveState(provider: OAuthProvider, state: OAuthState) {
  const jar = await cookies()
  jar.set(STATE_COOKIE(provider), b64urlJson(state), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: STATE_TTL_S,
  })
}

export async function consumeState(provider: OAuthProvider, stateParam: string | null): Promise<OAuthState | null> {
  const jar = await cookies()
  const raw = jar.get(STATE_COOKIE(provider))?.value
  jar.set(STATE_COOKIE(provider), '', { path: '/', maxAge: 0 })
  if (!raw || !stateParam) return null
  const state = readB64UrlJson<OAuthState>(raw)
  if (!state || state.s !== stateParam) return null
  if (Date.now() - state.ts > STATE_TTL_S * 1000) return null
  return state
}

// --- provider round trips ----------------------------------------------------

export function buildAuthorizeUrl(provider: OAuthProvider, origin: string, state: OAuthState): string {
  const cfg = CONFIGS[provider]
  const redirectUri = `${origin}/api/auth/oauth/${provider}/callback`
  const params = new URLSearchParams({
    client_id: provider === 'google' ? process.env.GOOGLE_CLIENT_ID! : process.env.FACEBOOK_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: cfg.scope,
    state: state.s,
  })
  if (cfg.usePkce && state.v) {
    params.set('code_challenge', createHash('sha256').update(state.v).digest('base64url'))
    params.set('code_challenge_method', 'S256')
  }
  return `${cfg.authorizeUrl}?${params.toString()}`
}

type ProviderProfile = { providerId: string; email: string; name: string }

export async function exchangeCodeForProfile(
  provider: OAuthProvider,
  code: string,
  origin: string,
  state: OAuthState,
): Promise<ProviderProfile> {
  const cfg = CONFIGS[provider]
  const body = new URLSearchParams({
    client_id: provider === 'google' ? process.env.GOOGLE_CLIENT_ID! : process.env.FACEBOOK_CLIENT_ID!,
    client_secret:
      provider === 'google' ? process.env.GOOGLE_CLIENT_SECRET! : process.env.FACEBOOK_CLIENT_SECRET!,
    code,
    grant_type: 'authorization_code',
    redirect_uri: `${origin}/api/auth/oauth/${provider}/callback`,
  })
  if (cfg.usePkce && state.v) body.set('code_verifier', state.v)

  const tokenRes = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  })
  if (!tokenRes.ok) throw new Error(`token exchange failed (${tokenRes.status})`)
  const tokenJson = (await tokenRes.json()) as { access_token?: string }
  const accessToken = tokenJson.access_token
  if (!accessToken) throw new Error('no access token')

  let profile: ProviderProfile
  if (provider === 'google') {
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) throw new Error(`userinfo failed (${res.status})`)
    const u = (await res.json()) as { sub: string; email?: string; email_verified?: boolean; name?: string }
    if (!u.email) throw new Error('no_email')
    if (u.email_verified === false) throw new Error('no_email')
    profile = { providerId: u.sub, email: u.email.toLowerCase(), name: u.name || u.email.split('@')[0] }
  } else {
    const res = await fetch(
      `https://graph.facebook.com/me?fields=id,name,email&access_token=${encodeURIComponent(accessToken)}`,
    )
    if (!res.ok) throw new Error(`userinfo failed (${res.status})`)
    const u = (await res.json()) as { id: string; email?: string; name?: string }
    if (!u.email) throw new Error('no_email') // FB omits email when unverified
    profile = { providerId: u.id, email: u.email.toLowerCase(), name: u.name || u.email.split('@')[0] }
  }
  return profile
}

// --- user resolution (login / link / register) --------------------------------

export async function resolveOAuthUser(provider: string, providerId: string, email: string, name: string) {
  // 1. returning social user
  const existing = await db.externalIdentity.findUnique({
    where: { provider_providerId: { provider, providerId } },
    include: { user: true },
  })
  if (existing) return existing.user

  // 2. same email → link identity to the existing account
  const byEmail = await db.user.findUnique({ where: { email } })
  if (byEmail) {
    try {
      await db.externalIdentity.create({ data: { userId: byEmail.id, provider, providerId } })
    } catch {
      // concurrent link — fine, the identity lookup above governs next time
    }
    return byEmail
  }

  // 3. brand-new member
  try {
    return await db.user.create({
      data: {
        email,
        name,
        passwordHash: null,
        identities: { create: { provider, providerId } },
      },
    })
  } catch {
    // rare race: someone else created this email meanwhile → link instead
    const user = await db.user.findUnique({ where: { email } })
    if (!user) throw new Error('user resolution failed')
    await db.externalIdentity
      .createMany({ data: [{ userId: user.id, provider, providerId }] })
      .catch(() => undefined) // concurrent link already created it
    return user
  }
}

// --- session issuance for both completion modes -------------------------------

export function finishSession(
  userId: string,
  origin: string,
  popup: boolean,
): NextResponse {
  const token = createToken(userId)
  if (popup) {
    // Popup mode: hand the token to the opener (the app inside the preview
    // iframe) and close. If there is no opener (link opened as a plain new
    // tab), the cookie was still set — just continue into the app.
    const html = `<!doctype html><meta charset="utf-8"><title>Signed in</title><body><script>
(function(){
  var handed=false;
  try{
    if(window.opener){window.opener.postMessage({type:'ek_oauth',token:${JSON.stringify(token)}},'*');handed=true;}
  }catch(e){}
  if(handed){setTimeout(function(){window.close()},200);}
  else{setTimeout(function(){window.location.replace('/')},200);}
})();
</script>Signing in…</body>`
    const res = new NextResponse(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
    return res
  }
  const res = NextResponse.redirect(`${origin}/`)
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions())
  return res
}

export function oauthErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : ''
  if (msg === 'no_email') {
    return 'The provider did not share a verified email address. Please use the email link sign-in instead.'
  }
  return 'Sign-in failed. Please try again.'
}
