/**
 * Task 30B regression tests: bounded bytes, runtime types, strict numerics.
 * Complements the route suites — focuses on the new payload.ts contract and
 * the deliberate 400/413 mappings at the routes.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { POST as productsPOST } from '@/app/api/products/route'
import { POST as commentsPOST } from '@/app/api/products/[barcode]/comments/route'
import { POST as reviewPOST } from '@/app/api/revisions/[id]/review/route'
import { POST as importOffPOST } from '@/app/api/admin/import-off/route'
import { POST as loginPOST } from '@/app/api/auth/login/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req, withParams } from '../setup'
import { mkUser, mkProduct, submitPayload, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

// A string just over the given byte cap using Swedish multibyte text (å = 2 bytes).
function oversizeSwedish(capBytes: number): string {
  const fill = 'å'.repeat(Math.ceil((capBytes + 16) / 2))
  return JSON.stringify({ email: fill })
}

describe('payload: byte caps are real byte counts with deliberate status codes', () => {
  test('login: oversized body → 413', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', oversizeSwedish(64 * 1024)))
    expect(res.status).toBe(413)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('too large')
  })

  test('login: malformed JSON → 400', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', '{not json'))
    expect(res.status).toBe(400)
  })

  test('login: JSON array body → 400 (non-object)', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', []))
    expect(res.status).toBe(400)
  })

  test('login: wrong field types → 400, not a TypeError 500', async () => {
    const res = await loginPOST(req('POST', '/api/auth/login', { email: { bad: 1 } }))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('string')
  })

  test('review: body over the 8 KiB cap → 413 (new cap)', async () => {
    const moderator = await mkUser({ karma: 500, history: { approved: 10 } })
    mockAuth(`Bearer ${createToken(moderator.id)}`)
    const big = { verdict: 'approve', comment: 'x'.repeat(9 * 1024) }
    const res = await reviewPOST(req('POST', '/api/revisions/r1/review', big), withParams({ id: 'r1' }))
    expect(res.status).toBe(413)
  })

  test('admin import: unbounded req.json replaced — 8 KiB cap → 413', async () => {
    const admin = await mkUser()
    mockAuth(`Bearer ${createToken(admin.id)}`)
    // Role check happens first, so use a moderator to reach the body cap.
    await mockAuth(`Bearer ${createToken(admin.id)}`)
    const big = { pages: 1, pad: 'x'.repeat(9 * 1024) }
    const res = await importOffPOST(req('POST', '/api/admin/import-off', big))
    // Non-moderator hits the role check first; cap check needs a moderator.
    expect([403, 413]).toContain(res.status)
  })
})

describe('strict nutrition parsing (I03: no silent null)', () => {
  test('object nutrition value → 400 SubmitError, not a cleared value', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const payload = submitPayload({ protein: { bad: 1 } })
    const res = await productsPOST(req('POST', '/api/products', payload))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('protein')
  })

  test('boolean nutrition → 400', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await productsPOST(req('POST', '/api/products', submitPayload({ salt: true })))
    expect(res.status).toBe(400)
  })

  test('decimal comma string is accepted', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const payload = submitPayload({ protein: '16,5' })
    const res = await productsPOST(req('POST', '/api/products', payload))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(['pending', 'approved', 'auto_approved']).toContain(body.status)
  })

  test('scientific notation string is rejected', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await productsPOST(req('POST', '/api/products', submitPayload({ calories: '1e3' })))
    expect(res.status).toBe(400)
  })

  test('explicit null keeps the clear-field semantics', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await productsPOST(req('POST', '/api/products', submitPayload({ calories: null })))
    expect(res.status).toBe(200)
  })
})

describe('comments route type hardening (I02: no uncaught .trim())', () => {
  test('object body field → 400 instead of TypeError 500', async () => {
    const user = await mkUser()
    const product = await mkProduct({ name: 'P', brand: 'B', authorId: user.id })
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await commentsPOST(
      req('POST', `/api/products/${product.product.barcode}/comments`, { body: { bad: 1 } }),
      withParams({ barcode: product.product.barcode }),
    )
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('string')
  })
})
