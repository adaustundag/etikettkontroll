import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { uploadsDir } from '@/lib/uploads'

/**
 * One-time bootstrap importer: pulls Swedish grocery products from Open Food
 * Facts and lands them as products with an initial auto-approved revision.
 *
 * Why direct inserts (not submitRevision): the review workflow exists to gate
 * *human* contributions. Machine-imported data would flood the queue and
 * deadlock on a community that doesn't exist yet. Provenance is preserved via
 * the revision autoNote ("Imported from Open Food Facts — CC BY-SA 4.0"),
 * matching the CC BY-SA license of both OFF and this site's user content.
 *
 * OFF asks integrations to send a descriptive User-Agent and stay at ~1 req/s.
 */

const OFF_BASE = 'https://world.openfoodfacts.org'
const OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_sv',
  'brands',
  'ingredients_text',
  'ingredients_text_sv',
  'serving_size',
  'nutriments',
  'image_front_small_url',
].join(',')
const BOT_EMAIL = 'off-import@etikettkontroll.se'
const BOT_NAME = 'Open Food Facts'
const AUTONOTE = 'Imported from Open Food Facts — data licensed CC BY-SA 4.0'

const BARCODE_RE = /^\d{8,14}$/
const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

type OffNutriments = Record<string, number | undefined>

type OffProduct = {
  code?: string
  product_name?: string
  product_name_sv?: string
  brands?: string
  ingredients_text?: string
  ingredients_text_sv?: string
  serving_size?: string
  nutriments?: OffNutriments
  image_front_small_url?: string
}

export type MappedProduct = {
  barcode: string
  name: string
  brand: string
  ingredients: string
  servingSize: string | null
  calories: number | null
  protein: number | null
  carbs: number | null
  sugars: number | null
  fat: number | null
  salt: number | null
  imageUrl: string | null
}

export type MapResult = { ok: true; data: MappedProduct } | { ok: false; reason: string }

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : null
}

/** Pure mapper — invalid products are skipped with a reason, never thrown. */
export function mapOffProduct(raw: OffProduct): MapResult {
  const barcode = (raw.code ?? '').trim()
  if (!BARCODE_RE.test(barcode)) return { ok: false, reason: 'barcode' }

  const name = oneLine(raw.product_name_sv || raw.product_name || '')
  if (name.length < 2 || name.length > 200) return { ok: false, reason: 'name' }

  const brand = oneLine((raw.brands ?? '').split(',')[0] ?? '')
  if (brand.length < 1 || brand.length > 120) return { ok: false, reason: 'brand' }

  const ingredients = oneLine(raw.ingredients_text_sv || raw.ingredients_text || '')
  if (ingredients.length < 5) return { ok: false, reason: 'ingredients' }

  const n = raw.nutriments ?? {}
  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy-kj_100g']) !== null ? round(num(n['energy-kj_100g'])! / 4.184, 1) : null)
  const salt = num(n['salt_100g']) ?? (num(n['sodium_100g']) !== null ? round(num(n['sodium_100g'])! * 2.5, 3) : null)

  const servingSizeRaw = oneLine(raw.serving_size ?? '')

  return {
    ok: true,
    data: {
      barcode,
      name: name.slice(0, 200),
      brand: brand.slice(0, 120),
      ingredients: ingredients.slice(0, 8000),
      servingSize: servingSizeRaw ? servingSizeRaw.slice(0, 60) : null,
      calories: kcal !== null ? round(kcal, 1) : null,
      protein: num(n['proteins_100g']) !== null ? round(num(n['proteins_100g'])!, 2) : null,
      carbs: num(n['carbohydrates_100g']) !== null ? round(num(n['carbohydrates_100g'])!, 2) : null,
      sugars: num(n['sugars_100g']) !== null ? round(num(n['sugars_100g'])!, 2) : null,
      fat: num(n['fat_100g']) !== null ? round(num(n['fat_100g'])!, 2) : null,
      salt,
      imageUrl: raw.image_front_small_url?.startsWith('https://') ? raw.image_front_small_url : null,
    },
  }
}

export type ImportSummary = {
  pages: number
  fetched: number
  imported: number
  skippedExisting: number
  skippedInvalid: number
  imagesSaved: number
  invalidReasons: Record<string, number>
}

async function offFetch(url: string): Promise<Response> {
  // OFF etiquette: identify yourself, keep ~1 req/s (callers sleep between pages).
  // Accepts full URLs (image CDN) or paths (API) — only prefix the latter.
  const target = url.startsWith('https://') ? url : `${OFF_BASE}${url}`
  return fetch(target, {
    headers: { 'User-Agent': 'EtikettKontroll/0.2 (crowdsourced label database; +https://etikettkontroll.se)' },
    redirect: 'follow',
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Downloads the OFF front image into the local uploads store; the stored file name, or null on any failure. */
async function saveImage(url: string): Promise<string | null> {
  try {
    const res = await offFetch(url)
    if (!res.ok) return null
    const ext = IMAGE_EXT_BY_MIME[res.headers.get('content-type')?.split(';')[0] ?? '']
    if (!ext) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) return null
    const name = `${Date.now().toString(36)}-${randomUUID()}.${ext}`
    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, name), bytes)
    return name
  } catch {
    return null
  }
}

async function offFetchWithRetry(path: string, attempts = 3): Promise<Response> {
  // OFF's search API intermittently 503s under load — retry with backoff.
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await offFetch(path)
      if (res.ok || ![429, 500, 502, 503, 504].includes(res.status)) return res
      lastErr = new Error(`Open Food Facts returned ${res.status}`)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
    }
    if (attempt < attempts) await sleep(2_000 * attempt)
  }
  throw lastErr ?? new Error('Open Food Facts request failed')
}

/**
 * Imports `pages` pages (100 products/page) of Swedish OFF products starting
 * at `startPage`. Existing barcodes are skipped; invalid OFF rows are counted
 * by reason. Image downloads are best-effort and throttled.
 */
export async function importOffPages(opts: { startPage?: number; pages?: number; withImages?: boolean } = {}): Promise<ImportSummary> {
  const startPage = Math.max(1, Math.floor(opts.startPage ?? 1))
  const pages = Math.min(5, Math.max(1, Math.floor(opts.pages ?? 1)))
  const withImages = opts.withImages ?? true

  const bot = await db.user.upsert({
    where: { email: BOT_EMAIL },
    update: {},
    create: { email: BOT_EMAIL, name: BOT_NAME, trustLevel: 3 },
  })

  const existing = new Set((await db.product.findMany({ select: { barcode: true } })).map((p) => p.barcode))
  const summary: ImportSummary = { pages, fetched: 0, imported: 0, skippedExisting: 0, skippedInvalid: 0, imagesSaved: 0, invalidReasons: {} }

  for (let page = startPage; page < startPage + pages; page++) {
    const res = await offFetchWithRetry(`/api/v2/search?countries_tags=sweden&fields=${OFF_FIELDS}&page_size=100&page=${page}`)
    if (!res.ok) throw new Error(`Open Food Facts returned ${res.status} on page ${page}`)
    const body = (await res.json()) as { products?: OffProduct[] }
    const rows = body.products ?? []
    summary.fetched += rows.length

    for (const raw of rows) {
      const mapped = mapOffProduct(raw)
      if (!mapped.ok) {
        summary.skippedInvalid++
        summary.invalidReasons[mapped.reason] = (summary.invalidReasons[mapped.reason] ?? 0) + 1
        continue
      }
      const d = mapped.data
      if (existing.has(d.barcode)) {
        summary.skippedExisting++
        continue
      }

      let frontImage: string | null = null
      if (withImages && d.imageUrl) {
        frontImage = await saveImage(d.imageUrl) // e.g. "abc123-uuid.jpg"
        if (frontImage) summary.imagesSaved++
        await sleep(150)
      }

      try {
        await db.product.create({
          data: {
            barcode: d.barcode,
            name: d.name,
            brand: d.brand,
            revisions: {
              create: {
                version: 1,
                submittedById: bot.id,
                name: d.name,
                brand: d.brand,
                ingredients: d.ingredients,
                servingSize: d.servingSize,
                calories: d.calories,
                protein: d.protein,
                carbs: d.carbs,
                sugars: d.sugars,
                fat: d.fat,
                salt: d.salt,
                frontImage: frontImage ? `/uploads/${frontImage}` : null,
                status: 'auto_approved',
                requiredApprovals: 0,
                autoNote: AUTONOTE,
                finalizedAt: new Date(),
              },
            },
          },
        })
        existing.add(d.barcode)
        summary.imported++
      } catch (err) {
        // P2002 = concurrent import raced us to the same barcode.
        if ((err as { code?: string }).code === 'P2002') summary.skippedExisting++
        else throw err
      }
    }
    await sleep(1100) // OFF etiquette between search pages
  }

  return summary
}
