#42 local run evidence

Branch: `impl/issue-42`. This run covers owner-only app deletion, cancellation, operation-key result handling, mock cleanup, gallery refresh, and the affected UI. Visual fixtures use synthetic data only.

## Final verification

| Command                                                                                                                                                                                       | Result                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `cd frontend && npm run check`                                                                                                                                                                | PASS · OpenAPI lint and generated-type check, typecheck, lint, and format check.    |
| `cd frontend && npm test`                                                                                                                                                                     | PASS · 301 tests across 21 files.                                                   |
| `cd frontend && CI=true npm run test:e2e`                                                                                                                                                     | PASS · 70 tests, one worker.                                                        |
| `cd frontend && npm run build:mock`                                                                                                                                                           | PASS · mock bundle built; Vite reported its non-blocking 500 kB chunk-size warning. |
| `cd frontend && npm run build && npm run check:dist`                                                                                                                                          | PASS · API build; 96-file bundle has no mock fixtures, references, or source maps.  |
| `cd frontend && npm run check:reference`                                                                                                                                                      | PASS · all 11 preserved originals and copies match.                                 |
| `cd frontend && FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` | PASS · 92 visual cases, one worker.                                                 |

Focused runs during implementation also passed: the OpenAPI/mapper/API/mock selection (55 tests), mock deletion tests after idempotent replay was added (18 tests), acceptance-trace tests (9 tests), and `CI=true npm run test:e2e -- e2e/app-edit.spec.js` (13 tests).

## Visual evidence

`visual/` contains 35 screenshots and `visual-comparison.json`: cancel and confirm source comparisons plus five product-only operation states (`delete-key-rejected`, `delete-unresolved`, `delete-pending-confirmation`, `delete-confirming`, and `delete-unknown`) at 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. The comparator threshold is zero pixels. It records 10 source dimension mismatches and 25 product-only captures; no pixel count is reported for the mismatched dimensions.

| State   | Actual full-page heights, in viewport order | Reference heights            |
| ------- | ------------------------------------------- | ---------------------------- |
| Cancel  | 1399, 1380, 1772, 1883, 1944                | 1361, 1341, 1733, 1844, 1939 |
| Confirm | 1495, 1476, 1868, 2058, 2100                | 1456, 1437, 1829, 2019, 2095 |

Viewport order is 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. References are the unchanged `14-delete-confirm.png` and `15-delete-cancel.png` captures under `docs/evidence/basic-design-runtime-20260922/reference/`. The run used Chromium 151.0.7922.34 and Noto Sans CJK JP with SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`.

Automated browser checks cover keyboard cancellation, focus transfer to pending/result controls, accessible confirmation naming, non-owner public access, refresh warning, same-key recovery, delayed success, and refreshed gallery state. Human UI-D, screen-reader, and device review remains pending.

## First failures and fixes

- The first delete E2E run exposed a `ReferenceError` from a stale actor variable in the route state guard. The guard now compares the current actor ref; the focused browser suite passed afterward.
- The committed-but-response-lost scenario initially displayed generic save-result text. The mock unknown-result helper now accepts deletion-specific copy; the focused unknown-result browser case passed.
- A lint run started alongside Playwright hit `ENOENT` because Playwright clears `test-results` while ESLint scans it. The serial lint rerun passed with no warnings. This was a test-runner file-system race.

## Open and unverified

- No real backend, HTTP server, database transaction, cookie/CSRF enforcement, persistent operation-key store, production health-job cancellation, or production analytics is included.
- Accepting a refresh does not restore the current-tab in-memory operation key; the warning and stay-on-page recovery are verified.
- Hosted CI was not run because this task does not push or open a PR. Human visual, assistive-technology, device, original-difference, and local-handover approvals remain with DomineYH.
