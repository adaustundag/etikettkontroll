import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { GET as queueGET } from '@/app/api/queue/route'
import { POST as reviewPOST } from '@/app/api/revisions/[id]/review/route'
import { GET as productDetailGET } from '@/app/api/products/[barcode]/route'
import { POST as productsPOST } from '@/app/api/products/route'
import { createToken } from '@/lib/auth'
import { db } from '@/lib/db'
import { mockAuth, req, withParams } from '../setup'
import { evidencePhoto, mkPending, mkProduct, mkUser, submitPayload, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

async function reviewAs(userId: string, revisionId: string, body: { verdict: string; comment?: string }) {
  mockAuth(`Bearer ${createToken(userId)}`)
  return reviewPOST(req('POST', `/api/revisions/${revisionId}/review`, body), withParams({ id: revisionId }))
}

describe('GET /api/queue', () => {
  test('returns only pending revisions, newest first, with barcode and diff base', async () => {
    const owner = await mkUser()
    const authorA = await mkUser({ name: 'Author A' })
    const authorB = await mkUser({ name: 'Author B' })

    const p1 = await mkProduct({ name: 'P1 Approved', brand: 'Brand1', authorId: owner.id, ingredients: 'base value' })
    const p2 = await mkProduct({ name: 'P2 Approved', brand: 'Brand2', authorId: owner.id })
    await mkProduct({ name: 'P3 Nothing Pending', brand: 'Brand3', authorId: owner.id })

    const older = await mkPending({ productId: p1.product.id, authorId: authorA.id, name: 'P1 Pending' })
    await Bun.sleep(10)
    const newer = await mkPending({ productId: p2.product.id, authorId: authorB.id, name: 'P2 Pending' })
    void older
    void newer

    const res = await queueGET()
    expect(res.status).toBe(200)
    const items = (await res.json()) as {
      id: string
      barcode: string
      status: string
      name: string
      submittedBy: { id: string }
      current: { name: string; ingredients: string } | null
    }[]

    expect(items.length).toBe(2)
    expect(items[0].name).toBe('P2 Pending') // newest first
    expect(items[1].name).toBe('P1 Pending')
    expect(items.every((i) => i.status === 'pending')).toBe(true)
    // barcode is present end-to-end (Task 11 regression guard)
    expect(items[0].barcode).toBe(p2.product.barcode)
    expect(items[1].barcode).toBe(p1.product.barcode)
    // current approved values ride along for the diff (p1 has one, p2's approved is present too)
    expect(items[1].current?.ingredients).toBe('base value')
    expect(items[0].submittedBy.id).toBe(authorB.id)
  })
})

describe('POST /api/revisions/[id]/review — guards', () => {
  test('401 for anonymous users', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })
    const res = await reviewPOST(req('POST', `/api/revisions/${rev.id}/review`, { verdict: 'approve' }), withParams({ id: rev.id }))
    expect(res.status).toBe(401)
  })

  test('400 for an invalid verdict', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const reviewer = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    const res = await reviewAs(reviewer.id, rev.id, { verdict: 'maybe' })
    expect(res.status).toBe(400)
  })

  test('400 for comments over 500 characters', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const reviewer = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    const res = await reviewAs(reviewer.id, rev.id, { verdict: 'approve', comment: 'c'.repeat(501) })
    expect(res.status).toBe(400)
  })

  test('404 for an unknown revision', async () => {
    const reviewer = await mkUser({ karma: 100, history: { approved: 3 } })
    const res = await reviewAs(reviewer.id, 'no-such-revision', { verdict: 'approve' })
    expect(res.status).toBe(404)
  })

  test('403 while below Trusted level', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const contributor = await mkUser({ karma: 30 }) // L1
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    const res = await reviewAs(contributor.id, rev.id, { verdict: 'approve' })
    expect(res.status).toBe(403)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('Trusted')
  })

  test('403 for reviewing your own submission (even at Trusted level)', async () => {
    const owner = await mkUser()
    const trusted = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: trusted.id })

    const res = await reviewAs(trusted.id, rev.id, { verdict: 'approve' })
    expect(res.status).toBe(403)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('own')
  })

  test('409 when the revision is already finalized', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const l3 = await mkUser({ karma: 250, history: { approved: 5 } })
    const other = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    const first = await reviewAs(l3.id, rev.id, { verdict: 'approve' }) // moderator → publishes
    expect(first.status).toBe(200)

    const second = await reviewAs(other.id, rev.id, { verdict: 'approve' })
    expect(second.status).toBe(409)
  })

  test('409 when the same reviewer votes twice', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const reviewer = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id, requiredApprovals: 2 })

    await reviewAs(reviewer.id, rev.id, { verdict: 'approve' })
    const again = await reviewAs(reviewer.id, rev.id, { verdict: 'approve' })
    expect(again.status).toBe(409)
  })
})

describe('POST /api/revisions/[id]/review — the Option B happy path', () => {
  test('two Trusted approvals publish a newcomer edit: supersede, karma, denormalized product', async () => {
    const reviewerA = await mkUser({ name: 'Reviewer A', karma: 100, history: { approved: 3 } })
    const reviewerB = await mkUser({ name: 'Reviewer B', karma: 100, history: { approved: 3 } })
    const newcomer = await mkUser({ name: 'Newcomer' })

    // newcomer submits a brand-new product through the real endpoint —
    // with the evidence photos the publication gate requires
    mockAuth(`Bearer ${createToken(newcomer.id)}`)
    const barcode = '7311234567890'
    const submitRes = await productsPOST(
      req(
        'POST',
        '/api/products',
        submitPayload({
          barcode,
          name: 'Newcomer Product',
          frontImage: await evidencePhoto('front'),
          ingredientsImage: await evidencePhoto('ingredients'),
          nutritionImage: await evidencePhoto('nutrition'),
        }),
      ),
    )
    expect(submitRes.status).toBe(200)
    const { revisionId } = (await submitRes.json()) as { revisionId: string }

    // first approval — not finalized yet
    const v1 = await reviewAs(reviewerA.id, revisionId, { verdict: 'approve', comment: 'Looks right' })
    expect(v1.status).toBe(200)
    const r1 = (await v1.json()) as { finalized: boolean; status: string; approvedCount: number; reviewerKarma: number }
    expect(r1.finalized).toBe(false)
    expect(r1.status).toBe('pending')
    expect(r1.approvedCount).toBe(1)
    expect(r1.reviewerKarma).toBe(101) // 100 + 1 for the cast vote

    // nothing published yet
    mockAuth(null)
    let detail = await productDetailGET(req('GET', `/api/products/${barcode}`), withParams({ barcode }))
    let dto = (await detail.json()) as { current: { name: string; version: number } | null; reviewerCount: number }
    expect(dto.current).toBeNull()
    expect(dto.reviewerCount).toBe(0)

    // second approval — publishes
    const v2 = await reviewAs(reviewerB.id, revisionId, { verdict: 'approve' })
    expect(v2.status).toBe(200)
    const r2 = (await v2.json()) as { finalized: boolean; status: string; approvedCount: number }
    expect(r2.finalized).toBe(true)
    expect(r2.status).toBe('approved')
    expect(r2.approvedCount).toBe(2)

    // product page now shows the newcomer's version
    detail = await productDetailGET(req('GET', `/api/products/${barcode}`), withParams({ barcode }))
    dto = (await detail.json()) as { current: { name: string; version: number } | null; reviewerCount: number }
    expect(dto.current!.name).toBe('Newcomer Product')
    expect(dto.current!.version).toBe(1)
    expect(dto.reviewerCount).toBe(2)

    // submitter earned +2, reviewers earned +1 each
    const newcomerAfter = await db.user.findUnique({ where: { id: newcomer.id } })
    expect(newcomerAfter!.karma).toBe(2)
    const approveEvents = await db.karmaEvent.findMany({ where: { userId: newcomer.id, reason: 'revision_approved' } })
    expect(approveEvents.length).toBe(1)
    const reviewEvents = await db.karmaEvent.findMany({ where: { reason: 'review_cast' } })
    expect(reviewEvents.length).toBe(2)
  })

  test('a Moderator approval merges immediately (Gerrit-style +2)', async () => {
    const owner = await mkUser()
    const author = await mkUser()
    const moderator = await mkUser({ karma: 250, history: { approved: 5 } })
    const { product } = await mkProduct({ name: 'Old', brand: 'B', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id, name: 'Moderated Name' })

    const res = await reviewAs(moderator.id, rev.id, { verdict: 'approve' })
    expect(res.status).toBe(200)
    const r = (await res.json()) as { finalized: boolean; status: string; approvedCount: number }
    expect(r.finalized).toBe(true)
    expect(r.status).toBe('approved')
    expect(r.approvedCount).toBe(1)

    const updated = await db.product.findUnique({ where: { id: product.id } })
    expect(updated!.name).toBe('Moderated Name')
    const authorAfter = await db.user.findUnique({ where: { id: author.id } })
    expect(authorAfter!.karma).toBe(2)
  })

  test('publishing supersedes the previous approved revision', async () => {
    const owner = await mkUser()
    const moderator = await mkUser({ karma: 250, history: { approved: 5 } })
    const { product, revision } = await mkProduct({ name: 'V1 Name', brand: 'B', authorId: owner.id })
    const v2 = await mkPending({ productId: product.id, authorId: owner.id, name: 'V2 Name' })

    await reviewAs(moderator.id, v2.id, { verdict: 'approve' })
    const old = await db.productRevision.findUnique({ where: { id: revision.id } })
    expect(old!.status).toBe('superseded')
    const neu = await db.productRevision.findUnique({ where: { id: v2.id } })
    expect(neu!.status).toBe('approved')
    expect(neu!.finalizedAt).not.toBeNull()
  })
})

describe('POST /api/revisions/[id]/review — rejection path', () => {
  test('one Trusted reject stays pending; a Moderator reject finalizes with −1 karma', async () => {
    const owner = await mkUser()
    const author = await mkUser({ karma: 5 })
    const trusted = await mkUser({ karma: 100, history: { approved: 3 } })
    const moderator = await mkUser({ karma: 250, history: { approved: 5 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    const r1 = await reviewAs(trusted.id, rev.id, { verdict: 'reject', comment: 'Wrong brand spelling' })
    expect(r1.status).toBe(200)
    const b1 = (await r1.json()) as { finalized: boolean; status: string; rejectedCount: number }
    expect(b1.finalized).toBe(false) // L2 reject needs 2 votes
    expect(b1.status).toBe('pending')
    expect(b1.rejectedCount).toBe(1)

    const r2 = await reviewAs(moderator.id, rev.id, { verdict: 'reject' })
    const b2 = (await r2.json()) as { finalized: boolean; status: string }
    expect(b2.finalized).toBe(true)
    expect(b2.status).toBe('rejected')

    const after = await db.user.findUnique({ where: { id: author.id } })
    expect(after!.karma).toBe(4) // 5 − 1
    const events = await db.karmaEvent.findMany({ where: { userId: author.id, reason: 'revision_rejected' } })
    expect(events.length).toBe(1)
    expect(events[0].delta).toBe(-1)

    const finalized = await db.productRevision.findUnique({ where: { id: rev.id } })
    expect(finalized!.status).toBe('rejected')
    expect(finalized!.finalizedAt).not.toBeNull()
  })

  test('karma loss floors at zero (no negative karma)', async () => {
    const owner = await mkUser()
    const author = await mkUser({ karma: 0 })
    const moderator = await mkUser({ karma: 250, history: { approved: 5 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    await reviewAs(moderator.id, rev.id, { verdict: 'reject' })
    const after = await db.user.findUnique({ where: { id: author.id } })
    expect(after!.karma).toBe(0)
    const events = await db.karmaEvent.findMany({ where: { userId: author.id, reason: 'revision_rejected' } })
    expect(events.length).toBe(0) // no event when floored
  })

  test('two Trusted rejects finalize a revision without a moderator', async () => {
    const owner = await mkUser()
    const author = await mkUser({ karma: 3 })
    const trustedA = await mkUser({ karma: 100, history: { approved: 3 } })
    const trustedB = await mkUser({ karma: 100, history: { approved: 3 } })
    const { product } = await mkProduct({ name: 'X', brand: 'Y', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: author.id })

    await reviewAs(trustedA.id, rev.id, { verdict: 'reject' })
    const r2 = await reviewAs(trustedB.id, rev.id, { verdict: 'reject' })
    const b2 = (await r2.json()) as { finalized: boolean; status: string }
    expect(b2.finalized).toBe(true)
    expect(b2.status).toBe('rejected')
  })
})
