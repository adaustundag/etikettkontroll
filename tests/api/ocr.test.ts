import '../setup'
import { beforeEach, describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { POST as ocrPOST } from '@/app/api/ocr/route'
import { createToken } from '@/lib/auth'
import { mockAuth, req } from '../setup'
import { mkUser, wipeDb } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

/** A synthetic "label photo": SVG text rendered to PNG — deterministic input. */
async function labelImageDataUrl(): Promise<string> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360">
    <rect width="100%" height="100%" fill="white"/>
    <text x="30" y="60" font-size="24" fill="black" font-family="sans-serif">INGREDIENTS: sugar, wheat flour,</text>
    <text x="30" y="100" font-size="24" fill="black" font-family="sans-serif">cocoa butter, milk powder, salt, vanilla.</text>
    <text x="30" y="180" font-size="24" fill="black" font-family="sans-serif">NUTRITION PER 100 g:</text>
    <text x="30" y="220" font-size="24" fill="black" font-family="sans-serif">Energy 520 kcal, Fat 28 g,</text>
    <text x="30" y="260" font-size="24" fill="black" font-family="sans-serif">Carbohydrates 60 g, of which sugars 55 g,</text>
    <text x="30" y="300" font-size="24" fill="black" font-family="sans-serif">Protein 7 g, Salt 0.25 g. Serving: 100 g.</text>
  </svg>`
  const png = await sharp(Buffer.from(svg)).png().toBuffer()
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

describe('POST /api/ocr — AI label auto-fill', () => {
  test('401 for anonymous users', async () => {
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'data:image/png;base64,AAAA' }))
    expect(res.status).toBe(401)
  })

  test('400 when the body is not an image data URL', async () => {
    const user = await mkUser()
    mockAuth(`Bearer ${createToken(user.id)}`)
    const res = await ocrPOST(req('POST', '/api/ocr', { image: 'not-a-data-url' }))
    expect(res.status).toBe(400)
    const { error } = (await res.json()) as { error: string }
    expect(error).toContain('data URL')
  })

  test(
    'reads a label photo and returns ingredients + nutrition',
    async () => {
      const user = await mkUser()
      mockAuth(`Bearer ${createToken(user.id)}`)
      const image = await labelImageDataUrl()

      const res = await ocrPOST(req('POST', '/api/ocr', { image }))
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
      expect(body.nutrition!.servingSize).toBe('100 g')
    },
    60_000, // real vision-model call
  )
})
