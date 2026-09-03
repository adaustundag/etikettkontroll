import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { POST as productsPOST } from '@/app/api/products/route'
import { POST as reviewPOST } from '@/app/api/revisions/[id]/review/route'
import { GET as productDetailGET } from '@/app/api/products/[barcode]/route'
import { createToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { mockAuth, req, withParams } from '../setup'
import { evidencePhoto, mkProduct, mkUser, submitPayload, uniqBarcode, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

async function submitAs(userId: string, payload: Record<string, unknown>) {
  mockAuth(`Bearer ${createToken(userId)}`)
  const res = await productsPOST(req('POST', '/api/products', payload))
  return res
}

async function reviewAs(reviewerId: string, revisionId: string, body: Record<string, unknown>) {
  mockAuth(`Bearer ${createToken(reviewerId)}`)
  return reviewPOST(req('POST', `/api/revisions/${revisionId}/review`, body), withParams({ id: revisionId }))
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

    const res = await submitAs(newcomer.id, submitPayload({ barcode: product.barcode, name: 'Arla Ekologisk Mjölk', baseRevisionId: revision.id }))
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

  test('L1 contributor: single-field correction stays pending (no auto-publish bypass)', async () => {
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
        baseRevisionId: revision.id,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; autoNote: string | null; requiredApprovals: number }
    // T3: no publication bypasses — reputation prioritizes review, never replaces it
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(1)
    expect(body.autoNote).toBeNull()

    const oldRev = await db.productRevision.findUnique({ where: { id: revision.id } })
    expect(oldRev!.status).toBe('approved') // untouched until review
    const newRev = await db.productRevision.findFirst({ where: { productId: product.id, version: 2 } })
    expect(newRev!.status).toBe('pending')
    expect(newRev!.calories).toBe(252)

    // no karma until a review publishes it
    const after = await db.user.findUnique({ where: { id: contributor.id } })
    expect(after!.karma).toBe(30)
    const events = await db.karmaEvent.findMany({ where: { userId: contributor.id, reason: 'revision_approved' } })
    expect(events.length).toBe(0)
  })

  test('L1 contributor: multi-field edit requires one approval', async () => {
    const owner = await mkUser()
    const contributor = await mkUser({ karma: 30 })
    const { product, revision } = await mkProduct({ name: 'Old Name', brand: 'Brand X', authorId: owner.id })

    const res = await submitAs(contributor.id, submitPayload({ barcode: product.barcode, name: 'New Name', calories: 100, baseRevisionId: revision.id }))
    const body = (await res.json()) as { status: string; requiredApprovals: number }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(1)
  })

  test('L2 trusted: submissions also enter review (no high-reputation bypass)', async () => {
    const trusted = await mkUser({ name: 'Trusted User', karma: 100, history: { approved: 3 } })
    expect(trusted.trust.level).toBe(2)

    const barcode = uniqBarcode()
    const res = await submitAs(trusted.id, submitPayload({ barcode, name: 'Instant Product', brand: 'Fast' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; autoNote: string | null; requiredApprovals: number }
    expect(body.status).toBe('pending')
    expect(body.requiredApprovals).toBe(1)
    expect(body.autoNote).toBeNull()

    const product = await db.product.findUnique({ where: { barcode } })
    expect(product!.name).toBe('Instant Product') // denormalized name from submission
    expect(product!.currentRevisionId).toBeNull() // not published yet
  })

  test('stale base revision is a conflict, not a silent overwrite', async () => {
    const owner = await mkUser()
    const editorA = await mkUser({ name: 'Editor A' })
    const reviewer = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product, revision } = await mkProduct({ name: 'Base Product', brand: 'Brand', authorId: owner.id })

    // editor A submits (with evidence) against the true base...
    const resA = await submitAs(
      editorA.id,
      submitPayload({
        barcode: product.barcode,
        name: 'Editor A Version',
        baseRevisionId: revision.id,
        frontImage: await evidencePhoto('front'),
        ingredientsImage: await evidencePhoto('ingredients'),
        nutritionImage: await evidencePhoto('nutrition'),
      }),
    )
    expect(resA.status).toBe(200)
    const a = (await resA.json()) as { revisionId: string }

    // ...two Trusted reviews publish it, moving the canonical pointer to v2...
    const pub1 = await reviewAs(reviewer.id, a.revisionId, { verdict: 'approve' })
    expect(pub1.status).toBe(200)
    const reviewerB = await mkUser({ karma: 100, history: { approved: 3 } })
    const pub2 = await reviewAs(reviewerB.id, a.revisionId, { verdict: 'approve' })
    expect(pub2.status).toBe(200)
    const pub2Body = (await pub2.json()) as { finalized: boolean }
    expect(pub2Body.finalized).toBe(true)

    // ...editor B now submits claiming the OLD base — 409 conflict
    const editorB = await mkUser({ name: 'Editor B' })
    const resB = await submitAs(
      editorB.id,
      submitPayload({ barcode: product.barcode, name: 'Editor B Version', baseRevisionId: revision.id }),
    )
    expect(resB.status).toBe(409)
    const body = (await resB.json()) as { conflict: boolean; currentRevisionId: string | null }
    expect(body.conflict).toBe(true)
    expect(body.currentRevisionId).toBe(a.revisionId)
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
