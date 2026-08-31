import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { POST as productsPOST } from '@/app/api/products/route'
import { GET as productDetailGET } from '@/app/api/products/[barcode]/route'
import { createToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { mockAuth, req, withParams } from '../setup'
import { mkProduct, mkUser, submitPayload, uniqBarcode, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

async function submitAs(userId: string, payload: Record<string, unknown>) {
  mockAuth(`Bearer ${createToken(userId)}`)
  const res = await productsPOST(req('POST', '/api/products', payload))
  return res
}

describe('POST /api/products — Option B karma behavior', () => {
  test('L0 newcomer: edit of an existing product stays pending with 2 required approvals', async () => {
    const owner = await mkUser()
    const newcomer = await mkUser({ name: 'Newcomer' })
    const { product, revision } = await mkProduct({
      name: 'Arla Ecological Milk',
      brand: 'Arla',
      authorId: owner.id,
      ingredients: 'milk',
    })

    const res = await submitAs(newcomer.id, submitPayload({ barcode: product.barcode, name: 'Arla Ekologisk Mjölk' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; requiredApprovals: number; version: number }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(2)
    expect(body.version).toBe(2)

    const revisions = await db.productRevision.findMany({ where: { productId: product.id }, orderBy: { version: 'desc' } })
    expect(revisions.length).toBe(2)
    expect(revisions[0].status).toBe('pending')
    expect(revisions[0].submittedById).toBe(newcomer.id)
    expect(JSON.parse(revisions[0].changedFields)).toContain('name')
    // the previous approved revision is untouched until review
    expect(revisions[1].status).toBe('approved')
    expect(revisions[1].id).toBe(revision.id)

    // product page still shows the approved version as current
    mockAuth(null)
    const detail = await productDetailGET(req('GET', `/api/products/${product.barcode}`), withParams({ barcode: product.barcode }))
    const dto = (await detail.json()) as { current: { version: number } | null; pendingCount: number }
    expect(dto.current!.version).toBe(1)
    expect(dto.pendingCount).toBe(1)
  })

  test('L0 edit with no changes vs current approved version is rejected', async () => {
    const owner = await mkUser()
    const newcomer = await mkUser()
    const { product } = await mkProduct({ name: 'Wasa Filo', brand: 'Wasa', authorId: owner.id })

    const res = await submitAs(newcomer.id, submitPayload({ barcode: product.barcode, name: 'Wasa Filo', brand: 'Wasa', ingredients: 'water, salt' }))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('No changes')
  })

  test('L1 contributor: single-field correction auto-publishes, supersedes and awards karma', async () => {
    const owner = await mkUser()
    const contributor = await mkUser({ name: 'Contributor', karma: 30 }) // → L1
    const { product, revision } = await mkProduct({
      name: 'Kalles Kaviar',
      brand: 'Kalles',
      authorId: owner.id,
      ingredients: 'sill, salt, socker',
    })

    // only `calories` differs from the approved revision
    const res = await submitAs(
      contributor.id,
      submitPayload({
        barcode: product.barcode,
        name: 'Kalles Kaviar',
        brand: 'Kalles',
        ingredients: 'sill, salt, socker',
        calories: 252,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; autoNote: string | null; requiredApprovals: number }
    expect(body.status).toBe('auto_approved')
    expect(body.requiredApprovals).toBe(0)
    expect(body.autoNote).toContain('single-field')

    const oldRev = await db.productRevision.findUnique({ where: { id: revision.id } })
    expect(oldRev!.status).toBe('superseded')
    const newRev = await db.productRevision.findFirst({ where: { productId: product.id, version: 2 } })
    expect(newRev!.status).toBe('auto_approved')
    expect(newRev!.calories).toBe(252)

    // author karma 30 → 32 with a karma event
    const after = await db.user.findUnique({ where: { id: contributor.id } })
    expect(after!.karma).toBe(32)
    const events = await db.karmaEvent.findMany({ where: { userId: contributor.id, reason: 'revision_approved' } })
    expect(events.length).toBe(1)
    expect(events[0].delta).toBe(2)
  })

  test('L1 contributor: multi-field edit still requires one approval', async () => {
    const owner = await mkUser()
    const contributor = await mkUser({ karma: 30 })
    const { product } = await mkProduct({ name: 'Old Name', brand: 'Brand X', authorId: owner.id })

    const res = await submitAs(contributor.id, submitPayload({ barcode: product.barcode, name: 'New Name', calories: 100 }))
    const body = (await res.json()) as { status: string; requiredApprovals: number }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(1)
  })

  test('L2 trusted: everything auto-publishes immediately', async () => {
    const trusted = await mkUser({ name: 'Trusted User', karma: 100, history: { approved: 3 } })
    expect(trusted.trust.level).toBe(2)

    const barcode = uniqBarcode()
    const res = await submitAs(trusted.id, submitPayload({ barcode, name: 'Instant Product', brand: 'Fast' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; autoNote: string | null }
    expect(body.status).toBe('auto_approved')
    expect(body.autoNote).toContain('Trusted')

    const product = await db.product.findUnique({ where: { barcode } })
    expect(product!.name).toBe('Instant Product')
  })

  test('numeric strings like "42,5" are coerced to numbers', async () => {
    const trusted = await mkUser({ karma: 100, history: { approved: 3 } })
    const barcode = uniqBarcode()
    await submitAs(trusted.id, submitPayload({ barcode, calories: '42,5' }))
    const rev = await db.productRevision.findFirst({ where: { product: { barcode } } })
    expect(rev!.calories).toBe(42.5)
  })

  test('images and servingSize persist through submission', async () => {
    const trusted = await mkUser({ karma: 100, history: { approved: 3 } })
    const barcode = uniqBarcode()
    await submitAs(
      trusted.id,
      submitPayload({ barcode, servingSize: '100 g', frontImage: '/uploads/front.jpg' }),
    )
    const rev = await db.productRevision.findFirst({ where: { product: { barcode } } })
    expect(rev!.servingSize).toBe('100 g')
    expect(rev!.frontImage).toBe('/uploads/front.jpg')
  })
})
