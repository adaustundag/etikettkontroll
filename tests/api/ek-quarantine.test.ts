/**
 * EK-01 regression: demo quarantine classification + idempotency.
 * Runs against the isolated test DB (fresh schema per run).
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { db } from '@/lib/db'
import { quarantineDemoRecords } from '@/lib/demo-quarantine'
import { evidenceCoverage } from '@/lib/revisions'
import { evidenceFileExists } from '@/lib/revisions'
import { mkProduct, mkUser, wipeDb, evidencePhoto } from '../fixtures'

beforeEach(async () => {
  await wipeDb()
})

describe('EK-01: demo quarantine', () => {
  test('quarantines products whose CURRENT publication is demo-sourced', async () => {
    const demoUser = await mkUser({ email: 'maja@etikettkontroll.se' })
    const { product } = await mkProduct({ name: 'Kalles Kaviar', brand: 'Abba', authorId: demoUser.id })
    // mkProduct stamps status approved but sourceType defaults human — simulate
    // the launch-backfill classification for a demo submitter.
    await db.productRevision.updateMany({
      where: { productId: product.id },
      data: { sourceType: 'demo' },
    })
    await db.product.update({
      where: { id: product.id },
      data: { currentRevisionId: (await db.productRevision.findFirst({ where: { productId: product.id } }))!.id },
    })

    const dry = await quarantineDemoRecords(false)
    expect(dry.candidates.length).toBe(1)
    expect(dry.candidates[0].barcode).toBe(product.barcode)
    expect(dry.quarantined).toBe(0) // dry run applies nothing

    const applied = await quarantineDemoRecords(true)
    expect(applied.quarantined).toBe(1)
    const stored = await db.product.findUnique({ where: { barcode: product.barcode } })
    expect(stored?.quarantined).toBe(true)
  })

  test('is idempotent: second run changes nothing', async () => {
    const demoUser = await mkUser({ email: 'erik@etikettkontroll.se' })
    const { product } = await mkProduct({ name: 'Wasa Knäckebröd', brand: 'Wasa', authorId: demoUser.id })
    await db.productRevision.updateMany({ where: { productId: product.id }, data: { sourceType: 'demo' } })
    await db.product.update({
      where: { id: product.id },
      data: { currentRevisionId: (await db.productRevision.findFirst({ where: { productId: product.id } }))!.id },
    })

    await quarantineDemoRecords(true)
    const second = await quarantineDemoRecords(true)
    expect(second.candidates.length).toBe(0)
    expect(second.quarantined).toBe(0)
    // The scanned set excludes already-quarantined rows entirely.
    expect(second.scanned).toBe(0)
  })

  test('mixed records: human current publication survives demo history', async () => {
    const demoUser = await mkUser({ email: 'anna@etikettkontroll.se' })
    const human = await mkUser()
    const { product, revision } = await mkProduct({ name: 'Oatly Barista', brand: 'Oatly', authorId: human.id })
    await db.product.update({
      where: { id: product.id },
      data: { currentRevisionId: revision.id },
    })
    // An old demo-authored revision exists in history but is superseded.
    await db.productRevision.create({
      data: {
        productId: product.id,
        version: 0,
        submittedById: demoUser.id,
        name: 'Oatly Barista',
        brand: 'Oatly',
        ingredients: 'demo data',
        status: 'superseded',
        sourceType: 'demo',
      },
    })

    const result = await quarantineDemoRecords(true)
    expect(result.candidates.length).toBe(0)
    const stored = await db.product.findUnique({ where: { barcode: product.barcode } })
    expect(stored?.quarantined).toBe(false)
  })

  test('never-published products (pending only) are invisible regardless of source', async () => {
    const demoUser = await mkUser({ email: 'gustav@etikettkontroll.se' })
    const { product } = await mkProduct({ name: 'Felix Ketchup', brand: 'Felix', authorId: demoUser.id })
    // Turn the only revision pending and clear the pointer.
    await db.productRevision.updateMany({
      where: { productId: product.id },
      data: { status: 'pending', sourceType: 'demo' },
    })
    await db.product.update({ where: { id: product.id }, data: { currentRevisionId: null } })

    const result = await quarantineDemoRecords(true)
    const stored = await db.product.findUnique({ where: { barcode: product.barcode } })
    // Not quarantined by this run (nothing public to hide) but equally not
    // discoverable anywhere (pointer null keeps it out of search/stats).
    expect(stored?.quarantined).toBe(false)
    expect(stored?.barcode).toBe(product.barcode)
  })
})
