import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { POST as productsPOST } from '@/app/api/products/route'
import { POST as importPOST } from '@/app/api/admin/import-off/route'
import { createToken } from '@/lib/auth'
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

describe('authority is role-based and independent of reputation (T1)', () => {
  test('import endpoint requires the appointed role, not trust level', async () => {
    // An L3-trust user WITHOUT the role: reputation alone must not confer authority.
    const reputable = await mkUser({ name: 'Reputable', karma: 250, history: { approved: 5 } })
    await db.user.update({ where: { id: reputable.id }, data: { trustLevel: 3 } })
    mockAuth(`Bearer ${createToken(reputable.id)}`)
    const res = await importPOST(req('POST', '/api/admin/import-off', {}))
    expect(res.status).toBe(403)
  })
})

