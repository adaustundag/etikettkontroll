# GLM launch checklist addendum: Task 13 — retain historical label photos

Append this task to the existing T1–T12 implementation list. Design it with the provenance and observation schema work, then complete it before legacy-data migration and public-beta story work.

## 13. Preserve historical label photos as durable evidence

The current application stores `/uploads/...` strings directly on revisions and observations. Replace this with durable asset records and explicit evidence links. Preserve the server-normalized master; do not describe it as an untouched camera original because the current pipeline re-encodes images and removes metadata.

### Implement

1. Add `EvidenceAsset`, `EvidenceRendition`, `RevisionEvidence`, `ObservationEvidence` and append-only `EvidenceEvent` models, following the architecture in `docs/launch-readiness-review-2026-09-03.md`.
2. Add foreign keys and indexes for evidence links. Also replace string-only `currentRevisionId` and `publishedRevisionId` references with real relations without losing existing data.
3. Add an `EvidenceStore` interface backed by the current persistent uploads volume. Support immutable put, read, exists and restricted delete by opaque server-generated key.
4. On upload/import, decode and normalize the image with the existing shared pipeline, calculate SHA-256 and dimensions from the normalized bytes, store the canonical asset once, and generate thumbnail/display renditions. Store accurate source and license metadata.
5. Link each image to its revision and packaging observation with an explicit role: front, ingredients, nutrition, quantity or other.
6. Move evidence requirements into the single `finalizePublication` policy so ordinary approvals and moderator dispute approvals enforce identical asset-role and availability checks.
7. Preserve all assets linked to verified or historical publications, comparison observations, change claims and unresolved disputes. Superseding a revision must never release its evidence.
8. Add configurable cleanup for orphan uploads and rejected submissions which were never published. Prove that no protected reference exists before deleting bytes and record an `EvidenceEvent`.
9. Serve public renditions through an asset-ID route that enforces availability state. Serve canonical masters only through an authenticated/operator route. A restricted or removed asset returns no bytes but retains a tombstone and audit event.
10. Update product history so each version shows its own evidence. Add a side-by-side before/after evidence view for packaging observations. Label observed date/date range, upload time and publication time separately.
11. Let transcription corrections explicitly reuse an observation's evidence. Do not create a new physical observation or packaging-change claim for a correction.
12. Build a dry-run-first, idempotent migration for legacy image URLs. Inventory existence, role, hash, size and decoded type; report missing/malformed/duplicate files; backfill links without granting verification; retain legacy files until dual-read reconciliation succeeds.
13. Back up and restore the database and evidence store as one unit. Document and execute a rehearsal in a non-production environment before launch.

### Acceptance checks

- Publish version 1 with three evidence roles, then publish version 2: version 1's photos remain available from history.
- Correct version 2's transcription using the same observation: evidence is reused and no physical-change story is created.
- Record a separately photographed version 3: history and comparison show the correct images for versions 2 and 3.
- Make required evidence missing/restricted and attempt ordinary approval: publication returns a validation error.
- Repeat through dispute resolution with `resolution=approve`: publication is blocked by the same validation.
- Restrict a published asset: public bytes stop, the audit event remains, and the UI reports unavailable historical evidence.
- Run cleanup with protected and orphan assets: only eligible unreferenced assets are removed.
- Run migration dry-run, apply and apply again: the second apply performs no changes; missing files remain explicitly unavailable and unverified.
- Restore a test backup and verify database references, hashes, renditions and historical image delivery.

### Required handoff

Report schema and migration files, storage/API/UI changes, tests executed, retention defaults, legacy reconciliation counts, and production operator actions. Do not claim historical evidence is complete until the migration reports every published legacy reference as linked, missing or intentionally restricted.
