import '../setup'
import { beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'crypto'
import { POST as registerPOST } from '@/app/api/auth/register/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { POST as logoutPOST } from '@/app/api/auth/logout/route'
import { GET as meGET } from '@/app/api/auth/me/route'
import { createToken, SESSION_COOKIE } from '@/lib/auth'
import { db } from '@/lib/db'
import { req } from '../setup'
import { clearCtx, mockAuth, sessionCookie } from '../setup'
import { mkUser, wipeDb } from '../fixtures'

beforeAll(async () => {
  await wipeDb()
})
beforeEach(() => clearCtx())

describe('POST /api/auth/register', () => {
  test('creates an account and returns user + token + httpOnly session cookie', async () => {
    const res = await registerPOST(
      req('POST', '/api/auth/register', { name: 'Maja Andersson', email: 'maja@test.se', password: 'supersecret1' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { email: string; name: string }; token: string }
    expect(body.user.email).toBe('maja@test.se')
    expect(body.user.name).toBe('Maja Andersson')
    expect(body.token.split('.').length).toBe(2)

    const cookie = sessionCookie(res)
    expect(cookie).not.toBeNull()
    expect(cookie!.options).toContain('HttpOnly')
    expect(cookie!.options.toLowerCase()).toContain('samesite=lax')
    expect(cookie!.options).toContain('Max-Age=')

    const row = await db.user.findUnique({ where: { email: 'maja@test.se' } })
    expect(row).not.toBeNull()
    expect(row!.passwordHash).toContain(':') // scrypt salt:hash
    expect(row!.karma).toBe(0)
  })

  test('email lookup is case-insensitive on login', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', { email: 'MAJA@TEST.SE', password: 'supersecret1' }))
    expect(res.status).toBe(200)
  })

  test('rejects invalid input with 400', async () => {
    const cases = [
      { name: 'A', email: 'ok@test.se', password: 'supersecret1' }, // name < 2
      { name: 'Valid Name', email: 'not-an-email', password: 'supersecret1' }, // bad email
      { name: 'Valid Name', email: 'ok2@test.se', password: 'short' }, // password < 8
    ]
    for (const body of cases) {
      const res = await registerPOST(req('POST', '/api/auth/register', body))
      expect(res.status).toBe(400)
      const { error } = (await res.json()) as { error: string }
      expect(error.length).toBeGreaterThan(0)
    }
  })

  test('rejects duplicate email with 409', async () => {
    const res = await registerPOST(
      req('POST', '/api/auth/register', { name: 'Maja Two', email: 'maja@test.se', password: 'supersecret1' }),
    )
    expect(res.status).toBe(409)
  })
})

describe('POST /api/auth/login', () => {
  test('returns user + token + cookie for valid credentials', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', { email: 'maja@test.se', password: 'supersecret1' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { email: string }; token: string }
    expect(body.user.email).toBe('maja@test.se')
    expect(body.token).toBeTruthy()
    expect(sessionCookie(res)).not.toBeNull()
  })

  test('401 for wrong password', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', { email: 'maja@test.se', password: 'wrongpassword' }))
    expect(res.status).toBe(401)
  })

  test('401 for unknown email', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', { email: 'nobody@test.se', password: 'whatever123' }))
    expect(res.status).toBe(401)
  })

  test('401 with friendly message for passwordless (social) accounts', async () => {
    await mkUser({ email: 'social@test.se', passwordHash: null })
    const res = await loginPOST(req('POST', '/api/auth/login', { email: 'social@test.se', password: 'whatever123' }))
    expect(res.status).toBe(401)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('Google')
  })
})

describe('POST /api/auth/logout', () => {
  test('clears the session cookie', async () => {
    const res = await logoutPOST()
    expect(res.status).toBe(200)
    const { ok } = (await res.json()) as { ok: boolean }
    expect(ok).toBe(true)
    const raw = sessionCookie(res)
    expect(raw).not.toBeNull()
    expect(raw!.value).toBe('')
    expect(raw!.options).toContain('Max-Age=0')
  })
})

describe('GET /api/auth/me', () => {
  test('returns null for anonymous callers', async () => {
    const res = await meGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toBeNull()
  })

  test('resolves via Authorization: Bearer token', async () => {
    const { id } = await mkUser({ name: 'Bearer User', karma: 30 })
    const token = createToken(id)
    mockAuth(`Bearer ${token}`)
    const res = await meGET()
    expect(res.status).toBe(200)
    const me = (await res.json()) as { id: string; trustLevel: number; trustLabel: string }
    expect(me.id).toBe(id)
    expect(me.trustLevel).toBe(1) // karma 30 → Contributor
    expect(me.trustLabel).toBe('Contributor')
  })

  test('resolves via session cookie when no bearer header is present', async () => {
    const { id } = await mkUser({ name: 'Cookie User' })
    const token = createToken(id)
    mockAuth(null, { [SESSION_COOKIE]: token })
    const res = await meGET()
    expect(res.status).toBe(200)
    const me = (await res.json()) as { id: string } | null
    expect(me?.id).toBe(id)
  })

  test('returns null for garbage and expired tokens', async () => {
    mockAuth('Bearer not-a-token')
    expect(await (await meGET()).json()).toBeNull()

    // hand-craft an expired token signed with the same secret
    const body = Buffer.from(JSON.stringify({ uid: 'someone', exp: Date.now() - 1000 })).toString('base64url')
    const sig = createHmac('sha256', process.env.AUTH_SECRET || 'etikettkontroll-dev-secret').update(body).digest('base64url')
    mockAuth(`Bearer ${body}.${sig}`)
    expect(await (await meGET()).json()).toBeNull()
  })
})
