import { mkdir, writeFile } from 'fs/promises'
import path from 'path'
import { db } from '@/lib/db'
import { uploadsDir } from '@/lib/uploads'
import { normalizeImage, normalizedFileName } from '@/lib/image-normalize'
import { cleanMultiline, cleanText } from '@/lib/sanitize'

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

/**
 * Exact-origin allowlist (30F / audit I07): OFF's API and its image CDNs.
 * Exact host match only — no suffix lookalikes, no IP literals, no other
 * ports. The upstream supplies image URLs; without an allowlist this is an
 * upstream-controlled fetch target (SSRF-adjacent).
 */
const OFF_ALLOWED_HOSTS = new Set([
  'world.openfoodfacts.org',
  'images.openfoodfacts.org',
  'static.openfoodfacts.org',
])

const OFF_RESPONSE_MAX_BYTES = 2 * 1024 * 1024
const OFF_DEADLINE_MS = 20_000
const OFF_MAX_REDIRECTS = 3
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
export const BOT_EMAIL = 'off-import@etikettkontroll.se'
const BOT_NAME = 'Open Food Facts'
// OFF licensing is three-way: the database is ODbL, individual contents fall
// under the Database Contents License (DbCL), product images are CC BY-SA.
const AUTONOTE = 'Imported from Open Food Facts'
const LICENSE_DATA = 'OFF Database Contents License (DbCL v1.0); database licensed ODbL'
const LICENSE_IMAGES = 'CC BY-SA 4.0 (Open Food Facts contributors)'

const BARCODE_RE = /^\d{8,14}$/

/**
 * OFF upstream types are advisory only — rows are validated at runtime as
 * unknown data (30F). This type documents the EXPECTED shape of a v2 search
 * row; nothing is trusted to it.
 */
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

/** Safe string extraction from an untrusted upstream field: primitives only, no throwing. */
function safeString(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function round(v: number, decimals: number): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 10_000 ? v : null
}

/** Pure mapper — invalid products are skipped with a reason, never thrown. */
export function mapOffProduct(raw: unknown): MapResult {
  // Upstream rows are unknown data (30F): shape and field types validated
  // BEFORE any .trim()/.replace() — a numeric code or null row must yield a
  // reason, not a TypeError that kills the batch.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'shape' }
  const r = raw as Record<string, unknown>
  if (!r.nutriments || typeof r.nutriments !== 'object' || Array.isArray(r.nutriments)) {
    // nutriments may be absent (null) — that is allowed; wrong types are not.
    if (r.nutriments !== null && r.nutriments !== undefined) return { ok: false, reason: 'shape' }
  }
  const n = (r.nutriments ?? {}) as Record<string, unknown>

  const barcode = safeString(r['code']).trim()
  if (!BARCODE_RE.test(barcode)) return { ok: false, reason: 'barcode' }

  const name = cleanText(safeString(r['product_name_sv']) || safeString(r['product_name']))
  if (name.length < 2 || name.length > 200) return { ok: false, reason: 'name' }

  const brand = cleanText(safeString(r['brands']).split(',')[0] ?? '')
  if (brand.length < 1 || brand.length > 120) return { ok: false, reason: 'brand' }

  const ingredients = cleanMultiline(safeString(r['ingredients_text_sv']) || safeString(r['ingredients_text']))
  // No silent truncation of imported evidence (30F): oversize is a skip.
  if (ingredients.length < 5) return { ok: false, reason: 'ingredients' }
  if (ingredients.length > 8000) return { ok: false, reason: 'ingredients_length' }

  const kcal = num(n['energy-kcal_100g']) ?? (num(n['energy-kj_100g']) !== null ? round(num(n['energy-kj_100g'])! / 4.184, 1) : null)
  const salt = num(n['salt_100g']) ?? (num(n['sodium_100g']) !== null ? round(num(n['sodium_100g'])! * 2.5, 3) : null)

  const servingSizeRaw = cleanText(safeString(r['serving_size']))
  if (servingSizeRaw.length > 60) return { ok: false, reason: 'serving_size' }

  return {
    ok: true,
    data: {
      barcode,
      name,
      brand,
      ingredients,
      servingSize: servingSizeRaw || null,
      calories: kcal !== null ? round(kcal, 1) : null,
      protein: num(n['proteins_100g']) !== null ? round(num(n['proteins_100g'])!, 2) : null,
      carbs: num(n['carbohydrates_100g']) !== null ? round(num(n['carbohydrates_100g'])!, 2) : null,
      sugars: num(n['sugars_100g']) !== null ? round(num(n['sugars_100g'])!, 2) : null,
      fat: num(n['fat_100g']) !== null ? round(num(n['fat_100g'])!, 2) : null,
      salt,
      imageUrl: offImageUrl(r['image_front_small_url']),
    },
  }
}

/** Only image URLs on the OFF allowlist are eligible; everything else is dropped. */
function offImageUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
    return OFF_ALLOWED_HOSTS.has(u.hostname) ? v : null
  } catch {
    return null
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

/**
 * Bounded OFF fetch (30F): exact-host allowlist enforced on EVERY hop
 * (redirect: manual + small hop cap — following redirects blindly would let
 * the upstream bounce us anywhere), 20s deadline, HTTPS only, no credentials.
 */
async function offFetchOnce(url: string): Promise<Response> {
  return fetch(url, {
    headers: { 'User-Agent': 'EtikettKontroll/0.3 (crowdsourced label database; +https://etikettkontroll.se)' },
    redirect: 'manual',
    signal: AbortSignal.timeout(OFF_DEADLINE_MS),
  })
}

function isAllowedOffUrl(url: URL): boolean {
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.port &&
    OFF_ALLOWED_HOSTS.has(url.hostname) &&
    !/^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname) && // IP literal, not a name
    url.hostname.includes('.')
  )
}

async function offFetch(url: string): Promise<Response> {
  // Accepts full URLs (image CDN) or paths (API) — only prefix the latter.
  let current = url.startsWith('https://') ? url : `${OFF_BASE}${url}`
  for (let hop = 0; hop <= OFF_MAX_REDIRECTS; hop++) {
    let parsed: URL
    try {
      parsed = new URL(current)
    } catch {
      throw new Error('OFF request rejected: invalid URL')
    }
    if (!isAllowedOffUrl(parsed)) throw new Error(`OFF request rejected: host not allowed (${parsed.hostname})`)
    const res = await fetch(parsed.toString(), {
      headers: { 'User-Agent': 'EtikettKontroll/0.3 (crowdsourced label database; +https://etikettkontroll.se)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(OFF_DEADLINE_MS),
    })
    if (res.status < 300 || res.status >= 400) return res
    const location = res.headers.get('location')
    if (!location) throw new Error('OFF redirect without Location')
    await res.body?.cancel().catch(() => undefined)
    current = new URL(location, parsed).toString()
  }
  throw new Error('OFF request rejected: too many redirects')
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Downloads the OFF front image, normalizes it (30E), stores it; file name or null on any failure. */
async function saveImage(url: string): Promise<string | null> {
  try {
    const res = await offFetch(url)
    if (!res.ok) return null
    // Content-Type is a hint; sharp's decode is the real gate (30E). The
    // 2 MiB network budget is checked while streaming the response.
    const reader = res.body?.getReader()
    if (!reader) return null
    const chunks: Uint8Array[] = []
    let total = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 2 * 1024 * 1024) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const c of chunks) {
      bytes.set(c, offset)
      offset += c.byteLength
    }
    // Same normalize-and-reencode pipeline as user uploads: strips EXIF and
    // rejects non-raster payloads from the upstream-controlled URL.
    const normalized = await normalizeImage(bytes)
    const name = normalizedFileName(normalized)
    const dir = uploadsDir()
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, name), normalized.bytes)
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

/** Stream an OFF response into JSON with a hard byte cap; null when over budget. */
async function readBoundedOffJson(res: Response): Promise<unknown> {
  const reader = res.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > OFF_RESPONSE_MAX_BYTES) {
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
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
  } catch {
    return null
  }
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
    // Bounded JSON read (30F): stream with the 2 MiB budget, never trust
    // Content-Length; oversized responses are cancelled, not buffered.
    const body = (await readBoundedOffJson(res)) as { products?: unknown[] } | null
    if (!body || !Array.isArray(body.products)) throw new Error('Open Food Facts response has unexpected shape')
    const rows = body.products
    summary.fetched += rows.length

    for (const raw of rows) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        summary.skippedInvalid++
        summary.invalidReasons['shape'] = (summary.invalidReasons['shape'] ?? 0) + 1
        continue
      }
      let mapped: MapResult
      try {
        mapped = mapOffProduct(raw)
      } catch {
        // The mapper is contractually pure; belt & suspenders for upstream garbage.
        summary.skippedInvalid++
        summary.invalidReasons['shape'] = (summary.invalidReasons['shape'] ?? 0) + 1
        continue
      }
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
            quarantined: false,
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
                // Imported records are the current publication but explicitly
                // UNVERIFIED — only review-based verification stamps verifiedAt.
                status: 'auto_approved',
                requiredApprovals: 0,
                autoNote: AUTONOTE,
                finalizedAt: new Date(),
                sourceType: 'openfoodfacts',
                sourceId: d.barcode,
                sourceUrl: `https://world.openfoodfacts.org/product/${d.barcode}`,
                importedAt: new Date(),
                licenseData: LICENSE_DATA,
                licenseImages: LICENSE_IMAGES,
              },
            },
          },
        })
        // Canonical current-publication pointer for the fresh import.
        const created = await db.product.findUnique({ where: { barcode: d.barcode }, select: { id: true } })
        if (created) {
          const rev = await db.productRevision.findFirst({
            where: { productId: created.id },
            orderBy: { version: 'desc' },
            select: { id: true },
          })
          if (rev) await db.product.update({ where: { id: created.id }, data: { currentRevisionId: rev.id } })
        }
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
