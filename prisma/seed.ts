/**
 * EtikettKontroll demo seed.
 * Run: bun prisma/seed.ts
 * Creates demo users (password: demo1234), Swedish grocery products with
 * approved revision history, pending changes for the review queue, comments.
 */
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/lib/password'

const db = new PrismaClient()

const daysAgo = (n: number, hours = 0) => new Date(Date.now() - n * 86400000 - hours * 3600000)

function ean13(base: string): string {
  // EAN-13 = 12 data digits + 1 check digit. Pad 11-digit bases to 12.
  const digits = base.length === 12 ? base : base + '0'
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3)
  return digits + ((10 - (sum % 10)) % 10)
}

async function main() {
  console.log('Seeding EtikettKontroll demo data…')

  // wipe (demo only)
  await db.karmaEvent.deleteMany()
  await db.review.deleteMany()
  await db.productComment.deleteMany()
  await db.productRevision.deleteMany()
  await db.product.deleteMany()
  await db.user.deleteMany()

  const pw = hashPassword('demo1234')

  const maja = await db.user.create({ data: { email: 'maja@etikettkontroll.se', name: 'Maja Lindqvist', passwordHash: pw, karma: 512, trustLevel: 3, createdAt: daysAgo(400) } })
  const erik = await db.user.create({ data: { email: 'erik@etikettkontroll.se', name: 'Erik Sundström', passwordHash: pw, karma: 341, trustLevel: 3, createdAt: daysAgo(320) } })
  const anna = await db.user.create({ data: { email: 'anna@etikettkontroll.se', name: 'Anna Ekström', passwordHash: pw, karma: 142, trustLevel: 2, createdAt: daysAgo(210) } })
  const gustav = await db.user.create({ data: { email: 'gustav@etikettkontroll.se', name: 'Gustav Berg', passwordHash: pw, karma: 45, trustLevel: 1, createdAt: daysAgo(95) } })
  const linnea = await db.user.create({ data: { email: 'linnea@etikettkontroll.se', name: 'Linnea Falk', passwordHash: pw, karma: 0, trustLevel: 0, createdAt: daysAgo(3) } })

  type SeedProduct = {
    base: string
    name: string
    brand: string
    ingredients: string
    servingSize?: string
    calories?: number
    protein?: number
    carbs?: number
    sugars?: number
    fat?: number
    salt?: number
    addedBy: { id: string }
    reviewedBy: { id: string }
    daysBack: number
    v2?: { submittedBy: { id: string }; status: 'auto_approved' | 'pending'; autoNote?: string; patch: Partial<{ servingSize: string; calories: number; protein: number; carbs: number; sugars: number; fat: number; salt: number; ingredients: string }>; changedFields: string[]; requiredApprovals?: number; approvedCount?: number }
  }

  const seedProducts: SeedProduct[] = [
    {
      base: '73100701007',
      name: 'Kalles Kaviar Original 190 g',
      brand: 'Abba',
      ingredients:
        'Rökt torskrom 62 %, rapsolja, vatten, salt, potatisflockar, socker, tomatpuré, lökpulver, dill, citronsyra, kryddor, antioxidant (askorbinsyra), färgämne (astaxantin).',
      calories: 240, protein: 16, carbs: 5.5, sugars: 2.5, fat: 17, salt: 4.2,
      addedBy: maja, reviewedBy: erik, daysBack: 42,
    },
    {
      base: '64084301089',
      name: 'Oatly Havredryck Barista Edition',
      brand: 'Oatly',
      ingredients: 'Vatten, havre 10 %, rapsolja, kalciumkarbonat, salt, vitaminer (D, riboflavin, B12).',
      calories: 59, protein: 1.0, carbs: 6.6, sugars: 3.5, fat: 3.0, salt: 0.1,
      addedBy: erik, reviewedBy: maja, daysBack: 30,
    },
    {
      base: '73004001777',
      name: 'Wasa Fullkorn Knäckebröd',
      brand: 'Wasa',
      ingredients: 'Helfvetemjöl, rågmjöl, vetestärkelse, jäst, salt.',
      calories: 350, protein: 11, carbs: 62, sugars: 2.2, fat: 2.5, salt: 0.9,
      addedBy: anna, reviewedBy: maja, daysBack: 21,
      v2: {
        submittedBy: anna,
        status: 'auto_approved',
        autoNote: 'Auto-published: Trusted contributor',
        patch: { servingSize: '1 skiva (8 g)' },
        changedFields: ['servingSize'],
      },
    },
    {
      base: '73105001234',
      name: 'Marabou Mjölkchoklad 200 g',
      brand: 'Marabou',
      ingredients:
        'Socker, kakaosmör, kakaomassa, skummjölkpulver, vasslepulver, smörfett, emulgeringsmedel (sojalecitin, E476), arom (vanillin).',
      calories: 535, protein: 7.0, carbs: 59, sugars: 56, fat: 30, salt: 0.47,
      addedBy: maja, reviewedBy: anna, daysBack: 14,
    },
    {
      base: '73108650047',
      name: 'Garant Ekologiska Havreflingor 750 g',
      brand: 'Garant',
      ingredients: 'Havre 100 %.',
      calories: 370, protein: 13, carbs: 60, sugars: 1.3, fat: 7.0, salt: 0.01,
      addedBy: gustav, reviewedBy: erik, daysBack: 10,
    },
    {
      base: '64052100044',
      name: 'Arla Ko Mellanmjölk 3 % 1 l',
      brand: 'Arla',
      ingredients: 'Mjölk, enzym (laktas).',
      calories: 59, protein: 3.5, carbs: 4.7, sugars: 4.7, fat: 3.0, salt: 0.1,
      addedBy: erik, reviewedBy: maja, daysBack: 6,
    },
    {
      base: '73113110011',
      name: 'Felix Ketchup Original 500 g',
      brand: 'Felix',
      ingredients: 'Tomatpuré 78 %, socker, ättika, salt, kryddor, lökpulver, kryddpeppar.',
      calories: 98, protein: 1.2, carbs: 21, sugars: 19, fat: 0.1, salt: 1.5,
      addedBy: anna, reviewedBy: erik, daysBack: 4,
    },
  ]

  for (const sp of seedProducts) {
    const barcode = ean13(sp.base)
    const product = await db.product.create({
      data: {
        barcode,
        name: sp.name,
        brand: sp.brand,
        createdAt: daysAgo(sp.daysBack),
        updatedAt: daysAgo(sp.daysBack),
      },
    })

    const v1 = await db.productRevision.create({
      data: {
        productId: product.id,
        version: 1,
        submittedById: sp.addedBy.id,
        name: sp.name,
        brand: sp.brand,
        ingredients: sp.ingredients,
        calories: sp.calories,
        protein: sp.protein,
        carbs: sp.carbs,
        sugars: sp.sugars,
        fat: sp.fat,
        salt: sp.salt,
        status: 'approved',
        requiredApprovals: sp.addedBy.id === gustav.id ? 2 : 1,
        approvedCount: 1,
        changedFields: JSON.stringify(['name', 'brand', 'ingredients', 'calories', 'protein', 'carbs', 'sugars', 'fat', 'salt']),
        createdAt: daysAgo(sp.daysBack),
        finalizedAt: daysAgo(sp.daysBack, -2),
      },
    })
    await db.review.create({
      data: {
        revisionId: v1.id,
        reviewerId: sp.reviewedBy.id,
        verdict: 'approve',
        comment: 'Stämmer med etikettfotot.',
        createdAt: daysAgo(sp.daysBack, -1),
      },
    })
    await db.karmaEvent.create({
      data: { userId: sp.addedBy.id, delta: 2, reason: 'revision_approved', refId: v1.id, createdAt: daysAgo(sp.daysBack) },
    })

    if (sp.v2) {
      const patch = sp.v2.patch
      const v2 = await db.productRevision.create({
        data: {
          productId: product.id,
          version: 2,
          submittedById: sp.v2.submittedBy.id,
          name: sp.name,
          brand: sp.brand,
          ingredients: patch.ingredients ?? sp.ingredients,
          servingSize: patch.servingSize ?? null,
          calories: patch.calories ?? sp.calories,
          protein: patch.protein ?? sp.protein,
          carbs: patch.carbs ?? sp.carbs,
          sugars: patch.sugars ?? sp.sugars,
          fat: patch.fat ?? sp.fat,
          salt: patch.salt ?? sp.salt,
          status: sp.v2.status === 'auto_approved' ? 'approved' : 'pending',
          requiredApprovals: sp.v2.requiredApprovals ?? 0,
          approvedCount: sp.v2.approvedCount ?? 0,
          changedFields: JSON.stringify(sp.v2.changedFields),
          autoNote: sp.v2.autoNote ?? null,
          createdAt: daysAgo(Math.max(1, sp.daysBack - 8)),
          finalizedAt: sp.v2.status === 'auto_approved' ? daysAgo(Math.max(1, sp.daysBack - 8)) : null,
        },
      })
      if (sp.v2.status === 'auto_approved') {
        await db.karmaEvent.create({
          data: { userId: sp.v2.submittedBy.id, delta: 2, reason: 'revision_approved', refId: v2.id },
        })
      }
      await db.product.update({ where: { id: product.id }, data: { updatedAt: daysAgo(Math.max(1, sp.daysBack - 8)) } })
    }
  }

  // Moderator correction history (auto-published fillers) so trust levels
  // are consistent with karma in the demo data.
  const filler: {
    productBase: string
    userId: string
    patch: Record<string, string | number | null>
    changed: string[]
    daysBack: number
  }[] = [
    { productBase: '64084301089', userId: maja.id, patch: { sugars: 3.4 }, changed: ['sugars'], daysBack: 12 },
    { productBase: '73113110011', userId: maja.id, patch: { salt: 1.4 }, changed: ['salt'], daysBack: 9 },
    { productBase: '64052100044', userId: maja.id, patch: { servingSize: '100 ml' }, changed: ['servingSize'], daysBack: 5 },
    { productBase: '73108650047', userId: erik.id, patch: { protein: 13.5 }, changed: ['protein'], daysBack: 8 },
    { productBase: '73105001234', userId: erik.id, patch: { servingSize: '1 ruta (25 g)' }, changed: ['servingSize'], daysBack: 7 },
    { productBase: '73100701007', userId: erik.id, patch: { protein: 15.8 }, changed: ['protein'], daysBack: 3 },
  ]
  for (const f of filler) {
    const product = await db.product.findUniqueOrThrow({ where: { barcode: ean13(f.productBase) } })
    const last = await db.productRevision.findFirstOrThrow({
      where: { productId: product.id },
      orderBy: { version: 'desc' },
    })
    await db.productRevision.create({
      data: {
        productId: product.id,
        version: last.version + 1,
        submittedById: f.userId,
        name: last.name,
        brand: last.brand,
        ingredients: last.ingredients,
        servingSize: f.patch.servingSize !== undefined ? (f.patch.servingSize as string | null) : last.servingSize,
        calories: f.patch.calories !== undefined ? (f.patch.calories as number) : last.calories,
        protein: f.patch.protein !== undefined ? (f.patch.protein as number) : last.protein,
        carbs: f.patch.carbs !== undefined ? (f.patch.carbs as number) : last.carbs,
        sugars: f.patch.sugars !== undefined ? (f.patch.sugars as number) : last.sugars,
        fat: f.patch.fat !== undefined ? (f.patch.fat as number) : last.fat,
        salt: f.patch.salt !== undefined ? (f.patch.salt as number) : last.salt,
        status: 'approved',
        autoNote: 'Auto-published: Moderator correction',
        requiredApprovals: 0,
        changedFields: JSON.stringify(f.changed),
        createdAt: daysAgo(f.daysBack),
        finalizedAt: daysAgo(f.daysBack),
      },
    })
  }

  // Pending revisions for the review queue
  const kaviar = await db.product.findUniqueOrThrow({ where: { barcode: ean13('73100701007') } })
  const wasa = await db.product.findUniqueOrThrow({ where: { barcode: ean13('73004001777') } })

  await db.productRevision.create({
    data: {
      productId: kaviar.id,
      version: 3,
      submittedById: linnea.id,
      name: kaviar.name,
      brand: kaviar.brand,
      ingredients:
        'Rökt torskrom 62 %, rapsolja, vatten, salt, potatisflockar, socker, tomatpuré, lökpulver, dill, citronsyra, kryddor, antioxidant (askorbinsyra), färgämne (astaxantin).',
      calories: 240, protein: 16, carbs: 5.5, sugars: 2.5, fat: 17, salt: 2.1,
      status: 'pending',
      requiredApprovals: 2,
      changedFields: JSON.stringify(['protein', 'salt']),
      createdAt: daysAgo(0, 5),
    },
  })

  await db.productRevision.create({
    data: {
      productId: wasa.id,
      version: 3,
      submittedById: gustav.id,
      name: wasa.name,
      brand: wasa.brand,
      ingredients: 'Helfvetemjöl, rågmjöl, vetestärkelse, jäst, salt.',
      servingSize: '1 skiva (8 g)',
      calories: 350, protein: 11, carbs: 62, sugars: 2.2, fat: 2.5, salt: 0.55,
      status: 'pending',
      requiredApprovals: 1,
      changedFields: JSON.stringify(['salt']),
      createdAt: daysAgo(0, 2),
    },
  })

  // Comments
  await db.productComment.create({
    data: {
      productId: kaviar.id,
      userId: anna.id,
      body: '2024 års recept ska ha lägre salt enligt Abba — någon som har ett nytt paket hemma och kan dubbelkolla näringsvärdena?',
      createdAt: daysAgo(1),
    },
  })
  await db.productComment.create({
    data: {
      productId: kaviar.id,
      userId: erik.id,
      body: 'Salt 2,1 g i det föreslagna förslaget låter för lånt — originaldeklarationen brukar ligga kring 4 g. Behöver foto på näringsvärdestabellen innan godkännande.',
      createdAt: daysAgo(0, 20),
    },
  })
  await db.productComment.create({
    data: {
      productId: wasa.id,
      userId: maja.id,
      body: 'Fullkornsvarianten har 0,55 g salt i den nya deklarationen, så ändringen ser korrekt ut.',
      createdAt: daysAgo(0, 1),
    },
  })

  const counts = {
    users: await db.user.count(),
    products: await db.product.count(),
    revisions: await db.productRevision.count(),
    reviews: await db.review.count(),
    pending: await db.productRevision.count({ where: { status: 'pending' } }),
  }
  console.log('Seed complete:', counts)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
