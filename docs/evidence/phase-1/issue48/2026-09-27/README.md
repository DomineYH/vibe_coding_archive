# Issue #48 implementation evidence — 2026-09-27

Scope: Phase 1 administrator whole health batch monitoring using the deterministic local mock. The change follows #30 and the API, worker, and evidence decisions linked from #48. No backend, database, worker, real URL probe, or external network request is implemented or claimed.

## Implementation trace

`contracts/openapi.yaml` → generated TypeScript contract → strict batch/stat mappers → API and Promise service → persistent deterministic mock → admin Health Monitor. POST creates or reuses the active batch; summary IDs rediscover active/latest batches after reload; GET reads and advances synthetic work. Batch targets remain fixed, with counts for queued/running/result/failed/cancelled and reused results as a subset of obtained results. The mock preserves prior app results on job failure/cancellation, cancels active targets for URL/app/account changes, excludes newly added apps, models empty batches and the five-minute cooldown, and never calls an external URL.

The monitor starts work only on explicit submit, polls a visible active batch every two seconds without overlap, stops polling on hide/exit/terminal/read error, and offers explicit GET recovery. Read errors remain separate from job failures. Healthy totals count only current fresh healthy results and refresh at their expiry. Existing row order and unavailable per-row checks remain intact; stale rows retain their result and show that it is old.

The mock advertises `health_batch` as available for its synthetic implementation. The controlled unavailable scenario still returns `503 FEATURE_UNAVAILABLE`; this does not claim the real API or worker is available.

## First failures and fixes

- A new capability assertion first failed because mock metadata still marked `health_batch` as `not_implemented`, despite the completed synthetic service path. Metadata now reflects mock availability; the unavailable scenario continues to cover a temporary 503.
- The first batch browser runs exposed reset-event churn while updating targets one at a time. Batched app updates now suppress intermediate reset notifications and publish once after the batch update.
- The first progress-recovery flow did not clear React Query's read-error state through interval refetch. Explicit retry now issues one GET and puts that returned batch in the query cache. The reload recovery case uses a controlled read-error scenario to verify the same saved batch ID without depending on a real-time polling race.
- One browser case reassigned a `const` panel after reload, and an existing admin assertion expected outdated description copy. The panel binding and expectation now match the actual remounted route and current copy.
- A later check against #14 caught that batch GET advanced queued work before the app cooldown ended. The new regression first failed with six targets running instead of remaining queued. GET now leaves each target queued until its stored `next_check_at`, then starts it at the boundary; the focused health batch suite passed after the fix.
- The final `npm run check` first stopped on Prettier wrapping in the cooldown assertion. Running `npx prettier --write tests/health-batches.test.ts` fixed it, and the final check rerun passed.

## Verification

Commands ran from `frontend/` unless noted.

| Command | Result |
| --- | --- |
| `npm test -- tests/health-batch-mappers.test.ts tests/health-batches-api.test.ts tests/health-batches.test.ts tests/admin-mappers.test.ts tests/admin-api.test.ts tests/admin-service.test.ts tests/mock-app-write.test.ts tests/mock-state-validation.test.ts tests/openapi-contract.test.js` | PASS: 9 files, 172 tests. |
| `CI=true npm run test:e2e -- e2e/admin-apps.spec.js -g 'whole scan|empty batches'` | PASS: 3 batch cases, one Playwright worker. |
| `npm run check` | PASS: OpenAPI lint and generated-type check, TypeScript, ESLint, and Prettier. |
| `npm test` | PASS: 27 files, 404 tests. |
| `CI=true npm run test:e2e` | PASS: 102 tests, one Playwright worker. |
| `npm run build:mock` | PASS. Vite reports the mock JS bundle at 618.87 kB, above its 500 kB advisory threshold. |
| `npm run build && npm run check:dist` | PASS: API bundle; 96 files, no mock fixtures, tweaks, references, or source maps. |
| `npm run check:reference` | PASS: all 11 preserved originals match SHA-256 hashes and byte counts. |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS: 122 tests, one worker, pinned Chromium 151.0.7922.34. Five whole-batch final-state product captures were recorded. Existing admin Health Monitor reference comparisons remain `dimensions_mismatch` and the comparator is non-enforcing; this is not a human UI-D approval. |
| `git diff --check` | PASS. |

The focused browser tests were also rerun after the explicit GET recovery and remount locator fixes; the final targeted run passed all three cases. A first metadata test run intentionally failed before the mock capability flag was corrected.

## Five-viewport evidence

The original Health Monitor capture and the completed mixed-batch state were captured at all five required viewports. Final batch captures are product-only, with no new baseline or tolerance. The original screen comparison uses the preserved [`21-admin-health.png` references](../../../basic-design-runtime-20260922/reference/); dimensions and product-only statuses are recorded in [`visual-comparison.json`](visual/visual-comparison.json).

| Viewport | Health Monitor height | Preserved reference height | Reference result | Final batch capture |
| --- | ---: | ---: | --- | --- |
| 1440×1000 | 1893 | 1966 | Dimension mismatch | [PNG](visual/admin-health-batch-final-1440x1000.png) |
| 1024×900 | 1893 | 1966 | Dimension mismatch | [PNG](visual/admin-health-batch-final-1024x900.png) |
| 768×1024 | 2220 | 2112 | Dimension mismatch | [PNG](visual/admin-health-batch-final-768x1024.png) |
| 390×844 | 3479 | 2977 | Dimension mismatch | [PNG](visual/admin-health-batch-final-390x844.png) |
| 360×844 | 3823 | 3069 | Dimension mismatch | [PNG](visual/admin-health-batch-final-360x844.png) |

The Health Monitor captures are [`1440×1000`](visual/admin-health-1440x1000.png), [`1024×900`](visual/admin-health-1024x900.png), [`768×1024`](visual/admin-health-768x1024.png), [`390×844`](visual/admin-health-390x844.png), and [`360×844`](visual/admin-health-360x844.png). No reference, baseline, or pixel tolerance was changed. DomineYH's UI-D review remains pending.

## Unverified and pending

- Real API endpoint behavior, authorization/CSRF enforcement, database transactions and persistence, worker execution, concurrency, and actual network/SSRF behavior remain unimplemented.
- Screen-reader and physical-device review, human UI-D/source-difference approval, hosted CI, and DomineYH's local handover acceptance remain pending. Local mock tests and screenshots do not establish those results.
- No push, PR, merge, deployment, or release approval is included.
