# Dependency audit — 3 September 2026

## Scope and method

Source: `main` at `1a1a44b`. Parsed the committed `bun.lock` as JSONC, inspected installed direct-package manifests, traversed static TypeScript imports from Next app/instrumentation entry points, checked config/CSS/CLI usage manually, and queried the npm bulk advisory endpoint using exact locked names and versions. Queried public registry metadata separately for all direct declarations. No package was installed or upgraded.

- 66 production declarations, 9 development declarations: **75 direct packages**.
- **940 lock entries / 877 distinct package names**, including development, optional/platform and unused-template dependencies.
- All 75 installed direct versions match their top-level lock versions. This does not establish the versions deployed to Railway.
- All 940 entries have integrity data; recorded tarball locations are npm registry URLs. Integrity does not prove a package is free of malicious code.
- **85 matched advisory/range entries, representing 73 unique advisory URLs across 24 package names**. npm severity totals after deduplication: **1 critical, 38 high, 29 moderate, 5 low**. These are inventory matches, not 73 demonstrated application exploits. npm calls the Auth.js finding critical; the maintainer page currently calls it high.
- Static source traversal found 18 directly imported runtime packages. Framework peers, CSS/build plugins, CLI dependencies and Sharp's intended new role require manual retention even without a runtime import.
- Installed direct license declarations: 67 MIT, 5 Apache-2.0, 2 ISC, 1 Unlicense. This is metadata inventory, not a complete legal assessment of transitive/native binaries.
- Direct packages with install lifecycle scripts: `@prisma/client` (postinstall), `prisma` (preinstall), `sharp` (install). Review Bun's actual trusted-install settings and preserve the required generation/native setup; do not blanket-enable all lifecycle scripts.

Raw evidence and rerunnable scripts are in this directory. Ancestor lists are conservative lock-graph relationships including peer dependencies; they are not runtime call paths. A package under the Next parent is not automatically reachable from an HTTP request. Dynamic external loading, bundled code inside Next and OS/base-image vulnerabilities need separate checks in the actual deployment artifact.

## Upgrade and removal decisions

| Priority | Package / locked version | Finding and actual use | Action |
| --- | --- | --- | --- |
| P1 | `next` 16.1.3 | App Router is active. npm matches 31 advisories. Server Component DoS advisories are relevant; many others require features absent from this repository, such as custom rewrites, authorization middleware, explicit Server Actions or remote image configuration. No exploit was sent to production. | Upgrade to a tested stable patched Next 16 release, with matching `eslint-config-next`. Registry candidate at audit time: **16.3.4**. It is outside all currently returned affected ranges for `next`. Reaudit the resulting lock and production artifact. |
| P1 before adding decoding | `sharp` 0.34.5 | Currently used directly by the icon script and present as a Next optional dependency. The proposed upload hardening would expose it directly to untrusted uploads. Maintainer advisory covers inherited libvips vulnerabilities in versions below 0.35.0. | Upgrade first; registry candidate **0.35.4**, then prove decode/encode works in the actual Linux/Bun standalone build. Check `sharp.versions.vips` and the binary actually loaded. |
| P2 paired maintenance | `react`, `react-dom` 19.2.3 | Required runtime. No direct match for these package names was returned; Next's bundled RSC implementation still matters. | Candidate paired patch **19.2.8**, tested together with Next. Do not present this as fixing a matched direct React advisory. |
| Remove | `next-auth` 4.24.13 | Three matches, including npm's critical email-normalization advisory. No imports; this app uses `src/lib/auth.ts` and `src/lib/oauth.ts`. | Remove the declaration and regenerate the lock. Do not rewrite authentication to use it or claim the current custom login is affected by its package advisory. |
| Remove | `next-intl` 4.7.0 | Two matches. No imports; app uses its own `i18n.tsx`. | Remove; preserve custom Swedish/English behavior. |
| Remove unused chains | `@mdxeditor/editor`, `@reactuses/core`, `react-syntax-highlighter`, `uuid` | No references; bring in affected `diff`, `js-cookie`, `lodash-es`, `prismjs`, UUID and YAML chains. | Remove in a dependency-cleanup commit, then regenerate and rescan. |
| Remove with orphan component | `recharts` 2.15.4 | Only referenced from unreachable `ui/chart.tsx`; brings affected lodash. That file contains the only `dangerouslySetInnerHTML` found. | Delete the unused wrapper and remove the direct dependency. Its mere presence is not evidence of live XSS. |
| Retain; triage transitive build/config exposure | `prisma`, `@prisma/client` 6.19.2 | Required CLI/client pair; lock matches through `@prisma/config` include `deepmerge-ts`, `defu`, `effect`. No application use of the vulnerable Effect RPC or arbitrary merge entry points was found. | Keep versions aligned. Investigate compatible parent patches and actual standalone inclusion before narrowly scoped overrides. Do not jump to Prisma 7/8 just to reduce an audit counter. |
| Upgrade compatible toolchain | ESLint / Next ESLint config / Tailwind PostCSS | Affected Babel, humanfs, ajv, brace-expansion, browserslist, flatted, js-yaml, minimatch, picomatch, PostCSS/nanoid chains. These mostly process repository/build inputs, not submitted labels. | Upgrade supported parent versions and regenerate the lock. Document any remaining tool-only match with its actual input path and owner. Do not disable lint or use blanket `audit fix --force`. |

Candidate versions are an observed snapshot, not permission to trust a future `latest` tag. The registry currently returns a prerelease for the Prisma CLI's `latest` endpoint and different major versions for Prisma Client/TypeScript/ESLint. This is a concrete reason to select compatible, stable versions deliberately. Next 16.3.4 and Sharp 0.35.4 declare Node >=20.9; the local Node is 24.20.0, but the deployment uses Bun and its exact version was not established.

Primary references: [Next RSC advisory](https://github.com/vercel/next.js/security/advisories/GHSA-q4gf-8mx6-v5v3), [Next follow-up RSC advisory](https://github.com/vercel/next.js/security/advisories/GHSA-8h8q-6873-q5fj), [Sharp/libvips advisory](https://github.com/lovell/sharp/security/advisories/GHSA-f88m-g3jw-g9cj), [Auth.js email advisory](https://github.com/nextauthjs/next-auth/security/advisories/GHSA-7rqj-j65f-68wh). Each raw npm finding also retains its advisory URL and affected range.

## Package minimization

Sixteen direct dependencies have no source/config/script use after manual exclusions for required tooling and framework peers: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `@hookform/resolvers`, `@mdxeditor/editor`, `@reactuses/core`, `@tanstack/react-query`, `@tanstack/react-table`, `date-fns`, `next-auth`, `next-intl`, `react-markdown`, `react-syntax-highlighter`, `uuid`, `zod`, `zustand`.

Another 28 direct dependencies are referenced only by UI wrappers unreachable from the current application entry points. Remove their orphan wrappers and dependencies in a separate cleanup step; retain a component if new evidence establishes use. The table below names them. The 44 candidates are not automatically 44 removable transitive packages: other retained dependencies may still require some of them.

Do not remove `react-dom`, Prisma, TypeScript, React types, Bun types, ESLint, Tailwind/PostCSS, `tw-animate-css`, or `tailwindcss-animate` merely because a JavaScript runtime import is missing. CSS explicitly imports Tailwind and `tw-animate-css`; PostCSS config uses its plugin. Retain Sharp for icon generation and the planned image normalizer. No schema-validator or HTML-sanitizer dependency is required by the proposed design.

## Audit reproduction

Run from the repository root with Node and the existing installed development dependencies:

```text
node docs/audit-2026-09-03/collect-dependencies.cjs
node docs/audit-2026-09-03/collect-dependencies.cjs --online
node docs/audit-2026-09-03/registry-metadata.cjs
```

The online commands send public package names/versions only and write JSON receipts here. They do not install packages, inspect secrets, or change the lock. For release, also run the package manager's native audit after a clean frozen-lock install and inspect the Linux standalone dependency/native-binary inventory. The current audit did not perform that build or audit the Railway base image.

## Complete direct-package inventory

The following generated table separates runtime imports, required tooling, unused declarations and orphan UI wrappers. `latest` is informational and may be a major/prerelease migration; it is not a recommended blanket target.

| Package | Declared | Locked / installed | Registry latest | Installed license | Usage / action |
| --- | --- | --- | --- | --- | --- |
| `@dnd-kit/core` | `^6.3.1` | 6.3.1 | 6.3.1 | MIT | No references: removal candidate |
| `@dnd-kit/sortable` | `^10.0.0` | 10.0.0 | 10.0.0 | MIT | No references: removal candidate |
| `@dnd-kit/utilities` | `^3.2.2` | 3.2.2 | 3.2.2 | MIT | No references: removal candidate |
| `@hookform/resolvers` | `^5.1.1` | 5.2.2 | 5.9.1 | MIT | No references: removal candidate |
| `@mdxeditor/editor` | `^3.39.1` | 3.52.3 | 4.2.3 | MIT | No references: removal candidate |
| `@prisma/client` | `^6.11.1` | 6.19.2 | 7.10.0 | Apache-2.0 | Runtime: retain / patch as indicated |
| `@radix-ui/react-accordion` | `^1.2.11` | 1.2.12 | 1.2.20 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-alert-dialog` | `^1.1.14` | 1.1.15 | 1.1.23 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-aspect-ratio` | `^1.1.7` | 1.1.8 | 1.1.15 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-avatar` | `^1.1.10` | 1.1.11 | 1.2.6 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-checkbox` | `^1.3.2` | 1.3.3 | 1.3.11 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-collapsible` | `^1.1.11` | 1.1.12 | 1.1.20 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-context-menu` | `^2.2.15` | 2.2.16 | 2.3.7 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-dialog` | `^1.1.14` | 1.1.15 | 1.1.23 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-dropdown-menu` | `^2.1.15` | 2.1.16 | 2.1.24 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-hover-card` | `^1.1.14` | 1.1.15 | 1.1.23 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-label` | `^2.1.7` | 2.1.8 | 2.1.15 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-menubar` | `^1.1.15` | 1.1.16 | 1.1.24 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-navigation-menu` | `^1.2.13` | 1.2.14 | 1.2.22 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-popover` | `^1.1.14` | 1.1.15 | 1.1.23 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-progress` | `^1.1.7` | 1.1.8 | 1.1.16 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-radio-group` | `^1.3.7` | 1.3.8 | 1.4.7 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-scroll-area` | `^1.2.9` | 1.2.10 | 1.2.18 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-select` | `^2.2.5` | 2.2.6 | 2.3.7 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-separator` | `^1.1.7` | 1.1.8 | 1.1.15 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-slider` | `^1.3.5` | 1.3.6 | 1.4.7 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-slot` | `^1.2.3` | 1.2.4 | 1.3.3 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-switch` | `^1.2.5` | 1.2.6 | 1.3.7 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-tabs` | `^1.1.12` | 1.1.13 | 1.1.21 | MIT | Runtime: retain / patch as indicated |
| `@radix-ui/react-toast` | `^1.2.14` | 1.2.15 | 1.2.23 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-toggle` | `^1.1.9` | 1.1.10 | 1.1.18 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-toggle-group` | `^1.1.10` | 1.1.11 | 1.1.19 | MIT | Orphan UI wrapper only: removal candidate |
| `@radix-ui/react-tooltip` | `^1.2.7` | 1.2.8 | 1.2.16 | MIT | Orphan UI wrapper only: removal candidate |
| `@reactuses/core` | `^6.0.5` | 6.1.9 | 6.5.5 | Unlicense | No references: removal candidate |
| `@tanstack/react-query` | `^5.82.0` | 5.90.19 | 5.102.8 | MIT | No references: removal candidate |
| `@tanstack/react-table` | `^8.21.3` | 8.21.3 | 9.2.4 | MIT | No references: removal candidate |
| `@zxing/browser` | `^0.2.1` | 0.2.1 | 0.2.1 | MIT | Runtime: retain / patch as indicated |
| `class-variance-authority` | `^0.7.1` | 0.7.1 | 0.7.1 | Apache-2.0 | Runtime: retain / patch as indicated |
| `clsx` | `^2.1.1` | 2.1.1 | 2.1.1 | MIT | Runtime: retain / patch as indicated |
| `cmdk` | `^1.1.1` | 1.1.1 | 1.1.1 | MIT | Orphan UI wrapper only: removal candidate |
| `date-fns` | `^4.1.0` | 4.1.0 | 4.4.0 | MIT | No references: removal candidate |
| `embla-carousel-react` | `^8.6.0` | 8.6.0 | 8.6.0 | MIT | Orphan UI wrapper only: removal candidate |
| `framer-motion` | `^12.23.2` | 12.26.2 | 13.2.0 | MIT | Runtime: retain / patch as indicated |
| `input-otp` | `^1.4.2` | 1.4.2 | 1.5.0 | MIT | Orphan UI wrapper only: removal candidate |
| `lucide-react` | `^0.525.0` | 0.525.0 | 1.40.0 | ISC | Runtime: retain / patch as indicated |
| `next` | `^16.1.1` | 16.1.3 | 16.3.4 | MIT | Runtime: retain / patch as indicated |
| `next-auth` | `^4.24.11` | 4.24.13 | 4.24.15 | ISC | No references: removal candidate |
| `next-intl` | `^4.3.4` | 4.7.0 | 4.14.2 | MIT | No references: removal candidate |
| `next-themes` | `^0.4.6` | 0.4.6 | 0.4.6 | MIT | Runtime: retain / patch as indicated |
| `prisma` | `^6.11.1` | 6.19.2 | 8.0.0-rc.12 | Apache-2.0 | Required framework, CLI, CSS/build or image helper: retain |
| `react` | `^19.0.0` | 19.2.3 | 19.2.8 | MIT | Runtime: retain / patch as indicated |
| `react-day-picker` | `^9.8.0` | 9.13.0 | 10.0.1 | MIT | Orphan UI wrapper only: removal candidate |
| `react-dom` | `^19.0.0` | 19.2.3 | 19.2.8 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `react-hook-form` | `^7.60.0` | 7.71.1 | 7.87.0 | MIT | Orphan UI wrapper only: removal candidate |
| `react-markdown` | `^10.1.0` | 10.1.0 | 10.1.0 | MIT | No references: removal candidate |
| `react-resizable-panels` | `^3.0.3` | 3.0.6 | 4.12.3 | MIT | Orphan UI wrapper only: removal candidate |
| `react-syntax-highlighter` | `^15.6.1` | 15.6.6 | 16.1.1 | MIT | No references: removal candidate |
| `recharts` | `^2.15.4` | 2.15.4 | 3.10.1 | MIT | Orphan UI wrapper only: removal candidate |
| `sharp` | `^0.34.3` | 0.34.5 | 0.35.4 | Apache-2.0 | Required framework, CLI, CSS/build or image helper: retain |
| `sonner` | `^2.0.6` | 2.0.7 | 2.0.8 | MIT | Runtime: retain / patch as indicated |
| `tailwind-merge` | `^3.3.1` | 3.4.0 | 3.6.0 | MIT | Runtime: retain / patch as indicated |
| `tailwindcss-animate` | `^1.0.7` | 1.0.7 | 1.0.7 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `uuid` | `^11.1.0` | 11.1.0 | 14.0.2 | MIT | No references: removal candidate |
| `vaul` | `^1.1.2` | 1.1.2 | 1.1.2 | MIT | Orphan UI wrapper only: removal candidate |
| `zod` | `^4.0.2` | 4.3.5 | 4.5.4 | MIT | No references: removal candidate |
| `zustand` | `^5.0.6` | 5.0.10 | 5.0.15 | MIT | No references: removal candidate |
| `@tailwindcss/postcss` | `^4` | 4.1.18 | 4.3.3 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `@types/react` | `^19` | 19.2.8 | 19.2.18 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `@types/react-dom` | `^19` | 19.2.3 | 19.2.7 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `bun-types` | `^1.3.4` | 1.3.6 | 1.4.0 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `eslint` | `^9` | 9.39.2 | 10.9.1 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `eslint-config-next` | `^16.1.1` | 16.1.3 | 16.3.4 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `tailwindcss` | `^4` | 4.1.18 | 4.3.3 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `tw-animate-css` | `^1.3.5` | 1.4.0 | 1.4.0 | MIT | Required framework, CLI, CSS/build or image helper: retain |
| `typescript` | `^5` | 5.9.3 | 7.0.2 | Apache-2.0 | Required framework, CLI, CSS/build or image helper: retain |
