# Issue #31 local run evidence

Run date: 2026-09-25 (Asia/Seoul). Worktree branch: `impl/issue-31`; starting commit: `ed6b2a4229ebe36ef61bbfb2b6c174e7ac316e40`. The implementation commit is identified in the task report. Product mode was mock; no backend, database, external application URL, or real health probe was used.

## Environment

- Ubuntu 24.04.3 / WSL2 Linux x86_64.
- Node `22.23.2`, npm `12.0.2`; frontend dependencies installed from the lockfile with `npm ci` (349 packages; zero vulnerabilities reported).
- Functional browser suite: Playwright `1.63.0`.
- Visual suite: Chromium `151.0.7922.34`, DPR 1, `ko-KR`, `Asia/Seoul`, system clock fixed to the source capture time. Five source viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844.

## Command results

All frontend commands ran from `frontend/` unless noted.

| Command                                                                                                                         | Result                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                        | PASS; 349 packages, zero vulnerabilities reported                                                           |
| `npm run openapi:generate`                                                                                                      | PASS; generated `src/contracts/api.d.ts` from `contracts/openapi.yaml`                                      |
| `npm run check`                                                                                                                 | PASS; OpenAPI lint, generated type comparison, TypeScript, ESLint, and Prettier                             |
| `npm test -- tests/mock-apps.test.ts`                                                                                           | PASS; 6/6 tests                                                                                             |
| `npm test`                                                                                                                      | PASS; 3 files, 12/12 tests                                                                                  |
| `npm run test:e2e`                                                                                                              | PASS; 6/6 browser scenarios                                                                                 |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/dominelinux/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome npm run test:visual` | FAIL by contract; 0/12 cases pass the exact zero-pixel threshold                                            |
| `npm run build:mock`                                                                                                            | PASS                                                                                                        |
| `npm run build && npm run check:dist`                                                                                           | PASS; API `dist/` has 96 files and excludes mock fixtures, Tweaks, source/reference files, and source maps  |
| `npm run check:reference`                                                                                                       | PASS; 11/11 preserved originals match SHA-256 and byte counts                                               |
| `npm run mock:reset`                                                                                                            | PASS; prints the explicit browser reset route and instructions. Actual reset recovery was exercised in E2E. |

The first browser run exposed an empty public detail route: JSX state elements were treated as truthy before rendering. The route guard now checks only `loading || error`; the original browser suite then passed 4/4, and the final expanded suite passed 6/6. The first unknown-ID assertion used a heading role for a source `EmptyState` title rendered as a `div`; the assertion now checks the `alert` region and the final browser suite passes. No visual failure is converted into a pass.

## Product screenshots and comparison

The 12 PNGs in this directory are product captures produced by the exact Chromium visual suite. [`visual-comparison.json`](visual-comparison.json) contains each source path, image dimensions, differing-pixel count, channel delta, and bounds. Dimensions match for all 12 cases.

| Viewport  | Gallery differing pixels | Public detail differing pixels |
| --------- | -----------------------: | -----------------------------: |
| 1440×1000 |                   69,435 |                         46,099 |
| 1024×900  |                   73,828 |                         46,371 |
| 768×1024  |                   66,453 |                         46,221 |
| 390×844   |                   67,167 |                         45,955 |
| 360×844   |                   66,878 |                         40,509 |

At 1440px the first-card component has 2,698 differing pixels and the detail aside has 8,531. The automated visual command correctly exits nonzero. No tolerance, mask, baseline rewrite, or human exception is applied; DomineYH visual review and local handover acceptance are pending.

## Original repeat evidence

[`original-repeat-summary.json`](original-repeat-summary.json) summarizes five fresh browser-context replays of the unchanged original using the preserved CDN HAR and the existing `capture.py`/`verify.py` harness. Each capture completed 130 states with unchanged sources, 130/130 stable state metrics, and zero page, console, failed-request, or blocked-request errors. Strict pixel identity varied by context: 129, 129, 130, 131, and 130 of 135 PNGs. Six image paths differed at least once; pixel counts also varied between runs. The exact per-run paths, bounds, counts, and channel deltas are retained in the JSON. The cause remains undetermined and all differences remain unapproved.

The original replay command for each fresh context was:

```bash
python3 docs/evidence/basic-design-runtime-20260922/capture.py \
  --mode replay \
  --har docs/evidence/basic-design-runtime-20260922/reference/cdn.har.zip \
  --out /tmp/issue31-original-replay-N
python3 docs/evidence/basic-design-runtime-20260922/verify.py \
  --candidate /tmp/issue31-original-replay-N
```

`capture.py` returned success each time. `verify.py` returned 1 for the retained exact-pixel differences; no approved tolerance exists. The source files and recorded baselines were not edited.

## Remaining unverified work

- Exact visual comparisons and approval of every remaining difference.
- Hosted CI execution.
- Real API/backend/database behavior, auth/session/cookie protection, actual health probes, and operational or release approval.
- Physical mobile devices and assistive-technology review; viewport and keyboard checks used desktop Chromium.
- Phase 1 auth, submit, and admin screens owned by other implementation tickets, and all Phase 2–7 work.
