import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { GET as changesGET } from '@/app/api/changes/route'
import { db } from '@/lib/db'
import { req } from '../setup'
import { mkProduct, mkUser, uniqBarcode, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

type ChangesResponse = {
  items: {
    id: string
    productName: string
    barcode: string
    version: number
    status: string
    userName: string
    userId: string
    createdAt: string
    changes: { field: string; from: string | null; to: string | null }[]
  }[]
  page: number
  hasMore: boolean
}

describe('GET /api/changes — public change stream', () => {
  test('lists only published revisions, newest first, with field-level diffs', async () => {
    const author = await mkUser()
    const { product } = await mkProduct({ name: 'Feed One', brand: 'A', authorId: author.id })

    // approved v2: protein set — diff vs v1 must appear
    await db.productRevision.create({
      data: {
        productId: product.id,
        version: 2,
        submittedById: author.id,
        name: 'Feed One',
        brand: 'A',
        ingredients: 'water, salt',
        protein: 15.8,
        status: 'approved',
        changedFields: JSON.stringify(['protein', 'frontImage']),
        finalizedAt: new Date(Date.now() + 5000),
      },
    })

    // pending and rejected must NOT appear
    await db.productRevision.create({
      data: {
        productId: product.id,
        version: 3,
        submittedById: author.id,
        name: 'Feed One',
        brand: 'A',
        ingredients: 'water, salt, pepper',
        status: 'pending',
      },
    })
    const other = await mkProduct({ name: 'Feed Two', brand: 'B', authorId: author.id })
    await db.productRevision.create({
      data: {
        productId: other.product.id,
        version: 2,
        submittedById: author.id,
        name: 'Feed Two',
        brand: 'B',
        ingredients: 'water',
        status: 'rejected',
        finalizedAt: new Date(),
      },
    })

    const res = await changesGET(req('GET', '/api/changes'))
    expect(res.status).toBe(200)
    const dto = (await res.json()) as ChangesResponse

    // only the two published v1 rows + the approved v2 — rejected/pending excluded
    expect(dto.items.length).toBe(3)
    expect(dto.items[0].version).toBe(2)
    expect(dto.items[0].productName).toBe('Feed One')
    expect(dto.page).toBe(1)
    expect(dto.hasMore).toBe(false)

    // v2 diff: protein 16-ish chip, image field excluded
    expect(dto.items[0].changes.some((c) => c.field === 'protein' && c.to === '15.8 g')).toBe(true)
    expect(dto.items[0].changes.some((c) => c.field === 'frontImage')).toBe(false)

    // v1 rows have no diff (no previous snapshot)
    expect(dto.items.filter((i) => i.version === 1).every((i) => i.changes.length === 0)).toBe(true)
    expect(dto.items.every((i) => i.userName === 'Test User')).toBe(true)
    expect(dto.items.every((i) => i.barcode.length > 0)).toBe(true)
  })

  test('paginates 20 per page with hasMore flag', async () => {
    const author = await mkUser()
    for (let i = 0; i < 21; i++) {
      await mkProduct({ name: `Page product ${i}`, brand: 'P', authorId: author.id, barcode: uniqBarcode() })
    }

    const page1 = (await (await changesGET(req('GET', '/api/changes'))).json()) as ChangesResponse
    expect(page1.items.length).toBe(20)
    expect(page1.hasMore).toBe(true)

    const page2 = (await (await changesGET(req('GET', '/api/changes?page=2'))).json()) as ChangesResponse
    expect(page2.items.length).toBe(1)
    expect(page2.hasMore).toBe(false)
    // no overlap between pages
    const ids1 = new Set(page1.items.map((i) => i.id))
    expect(page2.items.every((i) => !ids1.has(i.id))).toBe(true)
  })

  test('clamps malformed page params into the valid range', async () => {
    const author = await mkUser()
    await mkProduct({ name: 'Clamp One', brand: 'C', authorId: author.id })
    for (const bad of ['abc', '-5', '0']) {
      const res = await changesGET(req('GET', `/api/changes?page=${bad}`))
      const dto = (await res.json()) as ChangesResponse
      expect(dto.page).toBe(1)
      expect(dto.items.length).toBeGreaterThan(0)
    }
    // absurdly large pages clamp to the server max instead of 500ing on skip
    const big = (await (await changesGET(req('GET', '/api/changes?page=999999'))).json()) as ChangesResponse
    expect(big.page).toBe(500)
    expect(big.items.length).toBe(0)
  })
})
