/**
 * Text normalization contracts (Task 30C / audit I04).
 *
 * Data-preserving by design: submitted label text is evidence. These helpers
 * remove only characters that have no business in stored text — controls,
 * bidi overrides and zero-width marks used for obfuscation — and never
 * truncate, NFKC-normalize, ASCII-fold or HTML-encode anything.
 *
 * Preserved on purpose: Swedish letters (åäö/ÅÄÖ), combining marks,
 * variation selectors, ZWNJ (U+200C) and ZWJ (U+200D) so joined emoji and
 * legit script shaping survive; ordinary interior whitespace in multiline
 * fields.
 *
 * Contracts:
 *  - stripInvisible(s):  remove the selected control set (see below). LF kept.
 *  - cleanText(s):       single-line value → line breaks/tabs become spaces,
 *                        strip selected controls, trim. No clipping.
 *  - cleanMultiline(s):  normalize CRLF/CR → LF, tabs → spaces, strip selected
 *                        controls (LF kept), trim. No clipping.
 *  - escapeHtml(s):      HTML text/attribute sink encoding. Call at the sink,
 *                        never before storage.
 *
 * Neither cleanup helper takes a maximum — existing length checks run AFTER
 * normalization at the call sites, preserving their error messages.
 */

/** C0 controls except LF (kept for multiline); DEL; C1 controls. */
const CONTROL_RE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g
/** Zero-width + directional marks (NOT U+200C/U+200D joiners). */
const INVISIBLE_RE = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g
/** Unicode line/paragraph separators → space in single-line fields. */
const LINE_SEPARATORS = /[\u2028\u2029]/g

export function stripInvisible(s: string): string {
  return s
    .replace(CONTROL_RE, (ch) => (ch === '\n' ? '\n' : ''))
    .replace(INVISIBLE_RE, '')
}

/** Single-line field: no line structure may survive. */
export function cleanText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u2028\u2029]+/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(CONTROL_RE, '')
    .replace(INVISIBLE_RE, '')
    .trim()
}

/** Multiline field: keep LF, normalize other line endings, tabs → spaces. */
export function cleanMultiline(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u2028\u2029]+/g, ' ')
    .replace(CONTROL_RE, (ch) => (ch === '\n' ? '\n' : ''))
    .replace(INVISIBLE_RE, '')
    .trim()
}

/** Escape for HTML text and double/single-quoted attribute contexts. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Display-only truncation for GENERATED strings (magic-link/OAuth display
 * names, OG previews) — grapheme-safe via the segmenter where available,
 * ellipsis-terminated. NEVER for submitted label evidence (that is rejected,
 * not clipped). Falls back to a code-point-safe slice.
 */
export function truncateDisplay(s: string, max: number): string {
  if (s.length <= max) return s
  const Seg = (globalThis as { Intl?: { Segmenter?: new (l: string, o: { granularity: string }) => { segment(s: string): Iterable<{ segment: string }> } } }).Intl
  if (Seg?.Segmenter) {
    const seg = new Seg.Segmenter('sv', { granularity: 'grapheme' })
    let out = ''
    for (const part of seg.segment(s)) {
      if (out.length + part.segment.length > max - 1) break
      out += part.segment
    }
    return `${out}…`
  }
  return `${s.slice(0, Math.max(1, max - 1))}…`
}
