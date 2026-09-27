# Issue #47 implementation evidence — 2026-09-27

Scope: individual app connection status and check freshness for Phase 1. The UI, API adapter, and deterministic mock use synthetic results only. No DNS, TLS, HTTP, external-network request, background worker, backend, or database probe is implemented or claimed.

## Implementation trace

`contracts/openapi.yaml` → generated TypeScript contract → strict health mappers → API/service → local mock → app detail panel. The contract adds health snapshot, check request, and job response operations. Current app `url_version` scopes each result; URL edits clear its result and measurement, and stale job responses cannot be applied to a newer URL. Public checks can use the anonymous flow; reads follow app visibility, change-only sessions cannot request checks, and technical measurements are returned only for a current full administrator. `health_batch` remains unavailable.

The mock distinguishes unchecked, healthy, HTTP error, timeout, network error, blocked, and redirect error results from queued, running, completed, failed, and cancelled jobs. It models 15-minute freshness, the exact stale boundary, 60-second app cooldown, 10 checks per actor-minute, active-work reuse, and result reuse only while fresh. A failed or cancelled job preserves the previous result. The detail route polls a visible active job every two seconds, stops on hide/exit/terminal/error, and exposes explicit GET recovery after a read error. Refresh does not create a check.

## TDD findings

The first migration-focused run exposed tests still expecting storage version 8 and legacy fixtures carrying the new measurement field. The migration tests now cover version 8 → 9 and omit version 9 fields from older stored shapes; the focused final rerun passed 155/155 tests across seven files.

The first focused browser run passed 19/21. The queued-state locator matched multiple statuses, and legacy checked fixture rows legitimately lacked admin measurements. The locator is scoped to the target status, and the mapper preserves missing paired measurements as null; the two focused regressions then passed. The first stale visual setup also re-ran its seed script on full navigation, resetting the mock clock. The harness now changes routes without reloading; the narrow stale states passed 2/2, and all 20 health product captures passed.

## Verification

Commands ran from `frontend/` unless noted.

| Command | Result |
| --- | --- |
| `npm run check` | PASS: OpenAPI lint and generated-type check, TypeScript, ESLint, and Prettier. |
| `npm test` | PASS: 24 files, 383 tests. |
| `CI=true npm run test:e2e` | PASS: 99 tests with one worker. |
| `npm run build:mock` | PASS. Vite reports the mock JS bundle at 604.14 kB, above its 500 kB advisory threshold. |
| `npm run build` | PASS: API bundle. |
| `npm run check:dist` | PASS: 96 API files; no mock fixtures, tweaks, references, or source maps. |
| `npm run check:reference` | PASS: all 11 preserved originals match their SHA-256 hashes and byte counts. |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | 109/122 passed in the full pinned Chromium 151.0.7922.34 run. Eleven failures are expected dimension mismatches against the unchanged source detail captures; two narrow stale-state setup cases were fixed and passed on targeted rerun (2/2). The full visual suite was not rerun after that visual-test-only fix. |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual -- --grep "health-(result-error|job-failed|query-error|stale)"` | PASS: all 20 health-state product-only captures, one worker. |
| `git diff --check` | PASS. |

## Five-viewport visual evidence

The health result-error, failed-job, query-error, and stale states have product-only captures at 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. All 20 are in [`visual/`](visual/); the per-state measurements and source dimension comparisons are in [`visual-comparison.json`](visual/visual-comparison.json).

The preserved full-page detail source heights are 1360, 1341, 1757, 1968, and 1955 pixels at those viewports; the product heights are 1533, 1514, 1930, 2141, and 2147. The detail copy-success captures have the same respective dimensions. The preserved detail component is 340×555; the product component is 340×729. These 11 comparisons are dimension mismatches, so pixel counts are unavailable. The differences come from the requested detail health panel and its narrow-screen content. The gallery captures and other visual cases passed in the full run. No source reference, baseline, or zero-pixel threshold was changed.

Representative captures: [stale 1440×1000](visual/health-stale-1440x1000.png), [stale 390×844](visual/health-stale-390x844.png), [HTTP error 1440×1000](visual/health-result-error-1440x1000.png), and [failed job 360×844](visual/health-job-failed-360x844.png). The [acceptance trace](../../../../acceptance.md) and [UI deviation record](../../../../ui-deviations.md) link this run.

## Unverified and pending

- Real server authorization, queueing, worker execution, durable storage, cross-tab or server-side rate enforcement, and API/database transaction behavior are not exercised.
- No external URL is contacted; production DNS, TLS, HTTP, SSRF policy, and network error classification remain unimplemented.
- Human UI-D approval, screen-reader and physical-device review, hosted CI, and local handover remain pending. No push, PR, or merge is part of this work.
