import { NextRequest } from 'next/server'

/** Thrown when the (declared or actual) body exceeds the route's byte cap. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
  }
}

/** Thrown when the body is not the expected shape/type (malformed JSON, non-object, wrong field types). */
export class MalformedBodyError extends Error {
  constructor(message = 'Request body must be a JSON object.') {
    super(message)
  }
}

/**
 * Read a request body with a true streaming byte cap.
 *
 * - The cap counts incoming Uint8Array bytes; the stream is cancelled as soon
 *   as it would exceed the cap, so a huge body is never fully buffered.
 * - Content-Length is an early hint only; the cap applies even when the
 *   header is absent or understated.
 * - Bytes are returned without decoding; UTF-8 decoding happens separately,
 *   only after the size check passed.
 */
export async function readBoundedBytes(req: NextRequest, capBytes: number): Promise<Uint8Array> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > capBytes) throw new PayloadTooLargeError()

  const body = req.body
  if (!body) return new Uint8Array(0)

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value && value.byteLength > 0) {
        total += value.byteLength
        if (total > capBytes) {
          await reader.cancel().catch(() => undefined) // stop buffering upstream
          throw new PayloadTooLargeError()
        }
        chunks.push(value)
      }
    }
  } catch (err) {
    if (err instanceof PayloadTooLargeError) throw err
    // Aborted/failed stream: deliberate 400-family error, not a 500.
    throw new MalformedBodyError('Request stream failed before completion.')
  }

  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.byteLength
  }
  return out
}

/**
 * Bounded JSON object reader. Returns a plain non-null, non-array object;
 * throws PayloadTooLargeError on size violations and MalformedBodyError for
 * invalid JSON / non-object bodies. JSON parsing is NOT schema validation —
 * callers must still type-check individual fields (assert* helpers below).
 */
export async function readBoundedJsonObject(
  req: NextRequest,
  capBytes: number,
): Promise<Record<string, unknown>> {
  const bytes = await readBoundedBytes(req, capBytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes))
  } catch {
    throw new MalformedBodyError('Request body must be valid JSON.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new MalformedBodyError()
  }
  return parsed as Record<string, unknown>
}

/** Primitive string check — never coerce with String(). */
export function assertStringField(v: unknown, name: string): string {
  if (typeof v !== 'string') throw new MalformedBodyError(`Field "${name}" must be a string.`)
  return v
}

/** Optional string: undefined/null pass through as undefined; non-strings throw. */
export function assertOptionalStringField(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined
  return assertStringField(v, name)
}

/** Optional boolean: undefined/null pass through; only real booleans accepted. */
export function assertOptionalBoolean(v: unknown, name: string): boolean | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw new MalformedBodyError(`Field "${name}" must be a boolean.`)
  return v
}

/** Optional finite integer within [min,max]; undefined/null pass through. */
export function assertOptionalInt(
  v: unknown,
  name: string,
  min: number,
  max: number,
): number | undefined {
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    throw new MalformedBodyError(`Field "${name}" must be an integer.`)
  }
  if (v < min || v > max) throw new MalformedBodyError(`Field "${name}" is out of range.`)
  return v
}

/**
 * Map lib-level errors to HTTP responses with the existing { error } shape.
 * Oversized → 413, malformed → 400, everything else rethrown.
 */
export function payloadErrorResponse(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof PayloadTooLargeError) return { status: 413, body: { error: err.message } }
  if (err instanceof MalformedBodyError) return { status: 400, body: { error: err.message } }
  return null
}
