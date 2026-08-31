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

Endpoint test suite (88 tests) covering auth (cookie + Bearer token), karma permission gates, product and revision flows, the review queue, and input validation:

```bash
bun run test
```

> Demo credentials are for local development only — never use them in production.
