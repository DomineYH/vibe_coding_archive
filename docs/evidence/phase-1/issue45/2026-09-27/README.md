# Issue #45 implementation evidence — 2026-09-27

Scope: Phase 1 mock-only implementation of the Health Monitor all-app list and admin cross-user management, traced to [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30) and the evidence contract in [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29). No backend, database, HTTP cookie, or connection-probe implementation is claimed.

## Implementation trace

The implementation follows the requested chain: `contracts/openapi.yaml` → generated `frontend/src/contracts/api.d.ts` → strict admin-app mapper → API and Promise service → deterministic mock → admin Health Monitor. `GET /admin/apps` returns only the contract’s URL, name, owner nickname, visibility, theme, versions, creation time, and stored connection result. The page size defaults to 24 and is capped at 100; the mock sorts by `created_at DESC, id DESC`. The UI deduplicates IDs, keeps loaded rows on next-page errors, and offers explicit retries. Whole-set totals come from admin stats, and member `app_count` includes public and private apps.

An approved admin can open another member’s private app in the existing detail/edit/delete flows. Confirmed writes invalidate app lists, details, admin totals, and author counts and return to the Health Monitor. Existing version conflict, permission-loss, and unknown-write behavior stays on the shared write path. A regular member’s attempt to read private content or edit remains concealed/denied.

The Health Monitor preserves the source row sequence (name, URL, stored connection summary, row actions) and adds author, version, visibility, and check time. Global and per-row recheck controls remain disabled with an accessible explanation; latency, error text, and a newly completed check are not fabricated. “앱 관리” opens the existing detail/edit/delete flow in place of the source’s direct row delete.

## First failures and fixes

- The initial mock admin-app list test exposed an inconsistent `has_more` value on an empty result; the mock now reports pagination from the returned page and full synthetic total.
- The first admin write-path test confirmed owner-only mock writes rejected the admin. The shared app lookup now accepts either the owner or an admin with the management capability, preserving the existing operation/version checks.
- The first Health E2E run correctly failed while the tab and list did not exist. During UI wiring, an ambiguous row locator and a seeded-list count expectation were corrected to scope by app name and assert the 24-row first page before loading page 25.
- The first cross-user edit browser run stalled because an inline `onSaved` wrapper changed identity during the dirty-form flow. Removing that wrapper and reading the `fromAdmin` route state in the existing callback restored the shared save path; edit, visibility, return navigation, and deletion then passed.
- The recheck accessibility case found that `Btn` did not forward `aria-describedby`. It now forwards that attribute; the disabled control exposes the explanation in the browser accessibility tree.
- The existing admin E2E queried the Health Monitor as a button after it became a semantic tab. Its locator now uses the tab role.

## Verification

Commands were run from `frontend/` unless noted.

| Command | Result |
| --- | --- |
| `npm run check` | PASS: OpenAPI lint and generated-type check, TypeScript, ESLint, and Prettier. |
| `npm test` | PASS: 21 files, 326 tests. |
| `CI=true npm run test:e2e` | PASS: 87 tests, one Playwright worker. |
| `npm run build:mock` | PASS. Vite emitted its existing-size warning for a 560.55 kB minified mock JS chunk (the configured warning threshold is 500 kB). |
| `npm run build && npm run check:dist` | PASS: API bundle; 96 files and no mock fixtures, references, tweaks, or source maps. |
| `npm run check:reference` | PASS: 11 preserved originals matched SHA-256 and byte counts. |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS: 102 visual cases, one worker, Chromium `151.0.7922.34`; Noto Sans CJK JP selected for both Korean font checks. |
| `git diff --check` | PASS. |

The new targeted checks also passed: four unit files (50 tests) and six CI-mode browser cases covering admin management, pagination/error retry, empty/error recovery, keyboard tabs, monitor privacy/accessibility names, and non-owner private-access denial.

## Five-viewport evidence

The pinned visual comparison uses the preserved `21-admin-health.png` references, zero pixel tolerance, and does not enforce approval. All five screenshots were captured; each reference differs in full-page height, so the comparator reports a dimension mismatch and has no pixel count. This is recorded as a visual difference, not a fidelity PASS.

| Viewport | Product screenshot height | Reference height | Result |
| --- | ---: | ---: | --- |
| 1440×1000 | 1859 | 1966 | Dimension mismatch |
| 1024×900 | 1859 | 1966 | Dimension mismatch |
| 768×1024 | 2187 | 2112 | Dimension mismatch |
| 390×844 | 3446 | 2977 | Dimension mismatch |
| 360×844 | 3773 | 3069 | Dimension mismatch |

Screenshots: [1440×1000](visual/admin-health-1440x1000.png), [1024×900](visual/admin-health-1024x900.png), [768×1024](visual/admin-health-768x1024.png), [390×844](visual/admin-health-390x844.png), [360×844](visual/admin-health-360x844.png). Per-viewport comparator records: [comparison.json](visual/comparison.json). No source reference or baseline was modified.

## Unverified and pending

- No real API server, database aggregation, server-side permission enforcement, HTTP cookie behavior, concurrent pagination ordering, or production connection check is implemented or tested. Health values are deterministic synthetic state; T18 owns real checks.
- Human UI-D/source-diff approval, physical-device and screen-reader review, hosted CI, and DomineYH’s local handover acceptance remain pending. No pending item is reported as PASS.
- The mock build has a non-blocking Vite chunk-size warning; the API production bundle and separation check pass.
