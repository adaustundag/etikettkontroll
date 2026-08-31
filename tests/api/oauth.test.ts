import '../setup'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GET as providersGET } from '@/app/api/auth/providers/route'
import { GET as meGET } from '@/app/api/auth/me/route'
import { GET as oauthStart } from '@/app/api/auth/oauth/[provider]/start/route'
import { GET as oauthCallback } from '@/app/api/auth/oauth/[provider]/callback/route'
import { POST as magicRequest } from '@/app/api/auth/magic/request/route'
import { GET as magicVerify } from '@/app/api/auth/magic/verify/route'
import { db } from '@/lib/db'
import { clearCtx, mockAuth, peekCookie, req, sessionCookie, withParams } from '../setup'
import { mkUser, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
  clearCtx()
})

// ---- fetch stubs (no real network in tests) ---------------------------------

type GoogleProfile = { sub: string; email: string; name: string; email_verified?: boolean }

function stubFetch(responder: (url: string) => Response | null): () => void {
  const original = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const res = responder(url)
    if (res) return res
    return original(input, init)
  }) as typeof fetch
  return () => {
    globalThis.fetch = original
  }
}

const googleTokenStub = (profile: GoogleProfile) =>
  stubFetch((url) => {
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'at-123' }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
      return new Response(JSON.stringify(profile), { headers: { 'content-type': 'application/json' } })
    }
    return null
  })

const facebookTokenStub = (profile: { id: string; email?: string; name?: string }) =>
  stubFetch((url) => {
    if (url.startsWith('https://graph.facebook.com/v19.0/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'fb-at-1' }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    if (url.startsWith('https://graph.facebook.com/me?')) {
      return new Response(JSON.stringify(profile), { headers: { 'content-type': 'application/json' } })
    }
    return null
  })

/** Run start → callback for Google and return { res, state, restore } pieces. */
async function runGoogleCallback(opts: { popup?: boolean; profile: GoogleProfile }) {
  await oauthStart(req('GET', `/api/auth/oauth/google/start${opts.popup ? '?popup=1' : ''}`), withParams({ provider: 'google' }))
  const state = (JSON.parse(Buffer.from(peekCookie('ek_ox_google')!, 'base64url').toString()) as { s: string }).s
  const restore = googleTokenStub(opts.profile)
  const res = await oauthCallback(
    req('GET', `/api/auth/oauth/google/callback?code=abc&state=${encodeURIComponent(state)}`),
    withParams({ provider: 'google' }),
  )
  return { res, state, restore }
}

// ---- GET /api/auth/providers -------------------------------------------------

describe('GET /api/auth/providers', () => {
  test('reports google/facebook unconfigured and magic always available', async () => {
    const res = await providersGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ google: false, facebook: false, magic: true })
  })
})

// ---- GET /api/auth/oauth/[provider]/start -------------------------------------

describe('GET /api/auth/oauth/[provider]/start (unconfigured)', () => {
  test('404 for unknown provider', async () => {
    const res = await oauthStart(req('GET', '/api/auth/oauth/twitter/start'), withParams({ provider: 'twitter' }))
    expect(res.status).toBe(404)
  })

  test('400 with a clear message when credentials are missing', async () => {
    const res = await oauthStart(req('GET', '/api/auth/oauth/google/start'), withParams({ provider: 'google' }))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('not configured')
  })
})

describe('GET /api/auth/oauth/[provider]/start (configured)', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
    process.env.FACEBOOK_CLIENT_ID = 'test-fb-id'
    process.env.FACEBOOK_CLIENT_SECRET = 'test-fb-secret'
  })
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.FACEBOOK_CLIENT_ID
    delete process.env.FACEBOOK_CLIENT_SECRET
  })

  test('redirects to Google with PKCE + state and plants the state cookie', async () => {
    const res = await oauthStart(req('GET', '/api/auth/oauth/google/start?popup=1'), withParams({ provider: 'google' }))
    expect(res.status).toBe(307)
    const loc = res.headers.get('location')!
    expect(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth?')).toBe(true)
    const u = new URL(loc)
    expect(u.searchParams.get('client_id')).toBe('test-google-id')
    expect(u.searchParams.get('response_type')).toBe('code')
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/oauth/google/callback')
    expect(u.searchParams.get('code_challenge_method')).toBe('S256')
    expect(u.searchParams.get('code_challenge')).toBeTruthy()
    const state = u.searchParams.get('state')!

    const cookieVal = peekCookie('ek_ox_google')
    expect(cookieVal).toBeTruthy()
    const decoded = JSON.parse(Buffer.from(cookieVal!, 'base64url').toString()) as { s: string; p: boolean }
    expect(decoded.s).toBe(state)
    expect(decoded.p).toBe(true) // popup flag survives the round trip
  })

  test('redirects to the Facebook dialog without PKCE', async () => {
    const res = await oauthStart(req('GET', '/api/auth/oauth/facebook/start'), withParams({ provider: 'facebook' }))
    expect(res.status).toBe(307)
    const u = new URL(res.headers.get('location')!)
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/v19.0/dialog/oauth')
    expect(u.searchParams.get('client_id')).toBe('test-fb-id')
    expect(u.searchParams.get('code_challenge')).toBeNull()
    expect(peekCookie('ek_ox_facebook')).toBeTruthy()
  })
})

// ---- GET /api/auth/oauth/[provider]/callback -----------------------------------

describe('GET /api/auth/oauth/[provider]/callback', () => {
  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-google-id'
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
    process.env.FACEBOOK_CLIENT_ID = 'test-fb-id'
    process.env.FACEBOOK_CLIENT_SECRET = 'test-fb-secret'
  })
  afterEach(() => {
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.FACEBOOK_CLIENT_ID
    delete process.env.FACEBOOK_CLIENT_SECRET
  })

  test('404 for unknown provider', async () => {
    const res = await oauthCallback(req('GET', '/api/auth/oauth/twitter/callback'), withParams({ provider: 'twitter' }))
    expect(res.status).toBe(404)
  })

  test('redirects with oauth=cancelled when the user cancels consent', async () => {
    const res = await oauthCallback(
      req('GET', '/api/auth/oauth/google/callback?error=access_denied'),
      withParams({ provider: 'google' }),
    )
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/?oauth=cancelled')
  })

  test('400 when the state does not match the browser cookie', async () => {
    const res = await oauthCallback(
      req('GET', '/api/auth/oauth/google/callback?code=abc&state=forged-state'),
      withParams({ provider: 'google' }),
    )
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('expired')
  })

  test('400 when the code is missing', async () => {
    await oauthStart(req('GET', '/api/auth/oauth/google/start'), withParams({ provider: 'google' }))
    const state = (JSON.parse(Buffer.from(peekCookie('ek_ox_google')!, 'base64url').toString()) as { s: string }).s
    const res = await oauthCallback(
      req('GET', `/api/auth/oauth/google/callback?state=${encodeURIComponent(state)}`),
      withParams({ provider: 'google' }),
    )
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('code')
  })

  test('registers a new user via Google (redirect mode) and signs them in', async () => {
    const { res, restore } = await runGoogleCallback({
      profile: { sub: 'g-sub-1', email: 'googler@test.se', email_verified: true, name: 'Googler Person' },
    })
    restore()

    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/')
    const cookie = sessionCookie(res)
    expect(cookie).not.toBeNull()

    const identity = await db.externalIdentity.findUnique({
      where: { provider_providerId: { provider: 'google', providerId: 'g-sub-1' } },
      include: { user: true },
    })
    expect(identity).not.toBeNull()
    expect(identity!.user.name).toBe('Googler Person')
    expect(identity!.user.passwordHash).toBeNull() // social accounts have no password

    // the issued session token works on /me
    mockAuth(`Bearer ${cookie!.value}`)
    const me = (await (await meGET()).json()) as { id: string } | null
    expect(me?.id).toBe(identity!.user.id)

    // the state cookie was consumed — replaying the callback fails
    const replay = await oauthCallback(
      req('GET', '/api/auth/oauth/google/callback?code=abc&state=replay'),
      withParams({ provider: 'google' }),
    )
    expect(replay.status).toBe(400)
  })

  test('second sign-in with the same Google identity logs into the same account', async () => {
    const first = await runGoogleCallback({
      profile: { sub: 'g-sub-2', email: 'returning@test.se', email_verified: true, name: 'Returning User' },
    })
    first.restore()
    const second = await runGoogleCallback({
      profile: { sub: 'g-sub-2', email: 'returning@test.se', email_verified: true, name: 'Returning User' },
    })
    second.restore()

    expect(second.res.status).toBe(307)
    const users = await db.user.findMany({ where: { email: 'returning@test.se' } })
    expect(users.length).toBe(1)
  })

  test('links the Google identity to an existing same-email password account', async () => {
    const existing = await mkUser({ email: 'linked@test.se', name: 'Original Account' })
    const { res, restore } = await runGoogleCallback({
      profile: { sub: 'g-sub-3', email: 'linked@test.se', email_verified: true, name: 'Linked User' },
    })
    restore()

    expect(res.status).toBe(307)
    const users = await db.user.findMany({ where: { email: 'linked@test.se' } })
    expect(users.length).toBe(1)
    expect(users[0].id).toBe(existing.id)
    expect(users[0].passwordHash).toContain(':') // password untouched
    const identity = await db.externalIdentity.findUnique({
      where: { provider_providerId: { provider: 'google', providerId: 'g-sub-3' } },
    })
    expect(identity?.userId).toBe(existing.id)
  })

  test('popup mode returns the postMessage page carrying the session token', async () => {
    const { res, restore } = await runGoogleCallback({
      popup: true,
      profile: { sub: 'g-sub-4', email: 'popup@test.se', email_verified: true, name: 'Popup User' },
    })
    restore()

    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('ek_oauth')
    expect(html).toContain('postMessage')
    const token = html.match(/token:"([^"]+)"/)?.[1]
    expect(token).toBeTruthy()

    mockAuth(`Bearer ${token!}`)
    const me = (await (await meGET()).json()) as { email: string } | null
    expect(me?.email).toBe('popup@test.se')
  })

  test('400 with a friendly message when Google does not share a verified email', async () => {
    const { res, restore } = await runGoogleCallback({
      profile: { sub: 'g-sub-5', email: 'unverified@test.se', email_verified: false, name: 'No Email User' },
    })
    restore()
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('email')
  })

  test('completes a Facebook sign-in end to end', async () => {
    await oauthStart(req('GET', '/api/auth/oauth/facebook/start'), withParams({ provider: 'facebook' }))
    const state = (JSON.parse(Buffer.from(peekCookie('ek_ox_facebook')!, 'base64url').toString()) as { s: string }).s
    const restore = facebookTokenStub({ id: 'fb-1', email: 'fbuser@test.se', name: 'FB User' })
    const res = await oauthCallback(
      req('GET', `/api/auth/oauth/facebook/callback?code=fbcode&state=${encodeURIComponent(state)}`),
      withParams({ provider: 'facebook' }),
    )
    restore()

    expect(res.status).toBe(307)
    const identity = await db.externalIdentity.findUnique({
      where: { provider_providerId: { provider: 'facebook', providerId: 'fb-1' } },
      include: { user: true },
    })
    expect(identity).not.toBeNull()
    expect(identity!.user.email).toBe('fbuser@test.se')
  })

  test('400 when Facebook omits the email (unverified account)', async () => {
    await oauthStart(req('GET', '/api/auth/oauth/facebook/start'), withParams({ provider: 'facebook' }))
    const state = (JSON.parse(Buffer.from(peekCookie('ek_ox_facebook')!, 'base64url').toString()) as { s: string }).s
    const restore = facebookTokenStub({ id: 'fb-2', name: 'No Email FB' })
    const res = await oauthCallback(
      req('GET', `/api/auth/oauth/facebook/callback?code=fbcode&state=${encodeURIComponent(state)}`),
      withParams({ provider: 'facebook' }),
    )
    restore()
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('email')
  })
})

// ---- POST /api/auth/magic/request ----------------------------------------------

describe('POST /api/auth/magic/request', () => {
  test('400 for an invalid email', async () => {
    const res = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'not-an-email' }))
    expect(res.status).toBe(400)
  })

  test('returns a dev link when no mail provider is configured', async () => {
    const res = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'magic1@test.se', popup: true }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; emailed: boolean; devLink: string }
    expect(body.ok).toBe(true)
    expect(body.emailed).toBe(false)
    expect(body.devLink).toContain('/api/auth/magic/verify?token=')
    expect(body.devLink).toContain('popup=1')
    // exactly one live token exists for the email
    const tokens = await db.magicToken.findMany({ where: { email: 'magic1@test.se' } })
    expect(tokens.length).toBe(1)
  })

  test('429 on immediate re-request for the same email', async () => {
    await magicRequest(req('POST', '/api/auth/magic/request', { email: 'magic2@test.se' }))
    const res = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'magic2@test.se' }))
    expect(res.status).toBe(429)
  })
})

// ---- GET /api/auth/magic/verify -------------------------------------------------

describe('GET /api/auth/magic/verify', () => {
  test('400 when the token is missing', async () => {
    const res = await magicVerify(req('GET', '/api/auth/magic/verify'))
    expect(res.status).toBe(400)
  })

  test('400 for an unknown token', async () => {
    const res = await magicVerify(req('GET', '/api/auth/magic/verify?token=does-not-exist'))
    expect(res.status).toBe(400)
  })

  test('registers a new user with a pretty name, signs in once, then the link is dead', async () => {
    const r1 = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'anna.bengtsson@test.se' }))
    const { devLink } = (await r1.json()) as { devLink: string }
    const token = new URL(devLink).searchParams.get('token')!

    const res = await magicVerify(req('GET', `/api/auth/magic/verify?token=${encodeURIComponent(token)}`))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('http://localhost:3000/')
    const cookie = sessionCookie(res)
    expect(cookie).not.toBeNull()

    const user = await db.user.findUnique({ where: { email: 'anna.bengtsson@test.se' } })
    expect(user).not.toBeNull()
    expect(user!.name).toBe('Anna Bengtsson')
    expect(user!.passwordHash).toBeNull()

    // single use
    const res2 = await magicVerify(req('GET', `/api/auth/magic/verify?token=${encodeURIComponent(token)}`))
    expect(res2.status).toBe(400)
  })

  test('popup mode returns HTML carrying a working session token', async () => {
    const r1 = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'popup.magic@test.se', popup: true }))
    const { devLink } = (await r1.json()) as { devLink: string }
    const token = new URL(devLink).searchParams.get('token')!

    const res = await magicVerify(req('GET', `/api/auth/magic/verify?token=${encodeURIComponent(token)}&popup=1`))
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('ek_oauth')
    const sessionToken = html.match(/token:"([^"]+)"/)?.[1]
    expect(sessionToken).toBeTruthy()

    mockAuth(`Bearer ${sessionToken!}`)
    const me = (await (await meGET()).json()) as { email: string } | null
    expect(me?.email).toBe('popup.magic@test.se')
  })

  test('signs in to the EXISTING account when the email already has one', async () => {
    const existing = await mkUser({ email: 'existing.magic@test.se', name: 'Existing Account' })
    const r1 = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'existing.magic@test.se' }))
    const { devLink } = (await r1.json()) as { devLink: string }
    const token = new URL(devLink).searchParams.get('token')!

    const res = await magicVerify(req('GET', `/api/auth/magic/verify?token=${encodeURIComponent(token)}`))
    expect(res.status).toBe(307)

    const users = await db.user.findMany({ where: { email: 'existing.magic@test.se' } })
    expect(users.length).toBe(1)
    expect(users[0].id).toBe(existing.id)
  })

  test('400 for an expired link', async () => {
    const r1 = await magicRequest(req('POST', '/api/auth/magic/request', { email: 'expired@test.se' }))
    const { devLink } = (await r1.json()) as { devLink: string }
    const token = new URL(devLink).searchParams.get('token')!
    await db.magicToken.updateMany({ where: { email: 'expired@test.se' }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const res = await magicVerify(req('GET', `/api/auth/magic/verify?token=${encodeURIComponent(token)}`))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('expired')
  })
})
