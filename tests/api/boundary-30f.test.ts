/**
 * Task 30F regression tests — external data boundaries + query budgets.
 * Search: degenerate queries return the empty-result shape (never 500).
 * OCR: provider output is validated into a fresh allowlisted DTO.
 */
import '../setup'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GET as productsGET } from '@/app/api/products/route'
import { POST as ocrPOST } from '@/app/api/ocr/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'
import sharp from 'sharp'

beforeEach(async () => {
  await wipeDb()
})

const realFetch = global.fetch

describe('search route — budgets and degenerate queries (30F)', () => {
  test('punctuation-only query returns the empty-result shape, not a 500', async () => {
    const res = await productsGET(req('GET', '/api/products?q=%25%25%25')) // q=%%%
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number }
    expect(body.items).toEqual([])
    expect(body.total).toBe(0)
  })

  test('LIKE wildcards only (% and _) do not crash the fallback SQL', async () => {
    const res = await productsGET(req('GET', '/api/products?q=%20_%25%20'))
    expect(res.status).toBe(200)
  })

  test('Infinity and fractional page params fall back to defaults', async () => {
    const res = await productsGET(req('GET', '/api/products?page=Infinity'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: number }
    expect(body.page).toBe(1)
  })

  test('page is clamped to the 1–500 budget', async () => {
    const res = await productsGET(req('GET', '/api/products?q=oatly&page=99999'))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { page: number }
    expect(body.page).toBe(500)
  })

  test('q is capped at 256 chars', async () => {
    const long = 'a'.repeat(1000)
    const res = await productsGET(req('GET', `/api/products?q=${long}`))
    expect(res.status).toBe(200)
  })
})

describe('OCR provider output validation (30F)', () => {
  const dataUrl = (async () =>
    `data:image/png;base64,${(
      await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .png()
        .toBuffer()
    ).toString('base64')}`)()

  function mockProvider(content: string) {
    global.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })) as unknown as typeof fetch
  }

  test('extra keys, wrong types and out-of-range numbers never reach the client', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    mockProvider(
      JSON.stringify({
        ingredients: 'socker, havre',
        nutrition: {
          servingSize: '100 g',
          calories: 999_999, // out of bounds → null
          protein: '12', // string → null
          carbs: { bad: 1 }, // object → null
          sugars: 5,
          fat: -3, // negative → null
          salt: 0.25,
          hackerKey: 'injected', // extra key → dropped
        },
        modelInternalField: 'leak-attempt',
      }),
    )
    const res = await ocrPOST(req('POST', '/api/ocr', { image: await dataUrl }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body.ingredients).toBe('socker, havre')
    const nutrition = body.nutrition as Record<string, unknown>
    expect(nutrition.calories).toBeNull()
    expect(nutrition.protein).toBeNull()
    expect(nutrition.carbs).toBeNull()
    expect(nutrition.sugars).toBe(5)
    expect(nutrition.fat).toBeNull()
    expect(nutrition.salt).toBe(0.25)
    expect(Object.keys(body)).toEqual(['ingredients', 'nutrition']) // allowlisted shape
    expect('modelInternalField' in nutrition).toBe(false)
  })

  test('oversized provider response → 502, not a crash', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    global.fetch = (async () => {
      const blob = 'x'.repeat(2 * 1024 * 1024)
      return new Response(JSON.stringify({ choices: [{ message: { content: blob } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const res = await ocrPOST(req('POST', '/api/ocr', { image: await dataUrl }))
    expect(res.status).toBe(502)
  })

  afterEach(() => {
    global.fetch = realFetch
    delete process.env.OCR_API_KEY
  })
})
