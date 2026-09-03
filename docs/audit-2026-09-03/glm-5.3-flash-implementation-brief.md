# Implementation brief for GLM 5.3 Flash — Task 30

Use this document as the implementation prompt. Read the two companion audits before editing: [input gap analysis](input-gap-analysis.md) and [package audit](package-audit.md). Findings refer to `main` at `1a1a44b`, reviewed on 3 September 2026. Reconcile any newer changes first.

## Objective and scope

Harden the existing application against malformed, oversized and misleading input while preserving Swedish label text, existing field validation and API contracts. Complete the phases below in order, with a reviewable commit and recorded verification for each. This is a bounded hardening project, not a validation-framework migration.

Keep the current hand-written enforcement points. Do not introduce Zod, DOMPurify, a new auth library, database schema changes, client-only enforcement or a global sanitizer middleware. Do not redesign verification, trust levels, the UI or the database. Do not modify `src/lib/search.ts` SQL; one explanatory comment is sufficient. Handle query bounds and degenerate requests in its caller.

Keep response shapes, successful behavior and existing error strings for their existing cases. For newly rejected malformed input, use the existing `{ error: string }` convention and deliberately choose 400, 413 or 502 as appropriate; do not return stack traces or invent an incompatible error envelope. Preserve authentication, rate limits and authorization checks. Never log raw passwords, tokens, OCR photos or complete submitted labels.

Do not silently truncate submitted evidence. Do not mutate historical records or overwrite existing image files. Do not deploy merely because this prompt contains release instructions: produce a release candidate and follow the operator's deployment authorization.

## Intended architecture

```text
HTTP request / external response
  -> bounded byte reader + deadline where applicable
  -> runtime shape and primitive-type checks
  -> field-specific text normalization or raster normalization
  -> existing semantic validation and authorization
  -> persistence / validated output DTO
  -> encoding appropriate to the output context
```

Four small shared modules are sufficient; keep application-specific decisions at existing call sites:

| Module | Contract |
| --- | --- |
| `src/lib/payload.ts` | Extend with a bounded stream-to-bytes reader, using byte counts and early cancellation. JSON parsing is not runtime schema validation. |
| `src/lib/sanitize.ts` (new) | Pure string normalization plus HTML escaping. No I/O, type coercion, field bounds or silent clipping. |
| `src/lib/image-normalize.ts` (new) | Validate and re-encode supported raster bytes using patched Sharp. Return bytes, detected MIME, extension and dimensions. No file/network writes. |
| `src/lib/remote-fetch.ts` (new, if shared code warrants it) | Small bounded response reader with timeout and explicit per-caller host/redirect policy. Not a generic URL proxy. Reuse the byte-reading primitive. |

## 30A — Establish a trustworthy baseline and patch dependencies

Files: `package.json`, `bun.lock`, `tests/setup.ts`, a small test-runner script, affected orphan `src/components/ui/*` wrappers, and deployment runtime configuration if needed.

1. Record HEAD, dirty files, Node/Bun versions and installed/locked versions. Use the actual supported Bun runtime; do not infer it from `bun-types`. Pin the tested runtime in the deployment configuration.
2. Fix test isolation before running destructive fixtures. `tests/setup.ts` currently forcibly uses `db/test.db`, so an external fresh DATABASE_URL alone does not isolate runs. Have one runner generate a unique SQLite path under a dedicated test directory and pass it to both Prisma setup and the Bun test process. Give the same run a disposable `UPLOADS_DIR`; update tests to inspect that directory rather than hard-coded `public/uploads`. Before any `wipeDb`, schema push or cleanup, assert the resolved paths belong to that test directory. Reject ordinary dev/production DB URLs and upload paths. Cleanup only this run's files after its process exits. Do not run a global `db:push --accept-data-loss` against inherited configuration.
3. Capture the current full test result. The old worklog's 124 is not an acceptance count. Local audit ESLint passed; TypeScript failed only on two missing websocket-example imports; Bun was unavailable to the auditor. Document these honestly. Use a narrowly scoped application typecheck if necessary, without hiding new source errors, adding unrelated packages or disabling rules.
4. Upgrade Next and matching `eslint-config-next` to a tested patched stable Next 16 version. Audit-time candidate: **16.3.4**. Upgrade Sharp **before adding upload/OCR/import decoding**; candidate **0.35.4**. Keep React/React DOM aligned; candidate paired patch **19.2.8**. Recheck current advisories and compatibility before selecting final versions.
5. In a separate cleanup commit, confirm and remove the 16 unused declarations identified in the package audit. Confirm the 28 orphan-wrapper dependency candidates before deleting their wrappers and declarations. In particular, delete unused `ui/chart.tsx` and remove `recharts`, and remove unused `next-auth` and `next-intl`. Retain framework peers, CSS imports, build tools, Prisma and Sharp. Static absence alone is not proof a package is unnecessary.
6. Regenerate the Bun lock, then clean-install with its frozen-lock mode. Reaudit the resolved graph and inspect the Linux standalone artifact. Patch compatible parent packages for remaining transitive findings; record advisory, affected path, runtime/build reachability and disposition. Keep Prisma CLI/client aligned on compatible versions; do not jump majors or force overrides to make the counter zero. No blanket `audit fix --force` or `latest` upgrade.

Completion: baseline recorded, safe isolated test runner, patched framework/native parser, unused code removed without broken imports, frozen-lock install/build passing, residual findings explicitly triaged. Verify the actual loaded `sharp.versions` in Linux/Bun, not just `package.json`.

## 30B — Bound bytes and validate runtime types

Files: `payload.ts`; product, registration, login, magic-request, comment, review, admin-import, upload and OCR routes; `revisions.ts` where shared callers need invariant protection.

1. Replace full `req.text()` buffering with a reader that counts incoming `Uint8Array.byteLength`, rejects as soon as the cap is exceeded, cancels/releases the stream, then decodes UTF-8. Content-Length is an early hint only. The cap applies when it is absent or understated. Do not treat UTF-16 `.length` as bytes. Handle aborted/erroring streams deliberately.
2. Parse JSON only after the cap. Guard a non-null, non-array object before reading fields. Require primitive strings, finite numbers and booleans where expected; never coerce arrays/objects with `String()` or trust `as SomeType` as validation. Preserve existing optional/null semantics where intentional.
3. Preserve current JSON caps: product 256 KiB, registration/login 64 KiB, comments 16 KiB, magic request 8 KiB, OCR 12 MiB. Add explicit 8 KiB caps to review and admin-import requests. Apply the typed size exception consistently, including comments and magic requests, which currently let it escape or become a server error.
4. Bound the **entire multipart body before** `formData()` or file materialization. Initial envelope budget: 9 MiB; keep the current 8 MiB file cap. Require exactly one `file` part, reject duplicates and unexpected payload parts, and retain the current missing-file/MIME/file-size messages. A bounded buffer parsed as multipart is acceptable here; do not add an unbounded parsing library. Test the approach in the deployed runtime. Transport overflow is 413; the existing over-8-MiB file error remains 400.
5. At label extraction/submission, reject wrong field types before calling string methods. Check photo references are strings with the existing local generated-name form and resolve to existing files inside the upload directory. Do not claim ownership verification without an ownership model. Preserve all existing evidence/authorization rules.
6. Replace permissive numeric coercion: accept finite JSON numbers and deliberately supported decimal strings, including the existing comma decimal notation. Preserve intended absent/empty-to-null semantics. Reject objects, arrays, booleans, non-finite values and nonnumeric strings; do not silently turn invalid input into null. Retain existing numeric ranges and nullability rules.

Completion: malformed JSON/object/field cases return deliberate responses, no uncaught `.trim()` errors, byte caps work with Swedish UTF-8 and streaming input, and invalid nutrition cannot silently clear data.

## 30C — Normalize text without changing evidence

Files: new `sanitize.ts`; `revisions.ts`; comments/review; registration, magic verification and OAuth user creation; later OFF and OCR adapters.

Define and test these contracts before wiring them:

- `stripInvisible(s: string): string`: remove C0 controls except LF, DEL, C1 controls, U+200B, U+200E–200F, U+202A–202E, U+2066–2069 and BOM. Do **not** remove U+200C/U+200D joiners, variation selectors or combining marks. Keep Swedish letters and joined emoji. This is a deliberately selected set, not a promise to eliminate all Unicode confusables.
- `cleanText(s: string): string`: normalize CRLF/CR and Unicode line/paragraph separators to line breaks, convert tabs and line breaks to spaces, strip selected controls, then trim. Do not collapse ordinary interior spaces unless an existing field contract already does so.
- `cleanMultiline(s: string): string`: normalize line endings, turn tabs into spaces, preserve LF, strip selected controls, then trim.
- Neither cleanup helper takes a maximum or clips content. Run the existing length/minimum checks **after** normalization. Keep their current counting convention for this task. Apply request byte bounds first. Do not use NFKC normalization or ASCII-only filters.
- `escapeHtml(s: string): string`: encode `&`, `<`, `>`, double quote and single quote; call it once at an HTML sink, never before storage. Unicode letters remain intact.

Use single-line normalization for product name, brand, serving size and display name; multiline for ingredients and comments. Preserve label bounds: name 2–200, brand 1–120, ingredients 5–8000, serving size <=60; display name 2–60; comments 2–1000; review comment <=500. Recheck minimum lengths for invisible-only submissions. Confirm these bounds against the current source before editing.

Derived magic/OAuth display names may use a separate, grapheme-safe display-only truncation helper and a deterministic fallback when empty. Do not apply it to submitted labels. Do not alter passwords, opaque tokens, barcodes or email identity with display-text cleanup. Email needs explicit identity validation: retain established trim/lowercase handling, reject control/bidi characters, and avoid normalization that can reroute mail or merge existing identities. Do not rewrite stored emails in this task.

Completion: intended Swedish/Unicode text round-trips; oversize submitted evidence is rejected rather than clipped; React continues to render stored strings normally, with no HTML scrubber.

## 30D — Fix email and origin boundaries

Files: `mail.ts`, registration and magic-request routes; origin construction in `oauth.ts` and auth redirects where shared policy applies.

1. Fix the confirmed registration HTML injection at `register/route.ts`'s `Hi ${name}` interpolation. Audit every email template interpolation, escaping HTML text and quoted attribute values. Keep the account's display name as literal text, including a submitted `<a ...>` string. Do not escape the whole template or strip HTML-like text from storage.
2. Require a validated configured public origin in production for security-sensitive links. `publicOrigin()` currently trusts forwarded host/proto when APP_URL is absent. Fail closed if production APP_URL is missing/invalid; accept an HTTPS origin with no credentials, query, fragment or application path. Keep an explicit development-local policy. Build links with `URL` and `URLSearchParams`; encode them at the HTML attribute sink. Check OAuth callback/return origins for the same deployment assumption without breaking provider registration.
3. Keep output contexts separate. The OAuth popup is raw HTML containing JavaScript; `escapeHtml` is not a JavaScript serializer. If generalizing that seam, use JSON serialization with script-breaking characters escaped and a fixed target origin. Do not interpolate display names or provider strings into raw scripts. Current origin parsing limits this exposure; do not claim a demonstrated popup XSS.

Completion: mock the mail transport and await the actual send attempt deterministically. A name `<a href="http://evil">x</a>` is stored literally while email contains `&lt;a href=&quot;http://evil&quot;&gt;x&lt;/a&gt;`. Forged forwarded headers cannot change links, even in a request with missing APP_URL. Missing production config fails deliberately, without disclosing secrets.

## 30E — Normalize all new image paths

Files: new `image-normalize.ts`, upload route, `off-import.ts`, OCR route; preserve existing `uploads.ts` and upload-GET path defenses.

1. Decode with patched Sharp using explicit input-pixel and error settings. Accept detected **JPEG, PNG or WebP only**; Sharp supports other formats, so successful decoding alone is insufficient. Reject malformed/truncated data, MIME/format mismatches, SVG/GIF/TIFF and animated/multipage inputs. Do not rely on magic bytes or client filenames. Derive stored extension/MIME from detected output format.
2. Rotate from EXIF orientation, resize inside 2000 x 2000 with no enlargement, and output a new pixel encoding. JPEG/WebP quality 85; use normal PNG compression, not a forced palette-quality conversion. Do not retain EXIF, XMP, ICC or other source metadata. Confirm all metadata fields are absent after output decode and label text remains readable.
3. Put resource budgets in named constants. Initial proposal for measurement: 40 million input pixels, one active decode per process and a small bounded pending queue. Test real phone photos and Railway memory before finalizing. Reject over-budget work deliberately; an unbounded queue or a Promise.race that leaves native decoding running is not a resource limit. Encoded byte limits and decoded pixel limits are different controls.
4. Persist only successful normalized output, under a fresh generated filename, after all checks. No raw fallback on failure. Use an accurate code comment: re-encoding discards source metadata and trailing/container payloads; it does not guarantee safety from future decoder vulnerabilities.
5. Route new OFF image imports and direct OCR image input through the same helper so they cannot bypass upload rules. OCR accepts an exact supported data-URL/base64 envelope, enforces an 8 MiB decoded-byte limit and validates actual bytes before provider transmission. Do not forward arbitrary `data:image/*` content.

Completion: valid JPEG/PNG/WebP fixtures round-trip through the serving route; orientation and <=2000px dimension are correct; corrupt files never persist; metadata is absent; arbitrary executable suffix bytes are absent from new encoding; concurrency and pixel-limit behavior is measured.

## 30F — Close external-data and query gaps

Files: `off-import.ts`, admin-import route, `scripts/import-off.ts` if needed, OCR route, product-search route, OG route as appropriate.

1. OFF fetches: allowlist exact API/image hosts required by real OFF responses, with HTTPS, default port and no credentials. Start from the known `world.openfoodfacts.org` API and verify actual image origins such as `images.openfoodfacts.org`. Reject redirects by default or revalidate each hop against the exact allowlist with a small hop cap. Do not allow arbitrary HTTPS hosts, suffix lookalikes, IP literals or redirects to local/private targets.
2. Bound external reads while streaming, even without Content-Length. Proposed starting budgets: 2 MiB OFF JSON response, existing 2 MiB imported image budget, 1 MiB OCR response; 20-second deadlines within route limits. Keep each caller's budget explicit and test with representative payloads. Abort network work on overflow/deadline and release resources.
3. Treat OFF JSON as unknown. Validate rows/field types before `.trim()` or `.replace()`, normalize strings, apply existing semantic bounds, and record invalid rows in existing import statistics/reasons rather than crashing the batch. Apply the same path for CLI and API imports. Do not silently truncate imported ingredient evidence or upgrade verification status.
4. Treat OCR provider output as unknown. Validate both provider envelope and extracted JSON, including nested nutrition. Construct a fresh allowlisted DTO with expected strings, finite bounded numbers and intended nulls. Do not return unknown keys or cast-and-forward the provider object. Use existing manual-entry failure behavior for invalid upstream results, with an appropriate 502 where applicable. Do not log the complete response or photo.
5. Bound public search work in the route: proposed q<=256 characters, <=12 nonempty search tokens, finite integer page 1–500 and pageSize within the existing <=50 cap. Preserve valid defaults and successful DTO shape. Reject invalid supplied values rather than accepting Infinity. Detect tokenless/punctuation-only queries before calling the fallback SQL and return the existing empty-result shape. Exercise both FTS and fallback. Add only the explanatory parameterization comment inside `search.ts`.
6. For OG output, normalize display text and use Unicode-safe display truncation. Verify a bounded rate/resource policy for public image generation. Do not mistake normal JSX rendering for an HTML-injection sink.

Completion: hostile upstream JSON/redirects/oversized responses fail predictably; imports and OCR cannot bypass shared rules; search SQL is unchanged and valid Swedish search works in both implementations.

## Required regression evidence

Extend existing tests and add focused helper tests. Assertions must inspect behavior, persistence and served bytes; do not simply mirror regexes or compare output size.

| Area | Required cases |
| --- | --- |
| Test harness | Unique DB per run; setup and tests use the same URL; guard rejects a dev/production path before a destructive operation. No parallel suites sharing one DB. |
| Request reader | Exact byte boundary; Swedish/emoji multibyte input; absent/false Content-Length; chunks rejected before consuming the complete over-limit source; cancellation; malformed JSON; null/array/object field types; deliberate 400/413. |
| Text | åäö/ÅÄÖ, combining letters, joined family/profession emoji, ZWNJ/ZWJ, bidi/C0/C1/DEL/BOM; CRLF/CR/LF/tabs; single-line vs multiline; idempotence; whitespace/invisible-only input; overlong content rejected without clipping. |
| Label data | Existing valid decimal-comma/empty-number cases; reject object/array/boolean/garbage/non-finite nutrition; type failures do not write; photo reference validation remains inside upload root. |
| Comments/review | Store normalized controls/newlines; preserve literal `<...>` text; wrong types and oversized bodies return deliberate errors; auth and review rules unchanged. |
| Email/auth | Literal HTML-like display name stored, escaped once in captured email; Swedish name; forwarded-header forgery; invalid/missing production APP_URL; passwords/tokens unchanged. |
| Images | Real fixtures for all three formats, corrupt JPEG with valid signature, truncated body, MIME mismatch, disguised SVG, animation, pixel cap, huge multipart extra/duplicate parts, no persisted file on failure. |
| Image evidence | Fixture known to contain EXIF/GPS and non-default orientation; assert metadata exists before, is absent after decoding served bytes, pixels/dimensions are oriented correctly. Also exercise XMP/ICC and trailing payload removal. Bytes/size delta alone are insufficient. |
| External data | OFF malformed fields, overlong evidence, allowed/blocked origins, redirect to forbidden host, timeout, streaming overflow; both CLI/API mapper paths. OCR malformed provider JSON, wrong nested types, extra keys, huge/unsupported input and response cap. |
| Query/package regression | Swedish search via FTS and fallback; punctuation-only query; NaN/Infinity/negative/fractional/extreme pages; production build, scanner/camera, login/magic/OAuth, i18n, theme and upload serving after dependency cleanup. |

Existing upload tests use fake byte arrays with declared MIME and assert raw size. Replace those success fixtures with real decodable files; do not weaken the new decoder to keep the old fixtures green. Mock external fetch/mail providers; do not send emails or adversarial traffic to production as a test shortcut.

## 30G — Release gates and separately tracked findings

Run isolated complete tests, lint, application typecheck and production build. Record actual test counts, not “124+” without a run. Reaudit the final lock and Linux standalone image, verifying the loaded native libraries and compatible runtime. No new untriaged high/critical reachable runtime finding should be accepted silently; build-only residuals need a written disposition too.

Produce a release note with commit, package/runtime versions, changed boundaries, tested cases, failures and rollback instructions. Validate production APP_URL/proxy configuration through the operator's actual environment without printing secrets. Check whether `Caddyfile`'s user-controlled `XTransformPort` target is active anywhere; remove or confine it to development if it is deployed. Do not claim it is publicly exploitable without deployment evidence.

The original “do not bump sw.js” rule applies to a release containing only server-side normalization. **This expanded scope includes framework/client dependency changes.** Follow the existing worklog contract for app-shell changes: coordinate `package.json`/`public/sw.js` versions and verify an already-open tab plus cached reload during rollout. Do not retain the no-bump assumption for a different release scope.

Use a dedicated test account for approved release smoke checks: Swedish label/comment submission, EXIF-photo orientation and metadata stripping, retrieval of the stored normalized image, search, auth links, OCR failure/manual entry and `/api` health. Check staging first and clean up only records/files explicitly created by these checks. Never test hostile load against production.

Record Task 30 in `worklog.md` using Task 29's convention, including an honest-limits section:

- Normalization is not SQL injection prevention, XSS protection in every context, OCR correctness or food-data verification. Existing React escaping and parameterized SQL remain the primary controls in their contexts.
- Old records and uploads remain unchanged. Create a separate read-only inventory and a backed-up migration plan; transformed historical images need new URLs because existing URLs are immutable-cached.
- Dependency scanning does not prove runtime exploitability or detect every native/base-image issue. Record remaining advisories and what was actually inspected.
- Separate auth correctness follow-up: require positive Google `email_verified` evidence before email-based account linking, and consume magic/verification tokens atomically so concurrent requests cannot reuse them. These need their own focused auth tests and review; do not hide them inside a string helper.
- The earlier launch blockers around evidence verification, imported-data presentation and production demo credentials remain independent. Completing Task 30 alone does not make the site ready for a trust-focused LinkedIn announcement.

Final handoff from the implementing agent: concise behavior summary, files/commits, exact commands/results, updated dependency dispositions, remaining risks and a concrete release candidate. Do not declare success if gates were skipped.
