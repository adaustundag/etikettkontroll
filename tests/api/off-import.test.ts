import { describe, expect, test } from 'bun:test'
import { mapOffProduct } from '@/lib/off-import'

const base = {
  code: '7310865004703',
  product_name: 'Garant Ekologiska Havreflingor',
  brands: 'Garant, Axfood',
  ingredients_text: 'Havreflingor, havre.',
  nutriments: {
    'energy-kcal_100g': 375,
    'proteins_100g': 13.5,
    'carbohydrates_100g': 58,
    'sugars_100g': 1.5,
    'fat_100g': 7,
    'salt_100g': 0.01,
  },
  serving_size: '100 g',
  image_front_small_url: 'https://images.openfoodfacts.org/images/products/front_small.jpg',
}

describe('mapOffProduct — OFF row -> MappedProduct', () => {
  test('maps a complete product', () => {
    const r = mapOffProduct(base)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.barcode).toBe('7310865004703')
    expect(r.data.name).toBe('Garant Ekologiska Havreflingor')
    expect(r.data.brand).toBe('Garant') // first brand only
    expect(r.data.calories).toBe(375)
    expect(r.data.protein).toBe(13.5)
    expect(r.data.salt).toBe(0.01)
    expect(r.data.servingSize).toBe('100 g')
    expect(r.data.imageUrl).toContain('front_small')
  })

  test('prefers the Swedish name and ingredients when present', () => {
    const r = mapOffProduct({ ...base, product_name: 'English Fallback', product_name_sv: 'Svenskt namn', ingredients_text: 'english', ingredients_text_sv: 'havre, vatten, salt.' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.name).toBe('Svenskt namn')
    expect(r.data.ingredients).toBe('havre, vatten, salt.')
  })

  test('converts kJ to kcal when only energy-kj is present', () => {
    const r = mapOffProduct({ ...base, nutriments: { 'energy-kj_100g': 1570 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.calories).toBe(375.2) // 1570 / 4.184, 1 decimal
  })

  test('rejects invalid rows with a reason', () => {
    expect(mapOffProduct({ ...base, code: '123' }).ok).toBe(false) // too short
    expect(mapOffProduct({ ...base, code: 'abc' }).ok).toBe(false)
    expect(mapOffProduct({ ...base, product_name: ' ' }).ok).toBe(false)
    expect(mapOffProduct({ ...base, brands: '' }).ok).toBe(false)
    expect(mapOffProduct({ ...base, ingredients_text: 'salt' }).ok).toBe(false) // < 5 chars
    expect(mapOffProduct({ ...base, ingredients_text: '' }).ok).toBe(false)
  })

  test('ignores garbage nutrition values and missing image urls', () => {
    const r = mapOffProduct({
      ...base,
      nutriments: { 'energy-kcal_100g': 99_999, 'proteins_100g': -5 },
      image_front_small_url: 'http://insecure.example/x.jpg',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.calories).toBeNull()
    expect(r.data.protein).toBeNull()
    expect(r.data.imageUrl).toBeNull()
  })
})

describe('mapOffProduct — 30F upstream-validation hardening', () => {
  test('null/undefined/array rows yield a shape reason, never a throw', () => {
    expect(mapOffProduct(null).ok).toBe(false)
    expect(mapOffProduct(undefined).ok).toBe(false)
    expect(mapOffProduct([base]).ok).toBe(false)
    expect(mapOffProduct({ ...base, nutriments: 'garbage' }).ok).toBe(false)
  })

  test('numeric barcode code is accepted (upstream sends numbers sometimes)', () => {
    const r = mapOffProduct({ ...base, code: 7310865004703 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.barcode).toBe('7310865004703')
  })

  test('oversize ingredient evidence is REJECTED, not silently truncated', () => {
    const r = mapOffProduct({ ...base, ingredients_text: 'x'.repeat(9000) })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('ingredients_length')
  })

  test('oversize serving size is rejected, not truncated', () => {
    const r = mapOffProduct({ ...base, serving_size: 'y'.repeat(61) })
    expect(r.ok).toBe(false)
  })

  test('image URLs are restricted to the exact OFF host allowlist', () => {
    const ok = mapOffProduct({ ...base, image_front_small_url: 'https://images.openfoodfacts.org/a.jpg' })
    const lookalike = mapOffProduct({ ...base, image_front_small_url: 'https://images.openfoodfacts.org.evil.se/a.jpg' })
    const ipLiteral = mapOffProduct({ ...base, image_front_small_url: 'https://1.2.3.4/a.jpg' })
    const withCreds = mapOffProduct({ ...base, image_front_small_url: 'https://user:pw@images.openfoodfacts.org/a.jpg' })
    const otherPort = mapOffProduct({ ...base, image_front_small_url: 'https://images.openfoodfacts.org:8443/a.jpg' })
    expect(ok.ok && ok.data.imageUrl).toContain('images.openfoodfacts.org')
    expect(lookalike.ok && lookalike.data.imageUrl).toBeNull()
    expect(ipLiteral.ok && ipLiteral.data.imageUrl).toBeNull()
    expect(withCreds.ok && withCreds.data.imageUrl).toBeNull()
    expect(otherPort.ok && otherPort.data.imageUrl).toBeNull()
  })

  test('invisible/bidi characters in OFF text are stripped (30C pipeline shared)', () => {
    const r = mapOffProduct({ ...base, product_name: 'Ka\u200Bller\u200Es Kaviar' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.name).toBe('Kallers Kaviar')
  })
})
