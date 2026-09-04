/**
 * Image normalization pipeline (Task 30E / audit I06).
 *
 * Validate-and-reencode: every image that enters the file store — uploads,
 * OFF imports, OCR inputs — goes through sharp here. What sharp cannot
 * decode is not an image, whatever the client claimed. Re-encoding discards
 * source metadata (EXIF incl. GPS, XMP, ICC) and trailing/container
 * payloads; it does NOT guarantee safety from future decoder bugs (honest
 * comment, per audit).
 *
 * Constraints from the brief:
 *  - JPEG, PNG, WebP ONLY (sharp supports more — success alone is not acceptance)
 *  - no animation / multipage, no enlargement, EXIF rotation applied
 *  - decoded pixel budget + one active decode per process + bounded queue
 *  - output: fresh pixel encoding; stored extension derives from the OUTPUT
 *
 * No file or network I/O happens in this module.
 */
import sharp from 'sharp'
import { randomUUID } from 'crypto'

// Named budgets (audit: initial proposal, to be measured against real phone
// photos and Railway memory; encoded-byte and decoded-pixel caps are
// different controls).
export const MAX_INPUT_PIXELS = 40_000_000
export const MAX_DIMENSION = 2000
export const DECODE_CONCURRENCY = 1
export const MAX_PENDING = 8

const DETECTED_FORMATS = new Set(['jpeg', 'png', 'webp'])
const EXT_BY_FORMAT: Record<string, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' }
const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

/** The concurrency gate: one native decode at a time, bounded pending queue. */
let active = 0
const waiters: Array<() => void> = []

async function acquireSlot(): Promise<void> {
  if (active < DECODE_CONCURRENCY) {
    active += 1
    return
  }
  if (waiters.length >= MAX_PENDING) {
    throw new Error('image pipeline busy') // reject overload; never queue unbounded
  }
  await new Promise<void>((resolve) => waiters.push(resolve))
  active += 1
}

function releaseSlot() {
  active -= 1
  const next = waiters.shift()
  if (next) next()
}

export type NormalizedImage = {
  bytes: Buffer
  format: 'jpeg' | 'png' | 'webp'
  ext: string
  mime: string
  width: number
  height: number
}

/**
 * Decode, validate, normalize and re-encode an image from raw bytes.
 * Throws on anything that is not a supported still raster.
 */
export async function normalizeImage(input: Uint8Array): Promise<NormalizedImage> {
  await acquireSlot()
  try {
    // Input-pixel budget BEFORE full decode work: sharp metadata gives real
    // dimensions. A 3-byte "PNG" (old test fixture style) fails decode here.
    let image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
    const meta = await image.metadata()
    if (!meta.format || !DETECTED_FORMATS.has(meta.format)) {
      throw new Error(`unsupported format${meta.format ? `: ${meta.format}` : ''}`)
    }
    if (meta.pages && meta.pages > 1) {
      throw new Error('animated or multipage images are not supported')
    }

    // EXIF orientation applied, then rotate() removes the orientation tag;
    // metadata is stripped by re-encoding from raw pixels (no .withMetadata()).
    image = sharp(input, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS })
      .rotate() // bake EXIF orientation upright
      .resize({
        width: MAX_DIMENSION,
        height: MAX_DIMENSION,
        fit: 'inside', // never enlarge; only shrink when needed
        withoutEnlargement: true,
      })

    const { data, info } = await image.toBuffer({ resolveWithObject: true })
    const outFormat = info.format as 'jpeg' | 'png' | 'webp'
    if (!DETECTED_FORMATS.has(outFormat)) {
      throw new Error('normalization produced an unsupported output format')
    }
    // Verify the output is itself decodable and metadata-free.
    const check = await sharp(data).metadata()
    if (check.exif || check.icc || check.xmp) {
      throw new Error('normalized image unexpectedly retained metadata')
    }
    return {
      bytes: data,
      format: outFormat,
      ext: EXT_BY_FORMAT[outFormat],
      mime: MIME_BY_FORMAT[outFormat],
      width: info.width,
      height: info.height,
    }
  } finally {
    releaseSlot()
  }
}

/** Fresh generated filename derived from the OUTPUT format. */
export function normalizedFileName(n: NormalizedImage): string {
  return `${Date.now().toString(36)}-${randomUUID()}.${n.ext}`
}
