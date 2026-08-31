import {
  LABEL_FIELDS,
  NUMERIC_FIELDS,
  type LabelField,
  type LabelValues,
} from '@/lib/types'

// Pure label helpers shared by server routes and client UI.

export function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

export function extractLabelValues(payload: {
  name?: string | null
  brand?: string | null
  ingredients?: string | null
  servingSize?: string | null
  calories?: unknown
  protein?: unknown
  carbs?: unknown
  sugars?: unknown
  fat?: unknown
  salt?: unknown
  frontImage?: string | null
  ingredientsImage?: string | null
  nutritionImage?: string | null
}): LabelValues {
  return {
    name: (payload.name || '').trim(),
    brand: (payload.brand || '').trim(),
    ingredients: (payload.ingredients || '').trim(),
    servingSize: (payload.servingSize || '').trim() || null,
    calories: toNum(payload.calories),
    protein: toNum(payload.protein),
    carbs: toNum(payload.carbs),
    sugars: toNum(payload.sugars),
    fat: toNum(payload.fat),
    salt: toNum(payload.salt),
    frontImage: payload.frontImage || null,
    ingredientsImage: payload.ingredientsImage || null,
    nutritionImage: payload.nutritionImage || null,
  }
}

export function computeChangedFields(next: LabelValues, prev: LabelValues | null): LabelField[] {
  if (!prev) return [...LABEL_FIELDS]
  return LABEL_FIELDS.filter((f) => {
    const a = next[f]
    const b = prev[f]
    if (NUMERIC_FIELDS.includes(f)) return toNum(a) !== toNum(b)
    return (a ?? null) !== (b ?? null)
  })
}

export function formatValue(field: LabelField, value: string | number | null): string {
  if (value === null || value === undefined || value === '') return '—'
  if (NUMERIC_FIELDS.includes(field)) {
    const n = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(value)
  }
  return String(value)
}
