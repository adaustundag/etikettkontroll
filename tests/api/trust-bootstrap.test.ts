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

describe('T3 - no automatic publication for newcomers', () => {
  test('L0 newcomer: calories-only correction stays pending (bypass removed)', async () => {
    const author = await mkUser()
    const newcomer = await mkUser({ name: 'Newcomer' })
    const { product, revision } = await mkProduct({
      name: 'Arla Ko Mellanmjolk 3%',
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
        baseRevisionId: revision.id,
      })),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; autoNote: string | null; requiredApprovals: number }
    expect(body.status).toBe('pending')
    expect(body.autoNote).toBeNull()
    expect(body.requiredApprovals).toBe(2)
  })

  test('L0 newcomer: name change still requires review', async () => {
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
        baseRevisionId: revision.id,
      })),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; requiredApprovals: number }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(2)
  })
})
