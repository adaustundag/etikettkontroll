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

---
Task ID: 12
Agent: Z.ai Code (main agent)
Task: Camera barcode scanning (approved Option A), designed for later app packaging (Capacitor/PWA).

Work Log:
- Installed @zxing/browser@0.2.1 (fallback decoder; BarcodeFormat re-exported, decodeFromStream(stream, video, cb) -> IScannerControls.stop()).
- New src/components/ek/barcode-scanner.tsx: engine seam (createEngine) with NativeEngine (BarcodeDetector API, 180ms poll, formats ean_13/ean_8/upc_a/upc_e) and ZXingEngine (BrowserMultiFormatReader + possibleFormats over our own MediaStream). Capacitor native scanner documented as future engine #0 — component API (onDetected) unchanged by design.
- Own getUserMedia stream (facingMode environment ideal) for torch control (applyConstraints advanced torch, hidden when unsupported); iOS-safe video attrs (playsInline muted autoPlay); secure-context + mediaDevices guard; error mapping NotAllowedError/SecurityError -> errPermission, NotFoundError/OverconstrainedError -> errNoCamera, else generic; retry button.
- Acceptance gate: GS1 mod-10 isValidGtin (shipped fn tested standalone: 16/16 cases incl. EAN-8/UPC-A-as-GTIN13/14-digit/bad-check/unsupported length); in-store prefix 20–29 rejected with errInStore; haptic vibrate(60) on success.
- UI: reticle with 9999px shadow mask + animated emerald scan line (globals.css ek-scanline), starting/error overlays with aria-live, i18n keys scanner.* added to BOTH en+sv dictionaries; search-box got an always-visible scan icon button (hidden while loading); submit wizard step 1 got a Scan button beside the barcode field; scan fills field + triggers existing-product check (no auto-advance: photos are step 1 too); home scan -> navigate('submit/{code}') which routes edit-vs-new automatically.
- Fixed during verification: explicit Close button only stopped tracks but never closed the dialog (added onClose -> onOpenChange(false)); react-hooks/set-state-in-effect on effect-started camera (deferred with setTimeout 0).
- Verified (agent-browser): scanner opens/closes from both entry points (Close button + Escape), headless no-camera path renders "Camera unavailable / No camera was found on this device" + Try again; no console errors; mobile 390px layout correct; lint + tsc --noEmit clean; dev.log clean. GTIN validator unit-tested by extracting the shipped function.

Stage Summary:
- Camera scanning live behind a platform adapter: native BarcodeDetector first, ZXing fallback, native-plugin slot ready for Capacitor packaging. Honest limit: real-camera decode (golden path) needs a physical device / Open-in-New-Tab — headless can only verify lifecycle + error paths.
- Answer given to user: Option A still recommended for app packaging; packaging plan = PWA now, Capacitor later, swap in native scanner engine, bearer-token auth already WebView-safe.

---
Task ID: 13
Agent: Z.ai Code (main agent)
Task: Social + passwordless sign-in — Google, Facebook (OAuth) and email magic links, integrated with the existing HMAC session system. (Klarna ruled out earlier: no third-party identity product exists.)

Work Log:
- Schema: added ExternalIdentity (unique [provider, providerId], cascade delete) and MagicToken (unique tokenHash, 15-min TTL, usedAt); User.passwordHash now nullable for social/passwordless accounts. Pushed with db:push; required dev-server restart (old client was cached in memory).
- src/lib/oauth.ts: provider registry (Google OIDC + PKCE S256; Facebook v19 code flow), state cookie (ek_ox_{provider}, httpOnly, 10 min, per-provider), buildAuthorizeUrl/ exchangeCodeForProfile (Google userinfo w/ verified-email requirement; FB /me fields id,name,email), resolveOAuthUser (login → link-by-verified-email → register, race-safe), finishSession (popup: postMessage token to opener + close, with no-opener fallback location.replace('/'); redirect: set cookie + redirect '/'). Providers read GOOGLE_CLIENT_ID/SECRET, FACEBOOK_CLIENT_ID/SECRET; magic email delivery uses RESEND_API_KEY/MAIL_FROM.
- Routes: /api/auth/providers (configured flags), /api/auth/oauth/[provider]/start (PKCE + state + popup flag; 400 with clear message when unconfigured), .../callback (state check, code exchange, consent-cancel redirect), /api/auth/magic/request (email validation, 30s per-email throttle, one live token per email, dev mode returns devLink when no mail key), /api/auth/magic/verify (single-use, expiry, auto-register pretty-name user).
- Login route: friendly 401 for accounts without passwordHash.
- AuthDialog rebuilt: tabs + divider "or continue with" + Google/Facebook/Email-link buttons; magic inline form with sent-state and dev-mode link button; window.addEventListener('message') completion path (postMessage token → setToken → /me → welcome toast); popup-blocked and unconfigured messages; providers flags fetched on open (deferred setTimeout for set-state-in-effect rule); reset-on-close via onOpenChange wrapper.
- i18n: auth.orContinue/providerGoogle/providerFacebook/emailLink/magicPrompt/magicSend/magicSent/magicDevTitle/magicDevOpen/notConfigured/popupBlocked in EN + SV.
- Fixed: SQLite createMany has no skipDuplicates (typed never) — replaced with .catch(() => undefined); passwordHash narrowing in login route via explicit hash const.
- Verified: tsc + lint clean; curl: providers flags, unconfigured start → 400, magic E2E both popup (200 + cookie + /me = new user) and redirect (307 → / with cookie) variants, token reuse → 400, passwordless password attempt → friendly 401, password regression OK; browser E2E: dialog renders all buttons, Google click shows graceful not-configured error, magic request → dev link → popup auto-closes → main page signed in (avatar visible); test users cleaned; dev.log clean.

Stage Summary:
- Sign-in surface now: password (demo accounts unchanged), Google, Facebook, email magic link. OAuth goes live when user registers apps and sets env keys; magic link emails once RESEND_API_KEY is set (dev mode shows the link inline until then). One session system throughout (bearer token + cookie, iframe-safe). Setup guide handed to user: Google Cloud Console + Meta developer app redirect URIs = {origin}/api/auth/oauth/{provider}/callback. Klarna not possible (no identity product); Sign in with Apple recommended at iOS packaging; BankID at Swedish launch.

---
Task ID: 14
Agent: Z.ai Code (main agent)
Task: Unit-test every API endpoint ("Let's do unit tests on all end points. Make sure they work as expected."), plus clarify that Google/Facebook sign-in needs real OAuth apps before it can go live.

Work Log:
- Mapped all 18 routes (auth register/login/logout/me/providers, oauth start+callback, magic request+verify, products search/detail/comments/submit, queue, revisions review, users, stats, upload, ocr, health) by reading every handler + lib (auth, oauth, trust, revisions, password).
- Built a bun:test harness (tests/): setup.ts forces DATABASE_URL to an isolated db/test.db, mock.module('next/headers') provides a controllable request scope (bearer header + cookie jar with set/get, so OAuth state round-trips work), req() builds NextRequest, sessionCookie() parses Set-Cookie; fixtures.ts wipes tables in FK order and derives Option-B levels via the real computeTrust (karma + finalized history).
- 8 suites / 88 tests: auth (validation, dup email 409, passwordless 401, bearer+cookie+expired/garbage tokens), OAuth (unconfigured 400, PKCE authorize URL + state cookie, callback happy paths for Google+Facebook with stubbed token/userinfo endpoints, consent-cancel redirect, forged state 400, replay 400, identity reuse, email linking preserving password, popup postMessage HTML, unverified-email 400), magic links (devLink, 429 throttle, single-use, expiry, pretty-name registration, existing-account sign-in, popup HTML), products (case-insensitive search, digit-substring search, literal SQL wildcards, detail DTO with barcodes, comments validation), submissions (L0 pending 2-approval, no-change 400, L1 single-field auto-publish + supersede + karma +2, L1 multi-field 1-approval, L2 instant, "42,5"→42.5 coercion, barcode whitespace strip), review (queue ordering/current diff, all guards: 401/400/403-level/403-self/404/409-finalized/409-duplicate, two-approval publish flow end-to-end, L3 merge, supersede, reject paths incl. karma floor at 0), users/stats/health, upload (auth, mime whitelist, 8 MB cap, disk write + cleanup), OCR (401/400 + real vision call on a sharp-generated label image asserting exact extracted values: 520 kcal, 7 g protein, 0.25 g salt).
- BUG FOUND & FIXED: product search was case-sensitive on SQLite (Prisma `contains` without mode support) — "oatly" returned nothing. Rewrote GET /api/products?q= to a parameterized LIKE raw query (wildcards stripped) with re-hydration preserving order; verified live via curl and browser (lowercase "oatly" now returns the product in the UI).
- Housekeeping: db.ts silences prisma query logs under NODE_ENV=test; package.json gained `bun run test` (fresh db/test.db + prisma db push + bun test).
- Verified: 88/88 pass in ~2.5s; eslint clean; tsc --noEmit clean (tests type-checked via tests/bun.d.ts → bun-types); dev.log healthy; agent-browser golden path (search → product page) renders with no console errors.
- GitHub status checked per user request to "push this in": repo has NO remote and the sandbox has no gh CLI or credentials — the earlier commits are local-only. Blocked on user providing a repo URL + token (or gh auth). All work is committed locally so a push is a single command once credentials exist.

Stage Summary:
- Every API endpoint now has automated coverage: 88 tests / 8 files via `bun run test`, isolated DB, no dev-data pollution, ~2.5 s runtime. One real bug found and fixed (case-insensitive product search).
- Social logins (Google/Facebook) are implemented but dormant: they activate only when GOOGLE_/FACEBOOK_ client id+secret env keys are set — user cannot log in with them in the preview because no OAuth apps exist yet (expected; setup guide delivered in Task 13).
- Awaiting user input: GitHub remote URL + personal access token (or `gh auth login`) to actually push.
