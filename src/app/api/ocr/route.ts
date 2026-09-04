import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { enforceRateLimit } from '@/lib/rate-limit'
import { assertOptionalStringField, payloadErrorResponse, readBoundedJsonObject } from '@/lib/payload'
import { normalizeImage } from '@/lib/image-normalize'
import { cleanMultiline } from '@/lib/sanitize'

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

function parseJsonLoose(text: string): { ingredients?: unknown; nutrition?: unknown } | null {
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as { ingredients?: unknown; nutrition?: unknown }
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
    const body = await readBoundedJsonObject(req, 12 * 1024 * 1024)
    const image = assertOptionalStringField(body.image, 'image') ?? ''
    // Strict data-URL envelope (30B): exact MIME set + valid base64 + decoded
    // byte cap. Arbitrary data:image/* content (SVG, GIF, oversized) is
    // rejected here before any provider call. Actual pixel decoding happens
    // in the shared image pipeline (30E).
    const decoded = decodeImageDataUrl(image)
    if (typeof decoded === 'string') {
      return NextResponse.json({ error: decoded }, { status: 400 })
    }
    // 30E: pixel-level validation through the shared pipeline — what sharp
    // cannot decode is not an image. The provider receives the freshly
    // encoded bytes, never the raw client payload.
    let normalized
    try {
      normalized = await normalizeImage(decoded)
    } catch (err) {
      console.error('ocr image rejected:', err instanceof Error ? err.message : err)
      return NextResponse.json(
        { error: 'Only JPEG, PNG or WebP images are supported.' },
        { status: 400 },
      )
    }
    const dataUrl = `data:${normalized.mime};base64,${Buffer.from(normalized.bytes).toString('base64')}`

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
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      // Provider output is untrusted third-party data (30F): deadline + byte
      // cap. maxDuration is not a fetch cancellation mechanism.
      signal: AbortSignal.timeout(OCR_PROVIDER_TIMEOUT_MS),
    })
    if (!response.ok) {
      console.error('ocr provider error', response.status, (await response.text()).slice(0, 500))
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    const rawBody = await readBoundedProviderBody(response)
    if (!rawBody) {
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    let data: unknown
    try {
      data = JSON.parse(rawBody)
    } catch {
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    const raw = providerContent(data)
    const parsed = parseJsonLoose(raw)
    if (!parsed || (!parsed.ingredients && !parsed.nutrition)) {
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    // 30F: construct a fresh, allowlisted DTO — unknown keys never reach the
    // client, numbers must be finite and within label bounds, strings are
    // normalized. Provider output is data, not truth.
    const dto = validatedOcrDto(parsed)
    if (!dto) {
      return NextResponse.json({ error: 'Could not read the label. Please type it manually.' }, { status: 502 })
    }
    return NextResponse.json(dto)
  } catch (err) {
    const mapped = payloadErrorResponse(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('ocr error', err)
    return NextResponse.json({ error: 'Auto-fill is unavailable right now. Please type it manually.' }, { status: 502 })
  }
}

const OCR_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
const OCR_DECODED_MAX_BYTES = 8 * 1024 * 1024
const OCR_PROVIDER_TIMEOUT_MS = 45_000
const OCR_RESPONSE_MAX_BYTES = 1 * 1024 * 1024

/** Stream-capped provider body; null when over budget or unreadable. */
async function readBoundedProviderBody(res: Response): Promise<string | null> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > OCR_RESPONSE_MAX_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } catch {
    return null
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    bytes.set(c, offset)
    offset += c.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Extract message content from the provider envelope without trusting its shape. */
function providerContent(data: unknown): string {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const choices = (data as Record<string, unknown>)['choices']
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const message = (first as Record<string, unknown>)['message']
  if (!message || typeof message !== 'object') return ''
  const content = (message as Record<string, unknown>)['content']
  return typeof content === 'string' ? content : ''
}

function boundedNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 10_000) return null
  return v
}

function boundedText(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const cleaned = cleanMultiline(v)
  return cleaned && cleaned.length <= max ? cleaned : cleaned ? cleaned.slice(0, max) : null
}

/** Build the response DTO from known fields only; null when nothing usable survived. */
function validatedOcrDto(parsed: {
  ingredients?: unknown
  nutrition?: unknown
}): OcrResult | null {
  const ingredients = boundedText(parsed.ingredients, 8000)
  let nutrition: OcrResult['nutrition'] = null
  if (parsed.nutrition && typeof parsed.nutrition === 'object' && !Array.isArray(parsed.nutrition)) {
    const n = parsed.nutrition as Record<string, unknown>
    nutrition = {
      servingSize: boundedText(n['servingSize'], 60),
      calories: boundedNumber(n['calories']),
      protein: boundedNumber(n['protein']),
      carbs: boundedNumber(n['carbs']),
      sugars: boundedNumber(n['sugars']),
      fat: boundedNumber(n['fat']),
      salt: boundedNumber(n['salt']),
    }
  }
  if (!ingredients && !nutrition) return null
  return { ingredients, nutrition }
}

/**
 * Validate a base64 data URL and return its decoded bytes.
 * Returns an error message string on invalid envelope, Uint8Array on success.
 */
function decodeImageDataUrl(value: string): Uint8Array | string {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(value)
  if (!m) return 'Send an image as a base64 data URL (JPEG, PNG or WebP).'
  const b64 = m[2].replace(/\s+/g, '')
  let bin: string
  try {
    bin = atob(b64)
  } catch {
    return 'The image data is not valid base64.'
  }
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  if (bytes.byteLength > OCR_DECODED_MAX_BYTES) {
    return 'Image is too large (max 8 MB).'
  }
  return bytes
}
