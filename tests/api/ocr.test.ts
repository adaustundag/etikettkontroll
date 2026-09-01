import '../setup'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { GET as ocrGET, POST as ocrPOST } from '@/app/api/ocr/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

const realFetch = global.fetch
afterEach(() => {
  global.fetch = realFetch
  delete process.env.OCR_API_KEY
  delete process.env.OCR_BASE_URL
  delete process.env.OCR_MODEL
})

/** Fixed vision-provider reply matching what the prompt asks for. */
const providerJson = JSON.stringify({
  ingredients: 'sugar, wheat flour, cocoa butter, milk powder, salt, vanilla.',
  nutrition: { servingSize: '1 kaka (25 g)', calories: 520, protein: 7, carbs: 60, sugars: 55, fat: 28, salt: 0.25 },
})

function mockProvider(reply: string | { status: number }) {
  global.fetch = (async () => {
    if (typeof reply === 'object') return new Response('provider down', { status: reply.status })
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), { status: 200 })
  }) as unknown as typeof fetch
}

describe('GET /api/ocr — availability probe', () => {
  test('available:true when OCR_API_KEY is set', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const res = await ocrGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: boolean }
    expect(body.available).toBe(true)
  })

  test('available:false when OCR_API_KEY is unset', async () => {
    const res = await ocrGET()
    expect(res.status).toBe(200)
    const body = (await res.json()) as { available: boolean }
    expect(body.available).toBe(false)
  })
})

describe('POST /api/ocr — AI label auto-fill', () => {
  test('401 for anonymous users', async () => {
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(401)
  })

  test('503 when no vision provider is configured', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(503)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('not configured')
  })

  test('400 when the body is not an image data URL', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'not-a-data-url' }))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('data URL')
  })

  test('502 when the vision provider fails', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    mockProvider({ status: 500 })
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(502)
  })

  test('parses the provider reply into ingredients + nutrition', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    mockProvider(providerJson)

    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ingredients: string | null
      nutrition: {
        servingSize: string | null
        calories: number | null
        protein: number | null
        carbs: number | null
        sugars: number | null
        fat: number | null
        salt: number | null
      } | null
    }
    expect(body.ingredients).toContain('cocoa butter')
    expect(body.nutrition).not.toBeNull()
    expect(body.nutrition!.calories).toBe(520)
    expect(body.nutrition!.protein).toBe(7)
    expect(body.nutrition!.carbs).toBe(60)
    expect(body.nutrition!.sugars).toBe(55)
    expect(body.nutrition!.fat).toBe(28)
    expect(body.nutrition!.salt).toBe(0.25)
    expect(body.nutrition!.servingSize).toBe('1 kaka (25 g)')
  })

  test('strips markdown fences from the provider reply', async () => {
    process.env.OCR_API_KEY = 'test-key'
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    mockProvider('```json\n' + providerJson + '\n```')
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { nutrition: { calories: number } | null }
    expect(body.nutrition!.calories).toBe(520)
  })
})
