# Issue #31 local run evidence

Run date: 2026-09-25 (Asia/Seoul). Worktree branch: `impl/issue-31`; starting commit: `ed6b2a4229ebe36ef61bbfb2b6c174e7ac316e40`. The implementation commit is identified in the task report. Product mode was mock; no backend, database, external application URL, or real health probe was used.

## Environment

- Ubuntu 24.04.3 / WSL2 Linux x86_64.
- Node `22.23.2`, npm `12.0.2`; frontend dependencies installed from the lockfile with `npm ci` (349 packages; zero vulnerabilities reported).
- Functional browser suite: Playwright `1.63.0`.
- Visual suite: Chromium `151.0.7922.34`, DPR 1, `ko-KR`, `Asia/Seoul`, system clock fixed to the source capture time. Five source viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844.

## Command results

All frontend commands ran from `frontend/` unless noted.

| Command                                                                                                                                                                      | Result                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                                                                     | PASS; 349 packages, zero vulnerabilities reported                                                                             |
| `npm run openapi:generate`                                                                                                                                                   | PASS; generated `src/contracts/api.d.ts` from `contracts/openapi.yaml`                                                        |
| `npm run check`                                                                                                                                                              | PASS; OpenAPI lint, generated type comparison, TypeScript, ESLint, and Prettier                                               |
| `npm test -- tests/mock-apps.test.ts`                                                                                                                                        | PASS; 8/8 tests                                                                                                               |
| `npm test -- tests/openapi-contract.test.js`                                                                                                                                 | PASS; all shipped detail fixtures satisfy `AppDetail`; required-field rejection is checked                                    |
| `npm test -- tests/check-dist.test.js`                                                                                                                                       | PASS; valid output, `.env` and unapproved-asset rejection, and non-JS content scan                                            |
| `npm test`                                                                                                                                                                   | PASS; 6 files, 22/22 tests                                                                                                    |
| `npm run test:e2e`                                                                                                                                                           | PASS; 6/6 browser scenarios                                                                                                   |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/dominelinux/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | PASS; 32/32 comparisons meet the exact zero-pixel threshold                                                                   |
| `npm run build:mock`                                                                                                                                                         | PASS                                                                                                                          |
| API `npm run build` with a temporary `public/.env` sentinel; `npm run check:dist`                                                                                            | PASS; sentinel excluded; API `dist/` has 96 files and excludes mock fixtures, Tweaks, source/reference files, and source maps |
| `npm run check:reference`                                                                                                                                                    | PASS; 11/11 preserved originals match SHA-256 and byte counts                                                                 |
| `npm run mock:reset`                                                                                                                                                         | PASS; prints the explicit browser reset route and instructions. Actual reset recovery was exercised in E2E.                   |

The first browser run exposed an empty public detail route: JSX state elements were treated as truthy before rendering. The route guard now checks only `loading || error`; the original browser suite then passed 4/4, and the final expanded suite passed 6/6. The first unknown-ID assertion used a heading role for a source `EmptyState` title rendered as a `div`; the assertion now checks the `alert` region and the final browser suite passes. No visual failure is converted into a pass.

## Product screenshots and comparison

The 32 PNGs in this directory are product captures produced by the exact Chromium visual suite. [`visual-comparison.json`](visual-comparison.json) contains each source path, image dimensions, differing-pixel count, channel delta, and bounds. Every case now has zero differing pixels and zero maximum channel delta.

| Viewport  | Gallery before → after | Public detail before → after |
| --------- | ---------------------: | ---------------------------: |
| 1440×1000 |             69,435 → 0 |                   46,099 → 0 |
| 1024×900  |             73,828 → 0 |                   46,371 → 0 |
| 768×1024  |             66,453 → 0 |                   46,221 → 0 |
| 390×844   |             67,167 → 0 |                   45,955 → 0 |
| 360×844   |             66,878 → 0 |                   40,509 → 0 |

The first review run passed 13/32 cases. At 1440×1000, first-card and detail-aside components went from 2,698 and 8,531 differing pixels to zero. The final run passed 32/32. The source-reference PNGs and zero-pixel threshold were not changed.

| State                     | Exact-pixel matches |
| ------------------------- | ------------------: |
| Initial loading           |                 5/5 |
| Empty results             |                 5/5 |
| Request failure and retry |                 5/5 |
| Corrupt-storage recovery  |                 5/5 |

The initial 69k-pixel gallery delta came from running full Chrome for Testing against references captured with Chromium's headless-shell renderer. Pinning the same Chromium `151.0.7922.34` headless-shell removed that rasterization difference. The local Pretendard font faces matched; the renderer caused their raster output to differ. Remaining DOM/layout causes were the gallery `Link` missing the source button's centered inline-flex layout, detail date separators/padding, and two mismatched Lucide icons; matching the source CSS, `YYYY-MM-DD` date, `ChevronLeft`, and `ArrowUpRight` closed them. The empty-state test initially substituted an empty API response and skipped the source's preceding gallery and focused-search captures. It now filters the same 16-item fixture and reproduces that exact capture sequence: this reduced a residual 89 pixels at each mobile viewport (desktop/tablet were already zero) to zero at all five viewports. No product/source pixel difference remains and no UI-D candidate is pending.

The three states without source captures use [`visual-state-baselines/`](visual-state-baselines/) as product-only regression captures. Their prior captures used the wrong renderer; they were re-captured under the source's pinned headless-shell renderer. This did not change any original source reference. Normal visual runs compare all captures without rewriting them.

## Original repeat evidence

[`original-repeat-summary.json`](original-repeat-summary.json) retains five fresh browser-context replays of the unchanged original using the preserved CDN HAR and `capture.py`/`verify.py`. Each completed 130 states with unchanged sources, stable state metrics, and no page, console, failed-request, or blocked-request errors. Strict pixel identity varied by context (129, 129, 130, 131, and 130 of 135 PNGs). The previously varied captures do not produce source/product deltas in the final pinned visual run, which reproduces the original capture sequence exactly.

The original replay command for each fresh context was:

```bash
python3 docs/evidence/basic-design-runtime-20260922/capture.py \
  --mode replay \
  --har docs/evidence/basic-design-runtime-20260922/reference/cdn.har.zip \
  --out /tmp/issue31-original-replay-N
python3 docs/evidence/basic-design-runtime-20260922/verify.py \
  --candidate /tmp/issue31-original-replay-N
```

`capture.py` returned success each time. `verify.py` returned 1 for the retained source-to-source replay variation. The source files and recorded baselines were not edited.

## Remaining unverified work

- Hosted CI execution and local handover acceptance.
- Real API/backend/database behavior, auth/session/cookie protection, actual health probes, and operational or release approval.
- Physical mobile devices and assistive-technology review; viewport and keyboard checks used desktop Chromium.
- Phase 1 auth, submit, and admin screens owned by other implementation tickets, and all Phase 2–7 work.
