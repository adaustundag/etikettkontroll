import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { db } from '@/lib/db'
import { emailVerifiedFor } from '@/lib/verify-email'
import { GET as meGET } from '@/app/api/auth/me/route'
import { mkUser, wipeDb } from '../fixtures'
import { mockAuth } from '../setup'
import { createToken } from '@/lib/auth'

beforeEach(async () => {
  await wipeDb()
})

describe('emailVerifiedFor — derived from proof-of-ownership channels', () => {
  test('password-only registration is NOT verified', async () => {
    const u = await mkUser()
    expect(await emailVerifiedFor(u)).toBe(false)
  })

  test('a used magic link verifies the address', async () => {
    const u = await mkUser()
    await db.magicToken.create({
      data: {
        email: u.email,
        tokenHash: createHash('sha256').update('t1').digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    })
    expect(await emailVerifiedFor(u)).toBe(true)
  })

  test('an unused magic link does NOT verify', async () => {
    const u = await mkUser()
    await db.magicToken.create({
      data: {
        email: u.email,
        tokenHash: createHash('sha256').update('t2').digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
      },
    })
    expect(await emailVerifiedFor(u)).toBe(false)
  })

  test('an external identity (OAuth) verifies the address', async () => {
    const u = await mkUser()
    await db.externalIdentity.create({ data: { userId: u.id, provider: 'google', providerId: 'gid-1' } })
    expect(await emailVerifiedFor(u)).toBe(true)
  })

  test('magic link email matching tolerates casing variants', async () => {
    const u = await mkUser({ email: 'Case@Test.SE' })
    await db.magicToken.create({
      data: {
        email: 'case@test.se',
        tokenHash: createHash('sha256').update('t3').digest('hex'),
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: new Date(),
      },
    })
    expect(await emailVerifiedFor(u)).toBe(true)
  })
})

describe('GET /api/auth/me — emailVerified surfaced', () => {
  test('me reflects the derived verification state', async () => {
    const u = await mkUser({ email: 'me@test.se' })
    mockAuth(`Bearer ${createToken(u.id)}`)
    const res = await meGET()
    const body = (await res.json()) as { emailVerified: boolean }
    expect(body.emailVerified).toBe(false)

    await db.externalIdentity.create({ data: { userId: u.id, provider: 'facebook', providerId: 'fb-1' } })
    const res2 = await meGET()
    expect(((await res2.json()) as { emailVerified: boolean }).emailVerified).toBe(true)
  })
})
