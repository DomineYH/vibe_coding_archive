# Issue #70 implementation evidence — 2026-09-27

Scope: narrow Health Monitor row spacing and shared authenticated header wrapping. The change is limited to layout classes; row data, title/URL truncation, behavior, and accessible names are unchanged.

## Red/green checks

The browser regression checks inspect rendered text fragments. At 360×844 and 390×844 they require at least a 2px gap between every author/version/visibility text fragment and its status badge, one line for the logo and logout label, and no horizontal document overflow. Header assertions run on Health Monitor, member management, and app detail.

Before the fix, the 360px checks failed: metadata touched the status badge, the logo and logout label wrapped, and the captured header showed both labels split across lines. The first visual run after making those labels non-wrapping exposed 360px horizontal overflow (370px on admin and 363px on the temporary-password screen). The existing user-name slot now truncates to 72px below the `sm` breakpoint; the two affected visual cases then passed.

| Command                                                                                                                                                                                                                                                               | Result                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CI=true npm run test:e2e -- --config=playwright.issue70.config.js --grep 'Health Monitor metadata\|authenticated header text'` before the fix                                                                                                                        | Expected RED at 360px: metadata/badge gap and one-line header assertions failed. A temporary Playwright config used port 5174 while another worktree owned 5173; it was removed after the targeted run. |
| `CI=true npm run test:e2e -- e2e/admin-apps.spec.js --grep 'Health Monitor metadata\|authenticated header text'` after the fix                                                                                                                                        | PASS: 2 tests, both widths; header remains within the viewport on all three authenticated screens.                                                                                                      |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual -- --grep 'admin approval screen at 360x844\|auth and private-read screens at 360x844'` | PASS: both previously overflowing 360px visual cases.                                                                                                                                                   |

## Final verification

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

## Five-viewport evidence

The screenshots include Health Monitor and member management to show the shared authenticated header at every required viewport. Height values are product/reference pixels from the preserved `21-admin-health.png` and `18-admin-users.png` captures.

| Viewport  | Member management product/reference height | Health Monitor product/reference height |
| --------- | -----------------------------------------: | --------------------------------------: |
| 1440×1000 |                                1378 / 1111 |                             1893 / 1966 |
| 1024×900  |                                1378 / 1111 |                             1893 / 1966 |
| 768×1024  |                                1378 / 1218 |                             2220 / 2112 |
| 390×844   |                                1870 / 2456 |                             3773 / 2977 |
| 360×844   |                                2110 / 1560 |                             4185 / 3069 |

All ten full-page comparisons report `dimensions_mismatch`, so they have no pixel counts. Pixel tolerance remains zero; the comparator, masks, references, and product baselines were not changed. The JSON records and captures are in [`visual/`](visual/).

- Member management: [1440×1000](visual/admin-users-1440x1000.png), [1024×900](visual/admin-users-1024x900.png), [768×1024](visual/admin-users-768x1024.png), [390×844](visual/admin-users-390x844.png), [360×844](visual/admin-users-360x844.png).
- Health Monitor: [1440×1000](visual/admin-health-1440x1000.png), [1024×900](visual/admin-health-1024x900.png), [768×1024](visual/admin-health-768x1024.png), [390×844](visual/admin-health-390x844.png), [360×844](visual/admin-health-360x844.png).
- Per-viewport comparison records: [comparison.json](visual/comparison.json).

## Unverified and pending

Human UI-D/source-difference approval, screen-reader and physical-device review, hosted CI, and local handover acceptance remain pending. Screenshot comparison results do not imply visual approval.
