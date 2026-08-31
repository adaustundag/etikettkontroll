import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import { GET as userGET } from '@/app/api/users/[id]/route'
import { GET as statsGET } from '@/app/api/stats/route'
import { GET as healthGET } from '@/app/api/route'
import { db } from '@/lib/db'
import { req, withParams } from '../setup'
import { mkPending, mkProduct, mkUser, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

describe('GET /api/users/[id] — public profile', () => {
  test('404 for unknown user', async () => {
    const res = await userGET(req('GET', '/api/users/missing'), withParams({ id: 'missing' }))
    expect(res.status).toBe(404)
  })

  test('returns profile with derived trust, contributions (with barcodes) and review count', async () => {
    const owner = await mkUser()
    const reviewer = await mkUser({ name: 'Prolific Reviewer', karma: 120, history: { approved: 4 } })

    const { product } = await mkProduct({ name: 'Profile Product', brand: 'P', authorId: owner.id })
    const rev = await mkPending({ productId: product.id, authorId: reviewer.id })
    await db.review.create({
      data: { revisionId: rev.id, reviewerId: reviewer.id, verdict: 'approve', comment: 'ok' },
    })

    const res = await userGET(req('GET', `/api/users/${reviewer.id}`), withParams({ id: reviewer.id }))
    expect(res.status).toBe(200)
    const dto = (await res.json()) as {
      user: { id: string; name: string; karma: number; trustLevel: number; trustLabel: string }
      email: string
      createdAt: string
      reviewsCast: number
      contributions: { id: string; barcode: string; reviews: { verdict: string; comment: string | null }[] }[]
    }
    expect(dto.user.id).toBe(reviewer.id)
    expect(dto.user.karma).toBe(120)
    expect(dto.user.trustLevel).toBe(2)
    expect(dto.user.trustLabel).toBe('Trusted')
    expect(dto.email).toBe(reviewer.email)
    expect(new Date(dto.createdAt).getTime()).toBeTruthy()
    expect(dto.reviewsCast).toBe(1)
    expect(dto.contributions.length).toBeGreaterThanOrEqual(5) // 4 history + 1 pending
    expect(dto.contributions.every((c) => c.barcode.length > 0)).toBe(true) // Task 11 regression guard
    const pendingContrib = dto.contributions.find((c) => c.id === rev.id)
    expect(pendingContrib).toBeTruthy()
    expect(pendingContrib!.reviews[0].verdict).toBe('approve')
    expect(pendingContrib!.reviews[0].comment).toBe('ok')
  })
})

describe('GET /api/stats — landing page counters', () => {
  test('returns counts and recent activity', async () => {
    const authorA = await mkUser()
    const authorB = await mkUser()

    const p1 = await mkProduct({ name: 'Stats One', brand: 'S', authorId: authorA.id })
    await mkProduct({ name: 'Stats Two', brand: 'S', authorId: authorB.id })
    await mkPending({ productId: p1.product.id, authorId: authorB.id })

    const res = await statsGET()
    expect(res.status).toBe(200)
    const dto = (await res.json()) as {
      products: number
      contributors: number
      pendingCount: number
      approvedCount: number
      recent: { productName: string; barcode: string; userName: string; status: string }[]
    }
    expect(dto.products).toBe(2)
    expect(dto.contributors).toBe(2)
    expect(dto.pendingCount).toBe(1)
    expect(dto.approvedCount).toBe(2)
    expect(dto.recent.length).toBeGreaterThanOrEqual(1)
    expect(dto.recent[0].barcode).toBeTruthy()
    expect(dto.recent[0].productName).toBeTruthy()
    expect(dto.recent[0].userName).toBeTruthy()
  })
})

describe('GET /api — health', () => {
  test('responds with the hello message', async () => {
    const res = await healthGET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ message: 'Hello, world!' })
  })
})
