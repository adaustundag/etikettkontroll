import { NextRequest, NextResponse } from 'next/server'
import ZAI, { type CreateChatCompletionVisionBody } from 'z-ai-web-dev-sdk'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type OcrResult = {
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

const PROMPT = `This is a photo of a grocery product's label. Transcribe it EXACTLY.
Return ONLY minified JSON, no markdown, in this shape:
{"ingredients":"<the ingredient list text exactly as printed, keep the original language>","nutrition":{"servingSize":"<e.g. 100 g or null>","calories":<kcal per 100 g/ml or null>,"protein":<g per 100 g or null>,"carbs":<g or null>,"sugars":<g or null>,"fat":<g or null>,"salt":<g or null>}}
Use null for anything not visible on the package. Numbers must be plain numbers, not strings.`

function parseJsonLoose(text: string): OcrResult | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as OcrResult
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to use auto-fill.' }, { status: 401 })

  try {
    const body = (await req.json()) as { image?: string }
    const image = body.image || ''
    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Send an image as a base64 data URL.' }, { status: 400 })
    }

    const zai = await ZAI.create()
    // The SDK runtime injects a default vision model when `model` is omitted
    // (verified live); the published types incorrectly require it, so cast.
    const visionBody = {
      messages: [
        {
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: PROMPT },
            { type: 'image_url' as const, image_url: { url: image } },
          ],
        },
      ],
      thinking: { type: 'disabled' as const },
    } as CreateChatCompletionVisionBody
    const response = await zai.chat.completions.createVision(visionBody)
    const raw = response.choices[0]?.message?.content ?? ''
    const parsed = parseJsonLoose(raw)
    if (!parsed || (!parsed.ingredients && !parsed.nutrition)) {
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    return NextResponse.json({
      ingredients: parsed.ingredients?.trim() || null,
      nutrition: parsed.nutrition ?? null,
    } satisfies Partial<OcrResult>)
  } catch (err) {
    console.error('ocr error', err)
    return NextResponse.json({ error: 'Auto-fill is unavailable right now. Please type it manually.' }, { status: 502 })
  }
}
