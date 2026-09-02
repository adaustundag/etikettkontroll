import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { POST as productsPOST } from '@/app/api/products/route'
import { createToken } from '@/lib/auth'
import { computeTrust, TRUST_THRESHOLDS } from '@/lib/trust'
import { db } from '@/lib/db'
import { mockAuth, req } from '../setup'
import { mkProduct, mkUser, submitPayload, uniqBarcode, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

describe('deadlock relief — single nutrition-field corrections auto-publish', () => {
  test('L0 newcomer: calories-only correction publishes instantly', async () => {
    const author = await mkUser()
    const newcomer = await mkUser({ name: 'Newcomer' })
    const { product, revision } = await mkProduct({
      name: 'Arla Ko Mellanmjölk 3%',
      brand: 'Arla',
      barcode: uniqBarcode(),
      authorId: author.id,
      ingredients: 'water, salt',
    })
    mockAuth(`Bearer ${createToken(newcomer.id)}`)

    const res = await productsPOST(
      req('POST', '/api/products', submitPayload({
        barcode: product.barcode,
        name: revision.name,
        brand: revision.brand,
        ingredients: revision.ingredients,
        calories: '47',
      })),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; autoNote: string | null }
    expect(body.status).toBe('auto_approved')
    expect(body.autoNote).toContain('nutrition-field')

    const live = await db.productRevision.findFirst({
      where: { productId: product.id, status: 'auto_approved' },
      orderBy: { version: 'desc' },
    })
    expect(live!.calories).toBe(47)
  })

  test('L0 newcomer: name (or ingredients) change still requires review', async () => {
    const author = await mkUser()
    const newcomer = await mkUser({ name: 'Newcomer 2' })
    const { product, revision } = await mkProduct({
      name: 'Original Name',
      brand: 'Brand',
      barcode: uniqBarcode(),
      authorId: author.id,
      ingredients: 'water, salt',
    })
    mockAuth(`Bearer ${createToken(newcomer.id)}`)

    const res = await productsPOST(
      req('POST', '/api/products', submitPayload({
        barcode: product.barcode,
        name: 'Renamed Product',
        brand: revision.brand,
        ingredients: revision.ingredients,
      })),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; requiredApprovals: number }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(2)
  })

  test('L0 newcomer: two changed fields (calories + salt) still requires review', async () => {
    const author = await mkUser()
    const newcomer = await mkUser({ name: 'Newcomer 3' })
    const { product, revision } = await mkProduct({
      name: 'Two Field Product',
      brand: 'Brand',
      barcode: uniqBarcode(),
      authorId: author.id,
      ingredients: 'water, salt',
    })
    mockAuth(`Bearer ${createToken(newcomer.id)}`)

    const res = await productsPOST(
      req('POST', '/api/products', submitPayload({
        barcode: product.barcode,
        name: revision.name,
        brand: revision.brand,
        ingredients: revision.ingredients,
        calories: '50',
        salt: '0.2',
      })),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('pending')
  })

  test('brand-new products still require review for newcomers', async () => {
    const newcomer = await mkUser({ name: 'Newcomer 4' })
    mockAuth(`Bearer ${createToken(newcomer.id)}`)
    const res = await productsPOST(req('POST', '/api/products', submitPayload({ barcode: uniqBarcode(), calories: '100' })))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('pending')
  })
})

describe('bootstrapFirstModerator — first account on a fresh deployment', () => {
  test('computeTrust keeps the bootstrap grant at L3 after recompute', async () => {
    const first = await mkUser({ name: 'Bootstrapped' })
    // simulate what register/oauth/magic paths do
    const { bootstrapFirstModerator } = await import('@/lib/trust')
    const granted = await bootstrapFirstModerator(first.id)
    expect(granted).toBe(true)

    // recompute would normally demote karma-250/no-history users — grant survives
    const info = await computeTrust(first.id)
    expect(info.level).toBe(3)
    expect(info.label).toBe('Moderator')
  })

  test('does not fire when a moderator already exists', async () => {
    const existing = await mkUser({ name: 'Already Mod', karma: TRUST_THRESHOLDS.moderator })
    await db.user.update({ where: { id: existing.id }, data: { trustLevel: 3 } })

    const newcomer = await mkUser({ name: 'Late User' })
    const { bootstrapFirstModerator } = await import('@/lib/trust')
    expect(await bootstrapFirstModerator(newcomer.id)).toBe(false)
    const row = await db.user.findUnique({ where: { id: newcomer.id } })
    expect(row!.trustLevel).toBe(0)
  })

  test('is idempotent per user', async () => {
    const first = await mkUser({ name: 'Once Only' })
    const { bootstrapFirstModerator } = await import('@/lib/trust')
    expect(await bootstrapFirstModerator(first.id)).toBe(true)
    expect(await bootstrapFirstModerator(first.id)).toBe(false)
    const row = await db.user.findUnique({ where: { id: first.id } })
    expect(row!.karma).toBe(TRUST_THRESHOLDS.moderator)
  })
})
