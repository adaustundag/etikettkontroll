import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { PayloadTooLargeError, readBoundedJson } from '@/lib/payload'

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
{"ingredients":"<the ingredient list text exactly as printed, keep the original language>","nutrition":{"servingSize":"<the package portion if printed, e.g. 1 cookie (25 g), or null>","calories":<kcal per 100 g/ml or null>,"protein":<g per 100 g or null>,"carbs":<g or null>,"sugars":<g or null>,"fat":<g or null>,"salt":<g or null>}}
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

/**
 * Vision provider is any OpenAI-compatible chat-completions endpoint
 * (OpenAI, Azure OpenAI-compatible gateways, OpenRouter, local LLM servers…).
 * Configure with OCR_API_KEY; OCR_BASE_URL defaults to the OpenAI API and
 * OCR_MODEL defaults to a small capable vision model. Unset key = the feature
 * is disabled (the client hides it; POST returns 503).
 */
function ocrConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.OCR_API_KEY
  if (!apiKey) return null
  return {
    apiKey,
    baseUrl: (process.env.OCR_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    model: process.env.OCR_MODEL || 'gpt-4o-mini',
  }
}

// GET /api/ocr — feature availability probe for the submit wizard.
export async function GET() {
  return NextResponse.json({ available: ocrConfig() !== null })
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Sign in to use auto-fill.' }, { status: 401 })

  // Vision-API cost bound: 20 calls per minute per user.
  const limited = enforceRateLimit(req, 'ocr', 20, 60_000, user.id)
  if (limited) return limited

  const cfg = ocrConfig()
  if (!cfg) {
    return NextResponse.json({ error: 'Auto-fill is not configured. Please type it manually.' }, { status: 503 })
  }

  try {
    // 12 MB covers a base64-encoded 8 MB image with headroom.
    const body = (await readBoundedJson<{ image?: string }>(req, 12 * 1024 * 1024)) ?? {}
    const image = body.image || ''
    if (!image.startsWith('data:image/')) {
      return NextResponse.json({ error: 'Send an image as a base64 data URL.' }, { status: 400 })
    }

    const response = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 2000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
      }),
    })
    if (!response.ok) {
      console.error('ocr provider error', response.status, (await response.text()).slice(0, 500))
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] }
    const raw = data.choices?.[0]?.message?.content ?? ''
    const parsed = parseJsonLoose(raw)
    if (!parsed || (!parsed.ingredients && !parsed.nutrition)) {
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    return NextResponse.json({
      ingredients: parsed.ingredients?.trim() || null,
      nutrition: parsed.nutrition ?? null,
    } satisfies Partial<OcrResult>)
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: 'Image payload is too large.' }, { status: 413 })
    }
    console.error('ocr error', err)
    return NextResponse.json({ error: 'Auto-fill is unavailable right now. Please type it manually.' }, { status: 502 })
  }
}
