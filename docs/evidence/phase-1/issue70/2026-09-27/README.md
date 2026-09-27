# Issue #70 implementation evidence — 2026-09-27

Scope: keep Health Monitor metadata items intact and clear of status badges, and keep authenticated header labels on one line at narrow widths. The nickname uses the available header width and truncates only when that space runs out. Row data, title/URL truncation, behavior, and accessible names are unchanged.

## Red/green checks

The browser checks iterate every Health Monitor row at 360×844 and 390×844. They require each author/version/visibility item to render on one line, at least a 2px gap between each metadata text fragment and the row's status badge, and no horizontal document overflow. Header assertions run on Health Monitor, member management, and app detail; they require one-line logo/logout labels and a nickname slot wider than the former 72px cap.

The first #70 implementation made the header labels non-wrapping and removed metadata `shrink-0`, but independent review found two remaining narrow-screen issues: Korean author text broke mid-name and the nickname was limited by a hard 72px cap. The expanded checks reproduced both failures at 360px. The final change keeps each metadata item non-wrapping, moves the status summary to its own row below `sm`, and lets the nickname slot flex into the available header width.

| Command                                                                                                                                                                                                  | Result                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CI=true npm run test:e2e -- --config=playwright.issue70.config.js e2e/admin-apps.spec.js --grep 'Health Monitor metadata\|authenticated header text'` before follow-up fix (temporary port 5174 config) | Expected RED: 360px `작성자 교사김코딩` rendered on two lines; the nickname slot remained capped at 72px. The temporary config avoided another worktree's server on port 5173 and was removed after the run. |
| `CI=true npm run test:e2e -- e2e/admin-apps.spec.js --grep 'Health Monitor metadata\|authenticated header text'` after follow-up fix                                                                     | PASS: 2 tests at 360px and 390px; all loaded rows keep metadata items on one line and clear of status badges, and header checks pass on all three authenticated screens.                                     |

## Initial issue #70 commit verification (before review follow-up)

Commands ran from `frontend/` unless noted.

| Command                                                                                                                                                                        | Result                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                                                                       | PASS: 349 packages installed, zero vulnerabilities.                                                                                          |
| `npm run check`                                                                                                                                                                | PASS: OpenAPI lint/type check, TypeScript, ESLint, and Prettier.                                                                             |
| `npm test`                                                                                                                                                                     | PASS: 27 files, 406 tests.                                                                                                                   |
| `CI=true npm run test:e2e`                                                                                                                                                     | 105/106 passed; the unrelated gallery search-history case timed out waiting for its debounced URL. The one-time targeted retry below passed. |
| `CI=true npm run test:e2e -- e2e/gallery.spec.js -g 'search edits replace history while subject and grade filters remain navigable'`                                           | PASS: 1 test on retry.                                                                                                                       |
| `npm run build:mock`                                                                                                                                                           | PASS; Vite reports the existing mock bundle size warning (619.18 kB over its 500 kB advisory threshold).                                     |
| `npm run build && npm run check:dist`                                                                                                                                          | PASS: API bundle and 96-file distribution check; Vite reports its existing 502.12 kB chunk warning.                                          |
| `npm run check:reference`                                                                                                                                                      | PASS: all 11 preserved originals match their SHA-256 hashes and byte counts.                                                                 |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS: 122 tests, one worker, Chromium 151.0.7922.34.                                                                                         |
| `git diff --check`                                                                                                                                                             | PASS.                                                                                                                                        |

## Review follow-up verification

| Command                                                                                                                                                                        | Result                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `CI=true npm run test:e2e -- e2e/admin-apps.spec.js --grep 'Health Monitor metadata\|authenticated header text'`                                                               | PASS: 2 targeted browser tests at both narrow viewports.   |
| `npm run check`                                                                                                                                                                | PASS: OpenAPI lint/check, typecheck, ESLint, and Prettier. |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS: 122 tests, one worker, Chromium 151.0.7922.34.       |
| `git diff --check`                                                                                                                                                             | PASS.                                                      |

## Five-viewport evidence

The screenshots include Health Monitor and member management to show the shared authenticated header at every required viewport. Height values are product/reference pixels from the preserved `21-admin-health.png` and `18-admin-users.png` captures.

| Viewport  | Member management product/reference height | Health Monitor product/reference height |
| --------- | -----------------------------------------: | --------------------------------------: |
| 1440×1000 |                                1378 / 1111 |                             1893 / 1966 |
| 1024×900  |                                1378 / 1111 |                             1893 / 1966 |
| 768×1024  |                                1378 / 1218 |                             2220 / 2112 |
| 390×844   |                                1870 / 2456 |                             3751 / 2977 |
| 360×844   |                                2110 / 1560 |                             3768 / 3069 |

All ten full-page comparisons report `dimensions_mismatch`, so they have no pixel counts. Pixel tolerance remains zero; the comparator, masks, references, and product baselines were not changed. The JSON records and captures are in [`visual/`](visual/).

- Member management: [1440×1000](visual/admin-users-1440x1000.png), [1024×900](visual/admin-users-1024x900.png), [768×1024](visual/admin-users-768x1024.png), [390×844](visual/admin-users-390x844.png), [360×844](visual/admin-users-360x844.png).
- Health Monitor: [1440×1000](visual/admin-health-1440x1000.png), [1024×900](visual/admin-health-1024x900.png), [768×1024](visual/admin-health-768x1024.png), [390×844](visual/admin-health-390x844.png), [360×844](visual/admin-health-360x844.png).
- Per-viewport comparison records: [comparison.json](visual/comparison.json).

## Unverified and pending

The preserved 360px and 390px source headers omit the nickname and show an icon-only logout. Earlier #38 evidence says logout remains available but records no mobile presentation choice; #70 keeps the required visible one-line logout label and records that source difference for human UI-D approval. Screen-reader and physical-device review, hosted CI, and local handover acceptance also remain pending. Screenshot comparison results do not imply visual approval.
