import { NextRequest } from 'next/server'

/** Thrown when the (declared or actual) body exceeds the route's byte cap. */
export class PayloadTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
  }
}

/**
 * Parse a JSON body with a hard byte cap — bounds the parser before a huge
 * payload can eat memory (audit finding: no body size caps anywhere).
 * Returns null for invalid JSON; callers treat that like an empty body.
 */
export async function readBoundedJson<T>(req: NextRequest, capBytes: number): Promise<T | null> {
  const declared = Number(req.headers.get('content-length') || 0)
  if (Number.isFinite(declared) && declared > capBytes) throw new PayloadTooLargeError()
  const text = await req.text()
  if (text.length > capBytes) throw new PayloadTooLargeError()
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
