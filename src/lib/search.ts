import { existsSync } from 'fs'
import path from 'path'
import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import type { SearchItemDTO, SearchResponseDTO } from '@/lib/types'

/**
 * Product search: FTS5 trigram index (typo-tolerant substring matching) with a
 * plain-LIKE fallback. The index lives in the same SQLite file as Prisma's
 * data and is kept in sync by SQL triggers, so writes through Prisma are
 * indexed no matter which connection wrote them. bun:sqlite is loaded at
 * runtime via process.getBuiltinModule() — invisible to the bundler — and any
 * failure disables the index and falls back to LIKE, never breaking search.
 *
 * Swedish labels make case-folding critical: SQLite's LIKE/lower() only fold
 * ASCII, so "MJÖLK" never matches "mjölk". Index and query therefore
 * normalize text (lowercase + åäö→aao…) through one shared character map —
 * sqlNorm() must stay a mirror of normalizeForSearch().
 */

// Mirrors the SQL normalization chain built by sqlNorm().
const DIACRITICS: Record<string, string> = {
  å: 'a', ä: 'a', ö: 'o', à: 'a', á: 'a', â: 'a', ã: 'a', æ: 'a', ø: 'o',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ñ: 'n', ç: 'c',
}

export function normalizeForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[åäöàáâãæøèéêëìíîïòóôõùúûüñç]/g, (c) => DIACRITICS[c] ?? c)
    .replace(/ß/g, 'ss')
}

/** SQL-side mirror of normalizeForSearch() for trigger definitions. */
function sqlNorm(expr: string): string {
  let out = `lower(${expr})`
  for (const [from, to] of Object.entries(DIACRITICS)) {
    out = `replace(${out}, '${from}', '${to}')`
    const upper = from.toUpperCase()
    if (upper !== from) out = `replace(${out}, '${upper}', '${to}')`
  }
  return `replace(${out}, 'ß', 'ss')`
}

const normAll = (name: string, brand: string, barcode: string) =>
  `${sqlNorm(name)}||' '||${sqlNorm(brand)}||' '||${barcode}`

const FTS_TABLE = 'product_search_fts'

type BunStatement = { get: (...p: unknown[]) => unknown; all: (...p: unknown[]) => unknown[] }
type BunDatabase = { exec: (sql: string) => unknown; prepare: (sql: string) => BunStatement; close: () => void }

let sqliteDb: BunDatabase | null = null
let sqliteTried = false

/** bun:sqlite via runtime builtin lookup (never statically bundled). */
function getSqlite(): BunDatabase | null {
  if (sqliteTried) return sqliteDb
  sqliteTried = true
  try {
    const builtin = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule?.('bun:sqlite') as
      | { Database: new (p: string, o?: object) => BunDatabase }
      | undefined
    if (!builtin) return null
    const raw = process.env.DATABASE_URL ?? ''
    let file = raw.startsWith('file:') ? raw.slice(5) : raw
    file = file.split('?')[0]
    if (!file || !existsSync(file)) return null
    // NOTE: bun 1.4 throws SQLITE_MISUSE for an empty options object — pass none.
    const conn = new builtin.Database(file)
    conn.exec('PRAGMA busy_timeout = 5000')
    sqliteDb = conn
    return conn
  } catch {
    return null
  }
}

let ensurePromise: Promise<boolean> | null = null

/**
 * Idempotently installs the search index: FTS5 table, sync triggers and a
 * backfill of pre-existing rows. Safe to call on every boot; resolves false
 * when FTS5/bun:sqlite is unavailable (search then uses the LIKE fallback).
 */
export function ensureSearchIndex(): Promise<boolean> {
  ensurePromise ??= (async () => {
    try {
      const conn = getSqlite()
      if (!conn) return false
      // Feature probe before anything persistent.
      conn.exec("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x, tokenize='trigram')")
      conn.exec('DROP TABLE IF EXISTS _fts_probe')

      conn.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS ${FTS_TABLE} USING fts5(pid UNINDEXED, norm, tokenize='trigram')`)

      // Recreate triggers on every boot so their definitions follow the code.
      for (const name of ['product_search_ai', 'product_search_au', 'product_search_ad']) {
        conn.exec(`DROP TRIGGER IF EXISTS ${name}`)
      }
      conn.exec(`
        CREATE TRIGGER product_search_ai AFTER INSERT ON Product BEGIN
          INSERT INTO ${FTS_TABLE}(pid, norm) VALUES (new.id, ${normAll('new.name', 'new.brand', 'new.barcode')});
        END;
        CREATE TRIGGER product_search_au AFTER UPDATE OF name, brand ON Product BEGIN
          DELETE FROM ${FTS_TABLE} WHERE pid = old.id;
          INSERT INTO ${FTS_TABLE}(pid, norm) VALUES (new.id, ${normAll('new.name', 'new.brand', 'new.barcode')});
        END;
        CREATE TRIGGER product_search_ad AFTER DELETE ON Product BEGIN
          DELETE FROM ${FTS_TABLE} WHERE pid = old.id;
        END;
      `)

      conn.exec(`
        INSERT INTO ${FTS_TABLE}(pid, norm)
        SELECT id, ${normAll('name', 'brand', 'barcode')} FROM Product
        WHERE id NOT IN (SELECT pid FROM ${FTS_TABLE});
      `)
      return true
    } catch (err) {
      console.error('[search] FTS index unavailable, using LIKE fallback:', err instanceof Error ? err.message : err)
      return false
    }
  })()
  return ensurePromise
}

const APPROVED = ['approved', 'auto_approved']

const PRODUCT_INCLUDE = {
  revisions: {
    where: { status: { in: APPROVED } },
    orderBy: { version: 'desc' as const },
    take: 1,
    select: { frontImage: true, verifiedAt: true, sourceType: true },
  },
  _count: { select: { revisions: { where: { status: { in: APPROVED } } } } },
}

type ProductRow = {
  id: string
  barcode: string
  name: string
  brand: string
  createdAt: Date
  updatedAt: Date
  currentRevisionId: string | null
  quarantined: boolean
  revisions: { frontImage: string | null; verifiedAt: Date | null; sourceType: string }[]
  _count: { revisions: number }
}

function toDto(p: ProductRow): SearchItemDTO {
  const latest = p.revisions[0]
  return {
    id: p.id,
    barcode: p.barcode,
    name: p.name,
    brand: p.brand,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    frontImage: latest?.frontImage ?? null,
    approvedCount: p._count.revisions,
    sourceType: (latest?.sourceType as SearchItemDTO['sourceType']) ?? 'unknown_legacy',
    verified: Boolean(latest?.verifiedAt),
  }
}

/** Hydrates id lists through Prisma (proper Date objects, includes), preserving order. */
async function hydrate(ids: string[]): Promise<SearchItemDTO[]> {
  if (ids.length === 0) return []
  const rows = await db.product.findMany({ where: { id: { in: ids } }, include: PRODUCT_INCLUDE })
  const byId = new Map(rows.map((p) => [p.id, p]))
  return ids.map((id) => byId.get(id)).filter((p): p is ProductRow => Boolean(p)).map(toDto)
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

/** Per-token distance budget — generous enough for real typos, tight enough to stay relevant. */
function fuzzyBudget(token: string): number {
  if (token.length >= 6) return 2
  if (token.length >= 4) return 1
  return 0
}

/**
 * Last-resort fuzzy pass (runs only when the strict path found nothing):
 * every token must be within its edit-distance budget of some word in the
 * document; ranking by total distance then recency. Scans the whole corpus —
 * fine at this scale, revisit past ~50k products.
 */
async function fuzzySearch(tokens: string[], page: number, pageSize: number): Promise<{ ids: string[]; total: number } | null> {
  if (tokens.length === 0) return null
  try {
    const docs: { pid: string; norm: string; updatedAt: string }[] = []
    const conn = getSqlite()
    if (conn && (await ensureSearchIndex())) {
      // EK-01: same public-visibility contract as the strict path — only
      // published, non-quarantined records may be recovered by fuzzy search.
      const rows = conn
        .prepare(
          `SELECT f.pid AS pid, f.norm AS norm, p."updatedAt" AS updatedAt FROM ${FTS_TABLE} f
           JOIN Product p ON p.id = f.pid
           WHERE p."currentRevisionId" IS NOT NULL AND p."quarantined" = 0`,
        )
        .all() as Array<{ pid: string; norm: string; updatedAt: string }>
      docs.push(...rows)
    } else {
      const rows = await db.product.findMany({
        where: { currentRevisionId: { not: null }, quarantined: false },
        select: { id: true, name: true, brand: true, barcode: true, updatedAt: true },
      })
      for (const r of rows) {
        docs.push({ pid: r.id, norm: normalizeForSearch(`${r.name} ${r.brand} ${r.barcode}`), updatedAt: r.updatedAt.toISOString() })
      }
    }

    type Scored = { pid: string; score: number; updatedAt: string }
    const scored: Scored[] = []
    for (const d of docs) {
      const words = d.norm.split(/\s+/)
      let score = 0
      let ok = true
      for (const tok of tokens) {
        const budget = fuzzyBudget(tok)
        if (budget === 0) {
          ok = words.includes(tok)
          if (!ok) break
          continue
        }
        let best = Infinity
        for (const w of words) {
          if (Math.abs(w.length - tok.length) > budget) continue
          const dist = editDistance(tok, w)
          if (dist < best) best = dist
          if (best === 0) break
        }
        if (best > budget) {
          ok = false
          break
        }
        score += best
      }
      if (ok) scored.push({ pid: d.pid, score, updatedAt: d.updatedAt })
    }

    if (scored.length === 0) return { ids: [], total: 0 }
    scored.sort((a, b) => a.score - b.score || (a.updatedAt < b.updatedAt ? 1 : -1))
    const start = (page - 1) * pageSize
    return { ids: scored.slice(start, start + pageSize).map((s) => s.pid), total: scored.length }
  } catch {
    return null
  }
}

function paged(items: SearchItemDTO[], total: number, page: number, pageSize: number): SearchResponseDTO {
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) }
}

/**
 * Unified search. Empty query = the recent-products list. Multi-token queries
 * AND their tokens; all tokens ≥3 chars go through the trigram index (which
 * tolerates small typos and matches substrings), shorter or degenerate cases
 * fall back to LIKE with case variants.
 */
export async function searchProducts(opts: { q?: string; page?: number; pageSize?: number }): Promise<SearchResponseDTO> {
  const page = Math.max(1, Math.floor(opts.page ?? 1))
  const pageSize = Math.min(50, Math.max(1, Math.floor(opts.pageSize ?? 20)))
  const skip = (page - 1) * pageSize
  const q = (opts.q ?? '').trim()
  const rawTokens = q.split(/\s+/).filter(Boolean).slice(0, 12) // 30F: token budget
  const normTokens = rawTokens.map((t) => normalizeForSearch(t)).filter(Boolean)

  if (!q) {
    const [products, total] = await Promise.all([
      db.product.findMany({
        where: { currentRevisionId: { not: null }, quarantined: false },
        orderBy: { updatedAt: 'desc' },
        take: pageSize,
        skip,
        include: PRODUCT_INCLUDE,
      }),
      db.product.count({ where: { currentRevisionId: { not: null }, quarantined: false } }),
    ])
    return paged(products.map(toDto), total, page, pageSize)
  }

  const ftsReady = await ensureSearchIndex()

  // Happy path: every token is long enough for the trigram tokenizer.
  if (ftsReady && normTokens.length > 0 && normTokens.every((t) => t.length >= 3)) {
    const conn = getSqlite()
    if (conn) {
      const match = normTokens.map((t) => `"${t.replace(/"/g, '""')}"`).join(' ')
      // Only published, non-quarantined records are searchable: pending-only
      // or rejected-only products never appear as verified results.
      const idRows = conn
        .prepare(
          `SELECT f.pid FROM ${FTS_TABLE} f
           JOIN Product p ON p.id = f.pid
           WHERE ${FTS_TABLE} MATCH ? AND p."currentRevisionId" IS NOT NULL AND p."quarantined" = 0
           ORDER BY bm25(${FTS_TABLE})
           LIMIT ? OFFSET ?`,
        )
        .all(match, pageSize, skip) as Array<{ pid: string }>
      const countRow = conn
        .prepare(
          `SELECT count(*) AS c FROM ${FTS_TABLE} f
           JOIN Product p ON p.id = f.pid
           WHERE ${FTS_TABLE} MATCH ? AND p."currentRevisionId" IS NOT NULL AND p."quarantined" = 0`,
        )
        .get(match) as { c: number }
      const total = Number(countRow.c)
      if (total > 0) {
        const items = await hydrate(idRows.map((r) => String(r.pid)))
        return paged(items, total, page, pageSize)
      }
      // Strict trigram matching found nothing — try typo tolerance.
      const fuzzy = await fuzzySearch(normTokens, page, pageSize)
      if (fuzzy) {
        const items = await hydrate(fuzzy.ids)
        return paged(items, fuzzy.total, page, pageSize)
      }
    }
  }

  // Fallback: LIKE with case variants per RAW token (preserves åäö for the
  // three case forms; SQLite LIKE folds ASCII case on top of that).
  // 30F degenerate-query guard: tokens that collapse to nothing after LIKE
  // wildcard stripping (e.g. "%", "_") must not reach Prisma.join — an empty
  // condition group is a SQL syntax error, not an empty result. Short-circuit
  // to the existing empty-result shape (fuzzy already got its chance below).
  const usableTokens = rawTokens.filter((t) => t.replace(/[%_\\]/g, '').length > 0)
  if (usableTokens.length === 0) {
    const fuzzy = await fuzzySearch(normTokens, page, pageSize)
    if (fuzzy) {
      const items = await hydrate(fuzzy.ids)
      return paged(items, fuzzy.total, page, pageSize)
    }
    return paged([], 0, page, pageSize)
  }
  const conds = usableTokens.map((t) => {
    const esc = t.replace(/[%_\\]/g, '')
    const variants = [...new Set([esc, esc.toUpperCase(), esc.charAt(0).toUpperCase() + esc.slice(1).toLowerCase()])].filter(Boolean)
    return Prisma.join(
      variants.map((v) => Prisma.sql`(p.name LIKE ${'%'+v+'%'} OR p.brand LIKE ${'%'+v+'%'} OR p.barcode LIKE ${'%'+v+'%'})`),
      ' OR ',
    )
  })
  const where = Prisma.join(conds, ' AND ')
  const idRows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT p.id FROM Product p
    WHERE ${where} AND p."currentRevisionId" IS NOT NULL AND p."quarantined" = 0
    ORDER BY p."updatedAt" DESC LIMIT ${pageSize} OFFSET ${skip}`
  const countRows = await db.$queryRaw<Array<{ c: bigint }>>`
    SELECT count(*) AS c FROM Product p WHERE ${where} AND p."currentRevisionId" IS NOT NULL AND p."quarantined" = 0`
  const total = Number(countRows[0]?.c ?? 0)
  if (total > 0) {
    const items = await hydrate(idRows.map((r) => r.id))
    return paged(items, total, page, pageSize)
  }
  const fuzzy = await fuzzySearch(normTokens, page, pageSize)
  if (fuzzy) {
    const items = await hydrate(fuzzy.ids)
    return paged(items, fuzzy.total, page, pageSize)
  }
  return paged([], 0, page, pageSize)
}
