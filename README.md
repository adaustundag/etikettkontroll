# EtikettKontroll

Crowdsourced ingredient-label control for groceries — like Open Food Facts, but with git-style **immutable product revisions** and a **karma-gated peer review** workflow.

## How it works

- Contributors photograph a product label and submit a revision against a barcode-keyed product (GTIN/EAN).
- Revisions are append-only and immutable: every change is auditable, nothing is silently overwritten. The public page always shows the latest approved revision.
- Karma levels gate the review workflow: L0 contributors need two approvals for their first five edits, L1 small edits auto-publish, L2 can publish instantly and review others, L3 administers. Self-review is always blocked.
- English-first UI, structured so a Swedish language pivot can be added without rework.

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
- First boot **auto-seeds the demo dataset** when the database is empty (disable with `EK_AUTO_SEED=0`)
- Security headers (nosniff, Referrer-Policy, HSTS; production also sends frame + camera policies) ship automatically via `next.config.ts` — no configuration needed
- Backups: the database is a single file under `/data/db` — snapshot the volume

> Demo credentials are for local development only — never use them in production.
