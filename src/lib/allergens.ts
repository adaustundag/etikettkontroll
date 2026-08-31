/**
 * Allergen detection for ingredient lists (EN + SV keywords).
 * Used to highlight allergens on the product page — a big win for "avg Joe".
 */
export type AllergenKey =
  | 'gluten'
  | 'milk'
  | 'egg'
  | 'peanuts'
  | 'nuts'
  | 'soy'
  | 'fish'
  | 'shellfish'
  | 'sesame'
  | 'mustard'
  | 'celery'
  | 'sulphites'
  | 'lupin'

export const ALLERGEN_LABELS: Record<AllergenKey, { en: string; sv: string }> = {
  gluten: { en: 'Gluten', sv: 'Gluten' },
  milk: { en: 'Milk', sv: 'Mjölk' },
  egg: { en: 'Egg', sv: 'Ägg' },
  peanuts: { en: 'Peanuts', sv: 'Jordnötter' },
  nuts: { en: 'Tree nuts', sv: 'Nötter' },
  soy: { en: 'Soy', sv: 'Soja' },
  fish: { en: 'Fish', sv: 'Fisk' },
  shellfish: { en: 'Shellfish', sv: 'Skaldjur' },
  sesame: { en: 'Sesame', sv: 'Sesam' },
  mustard: { en: 'Mustard', sv: 'Senap' },
  celery: { en: 'Celery', sv: 'Selleri' },
  sulphites: { en: 'Sulphites', sv: 'Sulfiter' },
  lupin: { en: 'Lupin', sv: 'Lupin' },
}

const KEYWORDS: Record<AllergenKey, string[]> = {
  gluten: ['gluten', 'wheat', 'barley', 'rye', 'spelt', 'vete', 'korn', 'råg'],
  milk: ['milk', 'lactose', 'whey', 'butter', 'cream', 'mjölk', 'laktos', 'vassla', 'smör', 'grädde'],
  egg: ['egg', 'ägg'],
  peanuts: ['peanut', 'arachis', 'jordnöt'],
  nuts: [
    'almond', 'hazelnut', 'walnut', 'cashew', 'pistachio', 'pecan', 'macadamia',
    'mandel', 'hasselnöt', 'valnöt', 'pistage',
  ],
  soy: ['soy', 'soya', 'soja', 'sojabön'],
  fish: ['fish', 'salmon', 'tuna', 'herring', 'cod', 'torskrom', 'fisk', 'lax', 'torsk', 'sill', 'tonfisk'],
  shellfish: [
    'shrimp', 'prawn', 'crab', 'lobster', 'crayfish', 'mussel', 'oyster', 'scallop', 'squid',
    'räka', 'räkor', 'kräfta', 'hummer', 'mussla', 'ostron',
  ],
  sesame: ['sesame', 'sesam'],
  mustard: ['mustard', 'senap'],
  celery: ['celery', 'selleri'],
  sulphites: ['sulphite', 'sulfite', 'sulphur dioxide', 'sulfur dioxide', 'svaveldioxid', 'svavel'],
  lupin: ['lupin'],
}

export type MatchRange = { start: number; end: number; key: AllergenKey }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// One big alternation, mapping each keyword back to its allergen key.
const KEY_TO_TERM: { term: string; key: AllergenKey }[] = Object.entries(KEYWORDS).flatMap(
  ([key, terms]) => terms.map((term) => ({ term, key: key as AllergenKey })),
)
const ALTERNATION = KEY_TO_TERM.map((e) => `(${escapeRe(e.term)})`).join('|')
// Swedish letters count as word characters here so "mjölk" doesn't half-match.
const RE = new RegExp(`(^|[^\\p{L}\\p{N}])(${ALTERNATION})(?=[^\\p{L}\\p{N}]|$)`, 'giu')

export function detectAllergens(text: string): { found: AllergenKey[]; matches: MatchRange[] } {
  if (!text) return { found: [], matches: [] }
  const matches: MatchRange[] = []
  const found = new Set<AllergenKey>()
  RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = RE.exec(text)) !== null) {
    // group 1 = boundary, group 2 = matched keyword; nested groups follow
    const keyword = m[2]
    const start = m.index + m[1].length
    const end = start + keyword.length
    const entry = KEY_TO_TERM.find((e) => e.term.toLowerCase() === keyword.toLowerCase())
    if (entry) {
      matches.push({ start, end, key: entry.key })
      found.add(entry.key)
    }
  }
  return { found: [...found], matches }
}
