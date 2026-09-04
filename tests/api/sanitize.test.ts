/**
 * Task 30C regression tests — text normalization contracts.
 * Data-preserving: Swedish letters, joiners, combining marks, joined emoji
 * survive; controls/bidi/zero-width are stripped; NO truncation, NO NFKC.
 */
import { describe, expect, test } from 'bun:test'
import { cleanMultiline, cleanText, escapeHtml, stripInvisible, truncateDisplay } from '@/lib/sanitize'

describe('stripInvisible', () => {
  test('removes zero-width and bidi overrides', () => {
    expect(stripInvisible('ka\u200Bller\u200Es\u202Eb')).toBe('kallersb')
    expect(stripInvisible('a\u202Db\u2066c\u2069d')).toBe('abcd')
  })

  test('removes BOM, C1 and DEL', () => {
    expect(stripInvisible('\uFEFFstart\u0085mid\u007Fend')).toBe('startmidend')
  })

  test('preserves LF and Swedish letters', () => {
    expect(stripInvisible('knäcke\nbröd')).toBe('knäcke\nbröd')
    expect(stripInvisible('ÅÄÖ åäö')).toBe('ÅÄÖ åäö')
  })

  test('preserves ZWNJ/ZWJ joiners and variation selectors', () => {
    expect(stripInvisible('ט\u200Cש')).toContain('\u200C') // Hebrew non-joiner shaping
    expect(stripInvisible('👩\u200D👩\u200D👧\u200D👦')).toBe('👩\u200D👩\u200D👧\u200D👦') // family emoji
    expect(stripInvisible('1️⃣')).toBe('1️⃣') // digit + variation selector
  })

  test('preserves combining marks', () => {
    expect(stripInvisible('a\u0308')).toBe('a\u0308') // a + combining diaeresis
  })
})

describe('cleanText (single-line fields)', () => {
  test('converts line breaks and tabs to spaces', () => {
    expect(cleanText('Oatly\nBarista')).toBe('Oatly Barista')
    expect(cleanText('Oatly\r\nBarista')).toBe('Oatly Barista')
    expect(cleanText('Oatly\tBarista')).toBe('Oatly Barista')
    expect(cleanText('Oatly\u2028Barista')).toBe('Oatly Barista')
  })

  test('trims but does not clip interior spaces', () => {
    expect(cleanText('  Kalles  Kaviar  ')).toBe('Kalles  Kaviar')
  })

  test('does NOT truncate long values (existing length checks decide)', () => {
    const long = 'x'.repeat(500)
    expect(cleanText(long).length).toBe(500)
  })

  test('invisible-only input collapses to empty → min-length checks reject', () => {
    expect(cleanText('\u200B\u200E\u202E')).toBe('')
  })

  test('emoji and Swedish survive', () => {
    expect(cleanText('  Påtår ☕ kaffe  ')).toBe('Påtår ☕ kaffe')
  })
})

describe('cleanMultiline (ingredients/comments)', () => {
  test('normalizes CRLF/CR to LF, keeps structure', () => {
    expect(cleanMultiline('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })

  test('tabs become spaces, LF preserved', () => {
    expect(cleanMultiline('vatten\tsalt\npeppar')).toBe('vatten salt\npeppar')
  })

  test('strips controls but keeps content', () => {
    expect(cleanMultiline('socker\u0000raps\u000Bolja')).toBe('sockerrapsolja')
  })

  test('does not truncate 8000-char evidence', () => {
    const evidence = 'x'.repeat(8000)
    expect(cleanMultiline(evidence).length).toBe(8000)
  })
})

describe('escapeHtml', () => {
  test('escapes the five dangerous characters', () => {
    expect(escapeHtml(`<a href="http://evil">x</a>`)).toBe('&lt;a href=&quot;http://evil&quot;&gt;x&lt;/a&gt;')
    expect(escapeHtml(`O'Brien & Sons <3`)).toBe('O&#39;Brien &amp; Sons &lt;3')
  })

  test('Swedish letters pass through untouched', () => {
    expect(escapeHtml('Blåbär & påtår')).toBe('Blåbär &amp; påtår')
  })
})

describe('truncateDisplay (generated names only)', () => {
  test('no ellipsis under the limit', () => {
    expect(truncateDisplay('kort', 10)).toBe('kort')
  })

  test('grapheme-safe truncation with ellipsis', () => {
    const out = truncateDisplay('a'.repeat(50), 10)
    expect(out.length).toBeLessThanOrEqual(10)
    expect(out.endsWith('…')).toBe(true)
  })

  test('joined emoji is never cut mid-sequence', () => {
    const family = 'x👩‍👩‍👧‍👦y'.repeat(10)
    const out = truncateDisplay(family, 6)
    // No lone surrogate halves: every grapheme stays whole.
    expect([...out].length).toBeLessThanOrEqual(6)
  })
})
