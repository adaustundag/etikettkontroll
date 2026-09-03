# Input and output boundary audit

Reviewed 3 September 2026, `main` at `1a1a44b`. This audit precedes implementation. Companion: [package audit](package-audit.md), [GLM implementation brief](glm-5.3-flash-implementation-brief.md).

## Conclusion

The application needs explicit trust boundaries around inputs, not an HTML scrubber applied to every string. The original Task 30 would fix registration-email markup injection and improve new uploads, but would leave request buffering, runtime type failures, numeric coercion, external imports, OCR provider output, origin trust and resource-bound query inputs unresolved. It would also silently truncate evidence and break joined emoji.

Keep the existing architecture and field bounds. Introduce small helpers that each answer a different question: is the body bounded, is the value the right type, is text canonical enough to compare/store, is the value valid for this field, and how is it encoded for this output context? Upgrade the relevant dependencies before exposing their parsers to new untrusted input.

## Evidence and limitations

- Read all API input sites, uploads serving, external integrations, template rendering and their shared helpers. Reviewed relevant existing tests and the static import graph.
- Ran `local-probes.cjs` against actual source transpiled by TypeScript with stubbed auth/DB. It makes no network calls, database writes, uploads or emails. Results: [local-probes.json](local-probes.json).
- Demonstrated: a 16-byte cap accepts a 22-byte UTF-8 JSON body; overflow rejection happens after reading the whole body; JSON arrays are accepted by the generic parser; controls/bidi persist in label text; a nutrition object becomes null; a name object throws; malformed/oversized comments throw out of their route; forwarded host becomes the email origin when APP_URL is absent.
- Full-repository ESLint passed both before and after adding the audit artifacts. Full TypeScript checking failed on the two pre-existing missing websocket-example dependencies. Bun was unavailable locally, so no claim is made that all API tests pass. The worklog's 124 tests is a historical baseline, not a verified current run.
- This is code and dependency analysis, not a penetration test or a verification of Railway's current proxy/environment settings. No malicious request was sent to production. The earlier launch review's verification/demo-account issues remain separate blockers.

## Boundary map

| Entry point | Present controls | Missing / inconsistent controls | Required treatment |
| --- | --- | --- | --- |
| Product submission | Auth, per-user rate limit, nominal 256 KiB JSON cap, field lengths, barcode regex, broad numeric range, local-photo URL regex | True streaming byte cap, object/type checks, strict numeric parsing, text cleanup, referenced file existence | Bound body, validate shape/types, normalize text, preserve existing field validation, validate local photo references |
| Registration | Nominal 64 KiB cap, name/email/password lengths, simple email regex, hashing | Runtime types, control policy, contextual HTML encoding, trusted confirmation-link origin | Normalize display name only; validate identity separately; escape at email sink |
| Password login | Nominal 64 KiB cap, upper lengths, password verification | Types and consistent email identity policy | Reject malformed types; never normalize or truncate passwords |
| Magic-link request | Nominal 8 KiB cap, simple email regex, rate limit | Types, strict popup boolean, true cap/error mapping, trusted origin | Shared email validation, bounded object input, validated origin |
| Magic-link verify | Token length <=200, hash lookup and expiration | Derived-name cleanup; token consumption is read-then-write rather than conditional consume | Clean newly generated display name; atomic single-use token consumption is a distinct auth fix |
| OAuth | Provider enum, random state/PKCE, fixed provider URLs | External response shapes, profile string lengths, consistent email policy; Google rejects only explicit false for email_verified | Validate upstream fields and require positive verification evidence before email-based account linking |
| Product comment | Auth/rate limit, nominal 16 KiB cap, 2–1000 characters | Types/text cleanup; parser size exception escapes route | Bounded object, normalized text, existing bounds, deliberate 400/413 mapping |
| Revision review | Auth/rate limit, verdict enum, comment <=500 | Uses unbounded req.json; null/object type failures; no text cleanup | Bounded object and strict optional comment/verdict types |
| Admin import trigger | L3 check, rate limit, clamped page count | Uses unbounded req.json; coercive page and boolean handling | Bounded object, finite integer/boolean validation |
| Upload | Auth/rate limit, declared MIME allowlist, <=8 MiB check after buffering, random filename | Multipart/body cap before parse, real format/decode check, resource limits, metadata removal | Bound complete multipart input, then normalize validated raster pixels |
| OFF API / image import | Basic mapping/length checks, finite numeric helper, skips existing barcodes | Response size/time limits, runtime shapes, shared text policy, source URL host/redirect restriction, decoded images | Treat as external untrusted input, reuse text/image helpers, constrain outbound hosts |
| OCR request | Auth/rate limit, nominal 12 MiB cap, data:image prefix | Exact MIME/base64 validation and decoded image cap; arbitrary data:image formats accepted | Validate envelope and bytes; use the same safe raster pipeline before provider transmission |
| OCR response | Loose JSON extraction and TS cast | Response size/time cap, nested types, numeric/serving-size validation, allowlisted output keys | Produce a newly constructed validated DTO; never return the provider object directly |
| Search | Parameterized Prisma/FTS queries, pageSize cap | Query/token/offset budget; Infinity survives page coercion; punctuation-only fallback can produce empty condition groups | Route-level finite bounds and degenerate-query handling, preserving SQL implementation |
| OG image | JSX text and title/subtitle truncation, barcode regex | Public image-generation rate budget, control cleanup, surrogate-safe display truncation | Display-only truncation is acceptable here; bound work and render text normally |
| Upload GET | Basename and generated-name regex, fixed MIME mapping, immutable cache header | Legacy files may never have been decoded/stripped | Preserve path defenses; inventory legacy content separately and use new URLs for transformed files |

## Prioritized findings

### I01 — P1: the body limit is neither a streaming limit nor a byte count

`src/lib/payload.ts:16–19` trusts a declared Content-Length only as an early check, then calls `req.text()` before enforcement and compares UTF-16 string length to a byte limit. An absent/understated length allows allocation of the entire body; multibyte Swedish text exceeds the stated byte budget without rejection. Counting Buffer.byteLength after `req.text()` fixes accounting but still does not fix allocation.

Use a bounded byte reader that counts Uint8Array chunks, cancels the reader once the next chunk exceeds the cap, and only then decodes/parses. Handle invalid JSON/type errors separately from excessive size. Add an outer platform/proxy body limit as defense in depth; application streaming cannot undo buffering already performed upstream.

### I02 — P1: type assertions hide invalid runtime values

`readBoundedJson<T>` does not validate T. `(body.body || '').trim()` and similar expressions throw on truthy objects/numbers. A comments request with `{body:{bad:1}}` throws an uncaught TypeError. Oversized comments also throw `PayloadTooLargeError` outside a catch. Review accepts JSON null then dereferences it. Admin import coerces number-like and boolean-like values instead of validating them.

Require a non-null plain JSON object, pick known keys, and check primitive types before normalization. Do not solve this with `String(value)`: that accepts objects as `[object Object]` or silently changes booleans. Keep the API's `{error: string}` envelope and existing messages for existing cases; map newly defined malformed/type cases deliberately to 400, oversized input to 413, and upstream failure to 502.

References: `src/app/api/products/[barcode]/comments/route.ts:18`, `src/app/api/revisions/[id]/review/route.ts:37`, `src/app/api/admin/import-off/route.ts:24`.

### I03 — P1 for integrity: malformed nutrition silently becomes missing data

`src/lib/revisions.ts:21–25` converts values with Number(String(value)) and maps non-finite results to null. `protein: {bad:1}` becomes null; hexadecimal/scientific numeric strings are accepted by Number even though the UI deals in decimal label values. An invalid correction can therefore be interpreted as clearing a value instead of rejected input.

Distinguish intentional empty values from invalid values. Keep null/undefined/empty string semantics already used by the form; accept finite numeric values and an explicitly documented decimal-string syntax including Swedish comma; reject objects, arrays, booleans and nonnumeric strings. Apply the existing 0–10000 bounds at the existing point. Field-specific nutritional plausibility is a separate domain-policy task.

### I04 — P2: Unicode cleanup needs a data-preserving contract

Current inputs mainly use trim. Controls, bidi overrides and zero-width obfuscation reach stored values and can interfere with display, search, diffing and keyword detection. The proposed truncation would suppress existing upper-bound errors and may remove material label text. Removing U+200D would break joined emoji; removing U+200C can alter legitimate script shaping.

Normalize line endings/tabs before removing selected controls, distinguish single-line and multiline fields, trim last, preserve joiners/variation selectors/combining marks and Swedish letters. Do not HTML-encode stored strings, apply global NFKC to product labels, or silently truncate submitted evidence. Generated display names and OG previews may have an explicit grapheme-aware display limit.

### I05 — P1: raw HTML interpolation and untrusted mail origin

Registration interpolates name directly into an HTML email (`src/app/api/auth/register/route.ts:32`). This is HTML content injection, not evidence of SMTP header injection: the mail provider receives JSON. Escape at the HTML text/attribute sink, not in the database. Escape the generated href too.

`src/lib/mail.ts:37` accepts forwarded proto/host when APP_URL is absent. The local probe returns `https://attacker.invalid` for a supplied forwarded host. Actual exploitability depends on deployment config and proxy header handling; those were not inspected. Pin/validate the production origin so confirmation tokens are never sent in links to an untrusted destination. HTML entity encoding alone cannot constrain URL destinations.

The OAuth popup response is another raw HTML sink (`src/lib/oauth.ts:233`), outside React. Current callers supply URL-parsed origins and signed tokens, so a user-name XSS path was not demonstrated. Retain that constraint and use script-context-safe JSON serialization if embedding values; HTML escaping is not JavaScript-string escaping.

### I06 — P1: uploaded content is trusted based on client MIME

`src/app/api/upload/route.ts:30–50` parses the entire form, accepts file.type, buffers all file bytes, then stores them unchanged. The nominal file size cap does not limit total multipart fields/parts. Existing success tests deliberately accept random bytes under image MIME types. The path traversal defense is good, but it is independent from content validation.

Upgrade Sharp before use; bound complete multipart input; restrict actual JPEG/PNG/WebP formats, dimensions/pixels and animation; fully decode and freshly encode; use output-derived extension; strip metadata; avoid enlargement. Limit concurrent expensive decodes and reject overload without an unbounded queue. Verify the actual Linux native build. Do not characterize this as eliminating every polyglot or image decoder vulnerability.

### I07 — P1 conditional external boundary: importer bypasses the upload policy

`src/lib/off-import.ts:121` accepts any HTTPS image URL from upstream. `offFetch` follows redirects; `saveImage` buffers the entire response before its 2 MiB check and writes it directly. Thus uploaded-file hardening alone leaves another path into the same public file store. OFF response rows are only cast, so malformed upstream types can throw despite the mapper's promise to return a reason.

Use an explicit exact-origin/CDN-host allowlist based on legitimate OFF image hosts, reject credentials/non-HTTPS/unexpected ports and IP literals, and validate every redirect destination (or reject redirects). Do not use a substring host test. Bound network response bytes and time; validate rows before mapping; use the shared image pipeline. This is an upstream-controlled SSRF possibility, not evidence that an ordinary user can directly supply a URL to this endpoint.

### I08 — P1/P2: OCR is a third independent input boundary

`src/app/api/ocr/route.ts:76–79` only checks a data:image prefix. It can forward unsupported images to the paid provider. `parseJsonLoose` casts JSON to OcrResult and the endpoint returns `parsed.nutrition` wholesale. Objects/strings/extra keys and invalid numeric values can reach the client. Provider JSON and HTTP bodies are unbounded; maxDuration is not a fetch cancellation mechanism.

Validate and normalize inbound raster bytes; set a fetch deadline and response byte cap; require provider content strings and validate every returned field. Construct a DTO from known fields only. Preserve null/unknown semantics and existing manual-entry fallback. Do not infer trustworthy data because a model returned syntactically valid JSON.

### I09 — P2: search and rendering budgets need server-side enforcement

The SQL paths are parameterized; no SQL injection was identified. However, query length/token count and page/offset work lack finite bounds, while fuzzy search scans the corpus. A nonempty query composed of stripped LIKE characters can lead to empty Prisma.join inputs in the fallback. Public OG generation also consumes work independently of browser behavior.

Add finite route-boundary budgets and short-circuit degenerate queries while preserving the response shape. Respect the existing constraint to leave search.ts SQL untouched. Add a focused regression for punctuation-only input and Infinity pagination. The client debounce is a usability feature, not enforcement.

### I10 — P2 / deployment-dependent: header-based rate limiting and proxy routing

`src/lib/rate-limit.ts` uses the first forwarded IP without an application-side trust decision. Confirm the real edge overwrites it. The checked-in `Caddyfile` additionally routes a query-selected `XTransformPort` to localhost; remove/disable that development convenience if this Caddy config is used in production. Deployment use was not established. Neither issue can be solved with a text sanitizer.

### I11 — P2: account identity needs its own validation policy

Display names can be cleaned. Passwords, OAuth codes, token strings and email identifiers must not be passed through a display-text sanitizer. The shared email regex currently accepts broad Unicode/punctuation, and different delivery/identity systems may canonicalize differently. Use one explicit policy at registration/login/magic-link/OAuth boundaries; reject prohibited controls and ambiguous separator forms instead of silently changing an address. Maintain the existing lowercase/trim behavior unless a deliberate identity migration is approved.

Google's profile check rejects only `email_verified === false`, accepting missing/malformed values. Require a real verified-email signal before linking by email. Magic token consumption also needs an atomic conditional update to uphold the advertised single-use promise; this is a separate auth state-transition fix, not sanitization. Record and test these independently so an agent does not conceal an auth redesign in the text helper.

### I12 — P2: tests and release checks currently overstate coverage

`tests/setup.ts:20` forces every suite onto db/test.db regardless of the shell DATABASE_URL. Upload fixtures are fake images and assert unchanged bytes. Registration email is fire-and-forget, so a test which immediately reads its mock can race with DB cleanup. `next.config.ts` suppresses TypeScript build errors. The release process must distinguish lint success, type success, unit/API success, native dependency build success and real browser/deployment verification.

Use a dedicated, validated TEST_DATABASE_URL/UPLOADS_DIR in a disposable directory before loading Prisma. Run DB-mutating tests serially if they share a DB or isolate each worker. Use real raster fixtures and assertions on decoded output; await the email call deterministically. Do not delete unrelated DB/files to obtain a clean run.

## Existing defenses to preserve

- Prisma parameterization, bound FTS match arguments, and controlled SQL identifiers. Do not replace them with string-built queries.
- React/JSX text rendering for names, comments, ingredients and OG text. Markup-looking input is data in these components. A global HTML sanitizer would discard legitimate content without replacing sink-specific encoding.
- Explicit ProductRevision field construction: no arbitrary body spread into Prisma writes was found.
- Generated upload filenames, basename/regex checks, fixed served MIME mapping, and nosniff response policy.
- Bounded field lengths, authenticated mutation routes, per-user rate limits, hashed passwords, and production failure when the session secret is missing.

## Legacy data and scope

New normalization does not retroactively clean stored text or previously uploaded/imported photos. Existing upload URLs are cached as immutable. First inventory affected records/files with a read-only report; any eventual transformation needs backups, preserved provenance and new filenames/URLs. Never overwrite evidence or reinterpret all old revisions as verified.

This task should not change karma/publication rules, database schema, product facts, OCR provider, routes, styling or deployment topology. Their launch risks are documented separately. Package refreshes do alter generated framework/client assets, so the original blanket “do not bump sw.js” instruction must be reconsidered for that release using the existing cache-version contract and browser update tests.
