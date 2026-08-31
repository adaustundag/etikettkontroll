import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { GET as productsGET, POST as productsPOST } from '@/app/api/products/route'
import { GET as productDetailGET } from '@/app/api/products/[barcode]/route'
import { POST as commentsPOST } from '@/app/api/products/[barcode]/comments/route'
import { createToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { mockAuth, req, withParams } from '../setup'
import { mkProduct, mkUser, submitPayload, uniqBarcode, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

describe('GET /api/products — search', () => {
  test('lists products when q is empty', async () => {
    const author = await mkUser()
    await mkProduct({ name: 'Oatly Barista Oat Drink', brand: 'Oatly', authorId: author.id })
    await Bun.sleep(10) // distinct updatedAt for deterministic ordering
    await mkProduct({ name: 'Kalles Kaviar', brand: 'Kalles', authorId: author.id, frontImage: '/uploads/x.jpg' })

    const res = await productsGET(req('GET', '/api/products'))
    expect(res.status).toBe(200)
    const items = (await res.json()) as { barcode: string; name: string; brand: string; hasImage: boolean; approvedCount: number }[]
    expect(items.length).toBe(2)
    // newest updated first
    expect(items[0].name).toBe('Kalles Kaviar')
    expect(items[1].name).toBe('Oatly Barista Oat Drink')
    expect(items.find((i) => i.name === 'Kalles Kaviar')!.hasImage).toBe(true)
    expect(items.every((i) => i.approvedCount === 1)).toBe(true)
  })

  test('search is case-insensitive on name and brand', async () => {
    const author = await mkUser()
    const p = await mkProduct({ name: 'Oatly Barista Oat Drink', brand: 'Oatly', authorId: author.id })
    await mkProduct({ name: 'Kalles Kaviar', brand: 'Kalles', authorId: author.id })

    const res = await productsGET(req('GET', '/api/products?q=oatly'))
    const items = (await res.json()) as { barcode: string }[]
    expect(items.length).toBe(1)
    expect(items[0].barcode).toBe(p.product.barcode)

    const res2 = await productsGET(req('GET', '/api/products?q=KALLE'))
    const items2 = (await res2.json()) as { name: string }[]
    expect(items2.length).toBe(1)
    expect(items2[0].name).toBe('Kalles Kaviar')
  })

  test('search matches full barcode and digit substrings', async () => {
    const author = await mkUser()
    const p = await mkProduct({ name: 'Wasa Filo', brand: 'Wasa', barcode: '7300401234567', authorId: author.id })

    const full = await productsGET(req('GET', `/api/products?q=${p.product.barcode}`))
    expect(((await full.json()) as { barcode: string }[]).length).toBe(1)

    const partial = await productsGET(req('GET', '/api/products?q=4012345'))
    expect(((await partial.json()) as { barcode: string }[]).length).toBe(1)

    const none = await productsGET(req('GET', '/api/products?q=9999999'))
    expect(await none.json()).toEqual([])
  })

  test('SQL wildcards in q are treated literally', async () => {
    const author = await mkUser()
    await mkProduct({ name: 'Oatly 50% Less Sugar', brand: 'Oatly', authorId: author.id })
    await mkProduct({ name: 'Kalles Kaviar', brand: 'Kalles', authorId: author.id })

    // "50%" must not become a LIKE wildcard — it should find only the one product
    const res = await productsGET(req('GET', '/api/products?q=50%'))
    const items = (await res.json()) as { name: string }[]
    expect(items.length).toBe(1)
    expect(items[0].name).toBe('Oatly 50% Less Sugar')
  })
})

describe('GET /api/products/[barcode] — detail', () => {
  test('returns product, current revision, history, comments and counters', async () => {
    const author = await mkUser()
    const { product } = await mkProduct({
      name: 'Garant Krossade Tomater',
      brand: 'Garant',
      authorId: author.id,
      ingredients: 'krossade tomater, citronsyra',
    })
    await db.productComment.create({
      data: { productId: product.id, userId: author.id, body: 'Great base for pasta!' },
    })
    await db.productRevision.create({
      data: {
        productId: product.id,
        version: 2,
        submittedById: author.id,
        name: 'Garant Krossade Tomater 400g',
        brand: 'Garant',
        ingredients: 'krossade tomater, citronsyra',
        status: 'pending',
      },
    })

    const res = await productDetailGET(req('GET', `/api/products/${product.barcode}`), withParams({ barcode: product.barcode }))
    expect(res.status).toBe(200)
    const dto = (await res.json()) as {
      product: { barcode: string; name: string }
      current: { version: number; name: string; ingredients: string } | null
      revisions: { id: string; version: number; barcode: string }[]
      comments: { body: string; user: { trustLabel: string } }[]
      reviewerCount: number
      pendingCount: number
    }
    expect(dto.product.barcode).toBe(product.barcode)
    expect(dto.current).not.toBeNull()
    expect(dto.current!.version).toBe(1)
    expect(dto.current!.ingredients).toBe('krossade tomater, citronsyra')
    expect(dto.revisions.length).toBe(2) // v1 approved + v2 pending, newest first
    expect(dto.revisions[0].version).toBe(2)
    // every revision carries the parent barcode (regression guard for Task 11)
    expect(dto.revisions.every((r) => r.barcode === product.barcode)).toBe(true)
    expect(dto.comments.length).toBe(1)
    expect(dto.comments[0].body).toBe('Great base for pasta!')
    expect(dto.pendingCount).toBe(1)
    expect(dto.reviewerCount).toBe(0)
  })

  test('404 for an unknown barcode', async () => {
    const res = await productDetailGET(req('GET', '/api/products/0000000000000'), withParams({ barcode: '0000000000000' }))
    expect(res.status).toBe(404)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('not found')
  })
})

describe('POST /api/products/[barcode]/comments', () => {
  test('401 for anonymous users', async () => {
    const res = await commentsPOST(req('POST', '/api/products/123/comment', { body: 'hello' }), withParams({ barcode: '123' }))
    expect(res.status).toBe(401)
  })

  test('400 for too-short and too-long comments', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const short = await commentsPOST(req('POST', '/api/products/123/comments', { body: 'x' }), withParams({ barcode: '123' }))
    expect(short.status).toBe(400)

    const long = await commentsPOST(
      req('POST', '/api/products/123/comments', { body: 'a'.repeat(1001) }),
      withParams({ barcode: '123' }),
    )
    expect(long.status).toBe(400)
  })

  test('404 for an unknown product', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await commentsPOST(req('POST', '/api/products/123/comments', { body: 'nice product' }), withParams({ barcode: '123' }))
    expect(res.status).toBe(404)
  })

  test('creates a comment and returns the DTO', async () => {
    const author = await mkUser()
    const commenter = await mkUser({ name: 'Commenter' })
    const { product } = await mkProduct({ name: 'Marabou Mjölkchoklad', brand: 'Marabou', authorId: author.id })

    mockAuth(`Bearer ${createToken(commenter.id)}`)
    const res = await commentsPOST(
      req('POST', `/api/products/${product.barcode}/comments`, { body: '  Contains milk?  ' }),
      withParams({ barcode: product.barcode }),
    )
    expect(res.status).toBe(200)
    const dto = (await res.json()) as { id: string; body: string; user: { id: string; name: string } }
    expect(dto.body).toBe('Contains milk?') // trimmed
    expect(dto.user.id).toBe(commenter.id)

    const rows = await db.productComment.findMany({ where: { productId: product.id } })
    expect(rows.length).toBe(1)
  })
})

describe('POST /api/products — auth + validation', () => {
  test('401 for anonymous users', async () => {
    const res = await productsPOST(req('POST', '/api/products', submitPayload()))
    expect(res.status).toBe(401)
  })

  test('400 for barcodes that are not 8–14 digits', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    for (const barcode of ['abc12345', '123', '12345678901234567']) {
      const res = await productsPOST(req('POST', '/api/products', submitPayload({ barcode })))
      expect(res.status).toBe(400)
      const { error } = (await res.json()) as { error: string }
      expect(error).toContain('8–14')
    }
  })

  test('400 when name, brand or ingredients are missing', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const noName = await productsPOST(req('POST', '/api/products', submitPayload({ name: '' })))
    expect((await noName.json()) as { error: string }).toBeTruthy()
    const noBrand = await productsPOST(req('POST', '/api/products', submitPayload({ brand: '' })))
    expect(noBrand.status).toBe(400)
    const tinyIngredients = await productsPOST(req('POST', '/api/products', submitPayload({ ingredients: 'abc' })))
    expect(tinyIngredients.status).toBe(400)
  })
})

describe('POST /api/products — new product creation (L0 author)', () => {
  test('creates product + pending revision needing 2 approvals', async () => {
    const author = await mkUser() // karma 0 → L0
    mockAuth(`Bearer ${createToken(author.id)}`)
    const barcode = uniqBarcode()
    const res = await productsPOST(
      req('POST', '/api/products', submitPayload({ barcode, name: 'Felix Ketchup', brand: 'Felix' })),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; requiredApprovals: number; version: number; barcode: string; productId: string }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(2)
    expect(body.version).toBe(1)
    expect(body.barcode).toBe(barcode)

    const product = await db.product.findUnique({ where: { barcode }, include: { revisions: true } })
    expect(product).not.toBeNull()
    expect(product!.revisions.length).toBe(1)
    expect(product!.revisions[0].status).toBe('pending')
    expect(product!.revisions[0].submittedById).toBe(author.id)
  })

  test('barcode whitespace is stripped', async () => {
    const author = await mkUser()
    mockAuth(`Bearer ${createToken(author.id)}`)
    const barcode = uniqBarcode()
    const res = await productsPOST(
      req('POST', '/api/products', submitPayload({ barcode: `  ${barcode.slice(0, 6)} ${barcode.slice(6)}  ` })),
    )
    expect(res.status).toBe(200)
    const product = await db.product.findUnique({ where: { barcode } })
    expect(product).not.toBeNull()
  })
})
