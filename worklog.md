# Worklog

---
Task ID: 1-9
Agent: Z.ai Code (main agent)
Task: Build "EtikettKontroll" — a peer-reviewed grocery label database (OpenFoodFacts + revision control) per agreed design: Option B karma-gated review, cold start, login-to-submit, food-only v1, English-first UI with full Swedish i18n.

Work Log:
- Researched moderation models (Open Food Facts forum/wiki, MediaWiki FlaggedRevs, Stack Overflow suggested edits, Gerrit) via web-search + page-reader skills; synthesized Option B design that the user approved.
- Name due diligence: conflict-checked EtikettKontrol(l)/Granska/Rätt Etikett; user chose "EtikettKontroll" (correct Swedish spelling).
- Task 2: Replaced prisma/schema.prisma with EtikettKontroll model: User (karma, cached trustLevel), Product (barcode key, denormalized name/brand), ProductRevision (immutable snapshot + workflow state: pending/approved/auto_approved/rejected/superseded, requiredApprovals, changedFields JSON), Review (unique per reviewer+revision), ProductComment, KarmaEvent. Pushed with db:push.
- Task 3: libs — password.ts (scrypt), auth.ts (HMAC-signed httpOnly cookie sessions), trust.ts (Option B levels: L0<30k, L1≥30k, L2≥100k+85%+3 finalized, L3≥250k+90%+5; superseded revisions count as positive contributions), revisions.ts (submission engine: L2+ auto-publish, L1 single-field auto-publish, else 1–2 approvals; publish supersedes previous approved), label.ts (pure diff/value helpers), diff.ts (word-level LCS), allergens.ts (EN+SV keyword detection incl. compounds like "torskrom"), i18n.tsx (full EN+SV dictionaries, ~180 keys), router.ts (hash router via useSyncExternalStore, SSR-safe).
- Task 4: API routes — auth (register/login/logout/me), products (search + create-or-revise in one POST), products/[barcode] (detail), products/[barcode]/comments, queue, revisions/[id]/review (L2+ gate, self-review block, double-vote block, L3 merge-on-approve and single-reject-finalize, karma awards), users/[id], stats, upload (FormData → public/uploads), ocr (z-ai-web-dev-sdk createVision; graceful 502).
- Task 5: App shell — sticky header (wordmark, nav + pending badge, EN/SV toggle, theme toggle, avatar menu), sticky footer (min-h-screen flex + mt-auto, safe-area padding), hash-based SPA routing (only / visible per sandbox rule), framer-motion view transitions, sonner toasts.
- Task 6: Views — Home (hero search w/ live results + add-barcode CTA, stats, how-it-works, activity feed), Product (photos w/ zoom, allergen-highlighted ingredients, nutrition table, revision timeline with word-diffs + review comments, discuss), Submit wizard (barcode → edit-mode detection + prefill, 3 photo slots w/ client resize + camera capture, AI auto-fill from ingredients photo, diff preview, trust-note, success states), Review queue (L2+ gate w/ progress, diff cards, approve/reject + comment, J/K/A/R keyboard shortcuts), Profile (karma, trust progress, contribution stats), Auth dialog (sign in/up + one-click demo accounts, password demo1234).
- Task 7: prisma/seed.ts — 5 demo users across L0–L3, 7 Swedish groceries (Kalles Kaviar, Oatly Barista, Wasa, Marabou, Garant, Arla, Felix) with valid EAN-13s, approved histories + moderator correction revisions, 2 pending revisions (0/2 newcomer, 0/1 contributor), 3 comments.
- Task 8: Browser self-verification (agent-browser) golden paths — fixed: SSR window crash in hash router (useSyncExternalStore), hydration mismatch on deep links, auto_approved not treated as published (detail/queue/search/publish-supersede), trust decay from superseded revisions, FieldDiffRow null-image render, ean13 seed bug, react-hooks lint (set-state-in-effect ×3), allergen compound words. Verified end-to-end: register → submit (0/2 pending) → L2 approve (1/2 stays) → L3 merge (publishes, +2 karma) → L3 single reject finalizes (−1 karma, floor 0) → keyboard approve, OCR endpoint, uploads, EN/SV toggle, dark/light, mobile 390px, footer sticky/pushed. Final lint clean, dev.log clean.

Stage Summary:
- Production-ready v1 of EtikettKontroll running on port 3000 (dev). All code in src/lib, src/app/api, src/components/ek; seed: `bun prisma/seed.ts`.
- Demo logins (password demo1234): maja@ / erik@ (Moderators), anna@ (Trusted), gustav@ (Contributor), linnea@ (Newcomer) @etikettkontroll.se. Queue ships with 2 pending changes to review.
- Key decisions: auto-published revisions keep status auto_approved but count as published everywhere (PUBLISHED_STATUSES); trust counts superseded revisions as positive; single-page hash routing to honor the single-visible-route sandbox constraint; custom scrypt+HMAC auth instead of NextAuth for reliability.
- i18n is dictionary-based (src/lib/i18n.tsx) — Swedish pivot = flip localStorage key; all UI copy exists in both languages.

---
Task ID: 10
Agent: Z.ai Code (main agent)
Task: Fix "login doesn't work" — user reported sign-in had no effect.

Work Log:
- Diagnosed via dev.log: POST /api/auth/login returned 200 and GET /api/auth/me returned 200 across 3 user retries, meaning credentials were accepted but the session never stuck.
- Root cause: the app runs inside the preview panel's cross-origin iframe; modern browsers block third-party cookies there, so the SameSite=Lax httpOnly session cookie set on login was silently dropped. /api/auth/me then returned null (HTTP 200) and the UI stayed signed-out. Cookie-only auth can never work in that context.
- Fix (dual-token auth, server keeps accepting both):
  - src/lib/api.ts: added ek_token store (localStorage with sessionStorage + in-memory fallbacks, all try/catch-guarded) and setToken/getToken/clearToken exports; apiFetch now attaches Authorization: Bearer <token> to every request.
  - src/lib/auth.ts: getSessionUser() reads the Authorization bearer header first (via next/headers headers()), falls back to the session cookie.
  - login/register routes: response body now includes { user, token } alongside the unchanged Set-Cookie.
  - auth-dialog: persists token before calling /me; added a hard error if /me returns null instead of silently closing the dialog.
  - page.tsx: signOut clears the token; refreshMe clears a stale/expired token when /me returns null.
- Verification: lint clean; curl proved bearer path (login → token → /me returns user) and cookie fallback both work; agent-browser E2E: signed in as maja@ (header switched to avatar), then cookies clear + reload → still signed in via token (exact simulation of the iframe scenario), profile dropdown correct, sign out returns to signed-out state; register endpoint curl-verified to return token (throwaway user deleted afterwards); dev.log clean, all 200s.

Stage Summary:
- Login now works in the preview iframe AND in normal first-party browsing. Auth = bearer token (iframe-proof, primary) + httpOnly SameSite=Lax cookie (first-party fallback). 30-day expiry unchanged. No schema changes; no breaking API changes (all authed routes go through getSessionUser).

---
Task ID: 11
Agent: Z.ai Code (main agent)
Task: (a) Bug report — demo review-queue products "not visible/found"; (b) propose (no code) camera barcode scanning.

Work Log:
- Root-caused the queue bug: RevisionDTO had no barcode field, so QueueCard rendered an invisible barcode line AND navigated via navigate(`product/${item.productId}`) — a Prisma CUID — while ProductView resolves route params as barcodes → /api/products/{cuid} → 404 "Product not found". Same bug in profile-view contributions link.
- Fix: added barcode to RevisionDTO end-to-end (types.ts; revisions.ts RevisionWithRelations + mapRevision + revisionInclude now includes product.barcode); removed now-duplicate product includes in queue + users/[id] routes; queue-view and profile-view navigate by item.barcode / c.barcode.
- Also fixed a pre-existing tsc error in api/ocr: SDK types require `model` for createVision but the runtime injects a default (verified live: OCR endpoint returns 200 + parsed JSON shape); cast body to CreateChatCompletionVisionBody with explanatory comment instead of guessing a model string.
- Introduced `bunx tsc --noEmit` (scoped to src/) into the verification routine — ESLint is not type-aware, which is how the missing-field bug slipped through. Remaining tsc output is limited to pre-existing examples/ + skills/ noise outside the app.
- Verified via curl (queue items now carry barcode) and agent-browser E2E: queue card title → product page renders fully (Wasa: barcode shown, pending-change banner, History (3), nutrition table); profile contribution → Kalles Kaviar page renders. Lint clean, dev.log clean.

Stage Summary:
- Queue → product and profile → product navigation now work; queue cards show the barcode again. Lesson: route params for product pages are barcodes (natural key) — never productId. tsc --noEmit is now part of the check suite.
- Camera barcode scanning: PROPOSAL ONLY delivered to user (no code written), per request.
