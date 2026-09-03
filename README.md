# EtikettKontroll

Crowdsourced ingredient-label control for groceries — like Open Food Facts, but with git-style **immutable product revisions** and a **karma-gated peer review** workflow.

## How it works

- Contributors photograph a product label and submit a revision against a barcode-keyed product (GTIN/EAN).
- Revisions are append-only and immutable: every change is auditable, nothing is silently overwritten. The public page always shows the latest approved revision.
- Karma levels gate the review workflow: L0 submissions need two approvals (single nutrition-field corrections publish instantly), L1 needs one approval (single-field corrections publish instantly), L2 publishes instantly and may review others, L3 administers. Self-review is always blocked.
- **Bootstrap:** the first account registered on a fresh deployment automatically becomes an L3 Moderator — otherwise nothing could ever be approved. Machine-imported data (Open Food Facts) is auto-approved with a provenance note instead of occupying the queue.
- English-first UI, structured so a Swedish language pivot can be added without rework.
- **Language identity (decided): Swedish-first.** Default language is `sv`; the EN toggle remains as a best-effort translation. Product naming, content and data target the Swedish market.

## Tech stack

- Next.js 16 (App Router) + TypeScript
- Tailwind CSS 4 + shadcn/ui (New York) + Lucide icons
- Prisma ORM with SQLite
- Bun as runtime and package manager

## Getting started

```bash
bun install
bun run db:push         # create/update the SQLite schema
bun prisma/seed.ts      # demo users and products
bun run dev             # starts on port 3000
```

Demo accounts (local development only): `maja@etikettkontroll.se`, `erik@etikettkontroll.se`, `anna@etikettkontroll.se`, `gustav@etikettkontroll.se` — password `demo1234`.

## Tests

Endpoint test suite (92 tests) covering auth (cookie + Bearer token), karma permission gates, product and revision flows, the review queue, photo upload/serving, and input validation:

```bash
bun run test
```

## Deploying (Railway)

- **Build command:** `bun run db:generate && bun run build`
- **Start command:** `NODE_ENV=production bun .next/standalone/server.js`
- **Health check path:** `/api`
- **Volume:** mount at `/data` — the SQLite database and uploaded photos both live there
- **Variables (one-liners):**
  - `DATABASE_URL=file:/data/db/custom.db?connection_limit=1` — `connection_limit=1` keeps a single SQLite writer connection, avoiding `SQLITE_BUSY` / "database is locked" errors when concurrent submits and reviews collide
  - `AUTH_SECRET` — **required in production**: run `openssl rand -hex 32` in a terminal and paste its 64-character hex OUTPUT as the value. Never paste the command itself or `<angle brackets>` — a guessable secret makes every session token forgeable (sessions fail closed without the variable at all)
  - `APP_URL=https://etikettkontroll-production.up.railway.app` — public origin used to build magic sign-in links (optional; `x-forwarded-*` headers are used as fallback)
  - `HOSTNAME=0.0.0.0`
- First boot does **not** seed the demo dataset in production (demo users have public passwords). To seed an empty production database explicitly, set `EK_AUTO_SEED=1` for one boot. In development it seeds by default; disable with `EK_AUTO_SEED=0`.
- **Label auto-fill (OCR):** optional. Recommended: **Google Gemini** (free tier) — create a key at [aistudio.google.com](https://aistudio.google.com) and set `OCR_API_KEY`, `OCR_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `OCR_MODEL=gemini-2.5-flash`. Any OpenAI-compatible vision endpoint works (for plain OpenAI, omit `OCR_BASE_URL`/`OCR_MODEL` → `gpt-4o-mini`). Unset = the feature is hidden. Gemini's free tier allows ~10 req/min — the built-in 20/min/user cap still bounds cost, and provider 429s degrade to "type it manually".
- Security headers (nosniff, Referrer-Policy, HSTS; production also sends frame + camera policies) ship automatically via `next.config.ts` — no configuration needed
- Backups: the database is a single file under `/data/db` — snapshot the volume

> Demo credentials are for local development only — never use them in production.

## Production operations (Railway)

- **Persistence:** the SQLite database lives at `/data/db/custom.db` and uploads at `/data/uploads` on the attached Railway volume. Both survive redeploys; nothing else is durable.
- **Migrations:** the deployment uses versioned Prisma migrations. On an existing database that predates the migration history, run ONCE: `DATABASE_URL=<prod-url> npx prisma migrate resolve --applied 0001_baseline`, then `npx prisma migrate deploy` (or add `prisma migrate deploy` to the start command before `bun .next/standalone/server.js`). Never run `db push` against production (`db push` is a dev-only helper; `--accept-data-loss` was removed).
- **Trust boundary:** demo accounts are disabled via `DATABASE_URL=<prod-url> bun scripts/disable-demo-accounts.ts` (dry-run default, `--apply` to write). Moderator authority is granted ONLY via `bun scripts/promote-moderator.ts <email>` (add `--revoke` to demote). Registration order and karma never confer authority.
- **Backups:** Railway volume snapshots are the backup mechanism — enable scheduled snapshots in the Railway volume settings. For a point-in-time copy, snapshot the volume while the app is stopped (SQLite consistency) or use `sqlite3 /data/db/custom.db ".backup '/data/db/backup-<date>.db'"` from a one-off shell.
- **Restore procedure (NOT YET REHEARSED — run a rehearsal before launch):** 1) stop the app service, 2) restore the volume snapshot (or copy the backup file back to `/data/db/custom.db`), 3) start the service, 4) verify `GET /api` reports `status: ok` with the expected product count, 5) spot-check a product page and `/andringar`. Record the rehearsal date and result in this section.
- **Health:** `GET /api` returns status, app version, deployed commit SHA (`RAILWAY_GIT_COMMIT_SHA`), DB latency and product count; 503 when the database is unreachable.
