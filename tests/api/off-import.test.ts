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

  test('derives salt from sodium when salt is absent', () => {
    const r = mapOffProduct({ ...base, nutriments: { sodium_100g: 0.1 } })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.salt).toBe(0.25) // 0.1 * 2.5
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
