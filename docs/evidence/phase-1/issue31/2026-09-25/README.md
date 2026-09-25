# Issue #31 local run evidence

Run date: 2026-09-25 (Asia/Seoul). Worktree branch: `impl/issue-31`; starting commit: `ed6b2a4229ebe36ef61bbfb2b6c174e7ac316e40`. The implementation commit is identified in the task report. Product mode was mock; no backend, database, external application URL, or real health probe was used.

## Environment

- Ubuntu 24.04.3 / WSL2 Linux x86_64.
- Node `22.23.2`, npm `12.0.2`; frontend dependencies installed from the lockfile with `npm ci` (349 packages; zero vulnerabilities reported).
- Functional browser suite: Playwright `1.63.0`.
- Visual suite: Chromium `151.0.7922.34`, DPR 1, `ko-KR`, `Asia/Seoul`, system clock fixed to the source capture time. Five source viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844.

## Command results

All frontend commands ran from `frontend/` unless noted.

| Command                                                                                                                                                                      | Result                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                                                                                     | PASS; 349 packages, zero vulnerabilities reported                                                                                                                           |
| `npm run openapi:generate`                                                                                                                                                   | PASS; generated `src/contracts/api.d.ts` from `contracts/openapi.yaml`                                                                                                      |
| `npm run check`                                                                                                                                                              | PASS; OpenAPI lint, generated type comparison, TypeScript, ESLint, and Prettier                                                                                             |
| `npm test -- tests/mock-apps.test.ts`                                                                                                                                        | PASS; 12/12 tests, including negative and terminal safe generations, malformed scenario shape, and shared query validation                                                  |
| `npm test -- tests/acceptance-record.test.js`                                                                                                                                | PASS; 2/2 checks for all-row trace fields and CI gate order                                                                                                                 |
| `npm test -- tests/openapi-contract.test.js`                                                                                                                                 | PASS; all shipped detail fixtures satisfy `AppDetail`; required-field rejection is checked                                                                                  |
| `npm test -- tests/api-apps.test.ts tests/apps-service.test.ts`                                                                                                              | PASS; 6/6 tests preserve and validate API error details and share query validation conversion                                                                               |
| `npm test -- tests/check-dist.test.js`                                                                                                                                       | PASS; 5/5 tests, including API reset-route and reset-page marker rejection                                                                                                  |
| `npm test -- tests/startup-storage.test.js`                                                                                                                                  | PASS; 2/2 tests cover both-key cleanup and continued startup when storage is denied                                                                                         |
| `npm test`                                                                                                                                                                   | PASS; 11 files, 39/39 tests                                                                                                                                                 |
| `npm test -- tests/vite-config.test.js`                                                                                                                                      | PASS; rejects `VITE_API_KEY` at config load                                                                                                                                 |
| `VITE_API_KEY=issue31-test-value npm run build`                                                                                                                              | PASS; API build rejected the forbidden key at config load                                                                                                                   |
| `npm run test:e2e`                                                                                                                                                           | PASS; 7/7 browser scenarios, including keyboard/accessibility and cross-tab reset checks                                                                                    |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/dominelinux/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | PASS; 32/32 comparisons meet the exact zero-pixel threshold                                                                                                                 |
| `npm run build:mock`                                                                                                                                                         | PASS                                                                                                                                                                        |
| API build with temporary `.env` sentinel (prior run); current `npm run build`; `npm run check:dist`                                                                          | PASS; the sentinel was excluded in the prior run; final API dist has 96 files and excludes mock fixtures, reset route/page, Tweaks, source/reference files, and source maps |
| `npm run check:reference`                                                                                                                                                    | PASS; 11/11 preserved originals match SHA-256 and byte counts                                                                                                               |
| `npm run mock:reset`                                                                                                                                                         | PASS; prints the explicit browser reset route and instructions. Actual reset recovery was exercised in E2E.                                                                 |

The first browser run exposed an empty public detail route: JSX state elements were treated as truthy before rendering. The route guard now checks only `loading || error`; the original browser suite then passed 4/4, and the #31-3 suite passed 6/6. The first unknown-ID assertion used a heading role for a source `EmptyState` title rendered as a `div`; the assertion now checks the `alert` region. The #31-4 suite passed 7/7; the current #31-5 suite also passes 7/7. No visual failure is converted into a pass.

Review #31-4 closes included a two-tab regression that first failed with zero cards in the cached empty tab after the other tab reset mock storage; it now refetches 16 cards. The keyboard test also exposed that the labeled subject-filter container was not exposed as a group; it now has the native group role. Final browser results are 7/7. Automated assertions reach and name all five subject filters, grade filter, search, 16 cards, detail actions, list/detail retry, and storage recovery controls; the separate manual demonstration remains pending a human.

Review #31-5 first reproduced the negative-generation bug (`-1` surfaced as `AbortError`) and a malformed scenario enum (`["empty"]` was accepted); a terminal safe generation also overflowed on reset. The validator now requires a nonnegative safe integer, checks scenarios against one typed allowlist without coercion, and wraps `MAX_SAFE_INTEGER` to zero on reset. The damaged-storage E2E now sets `generation: -1` and confirms the error/reset route restores 16 cards. The storage unit suite passes 11/11; its existing version, app-array, nested app-contract, and safe-integer guards were audited alongside these regressions. The acceptance-record test passes 2/2 and asserts all ten #31 rows provide every #29 §4 trace field plus the configured CI gate order.

Review #31-6 closes: API error envelopes retain validated `fields`, `request_id`, `reasons`, `retry_at`, and `server_time`; API and mock adapters share query-validation conversion; both presentation formatters share Seoul date-parts conversion. The reset route and recovery links are mock-only, and `check:dist` rejects either the API route marker or reset-page marker. Targeted checks passed 25/25; `npm run check`, both builds, API `check:dist`, and E2E passed; the full unit suite passed 39/39.

The initial red run failed the new negative-generation and scenario-shape assertions as expected. The terminal-generation red probe also showed that the old overflow left the module counter invalid for subsequent cases; after the wraparound fix, its boundary test is kept last so a future red result cannot mask the primary regressions with cascading failures.

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

[`original-repeat-summary.json`](original-repeat-summary.json) retains five fresh browser-context replays of the unchanged original using the preserved CDN HAR and `capture.py`/`verify.py`. Each completed 130 states with unchanged sources, stable state metrics, and no page, console, failed-request, or blocked-request errors. Strict pixel identity against the preserved source reference varied by context (129, 129, 130, 131, and 130 of 135 PNGs). These source-to-source failures remain history; the separate product visual run is 32/32 exact against the source references.

### Cause investigation: INCOMPLETE · AC7 BLOCKED

The five runs used the same Chromium `151.0.7922.34` executable, Python/Playwright versions, WSL2 host, viewport/DPR/locale/time settings, source hashes, and preserved HAR. All 130 captures per run matched the recorded screen/text/state/layout metrics. Every run also matched all 15 loaded Pretendard face declarations and the actual heading font records; page, console, failed-request, and blocked-request errors were all zero. This rules out source changes, a browser/HAR/version mismatch, missing font faces, recorded state/text/layout differences, and runtime/network failures.

Pairwise PNG inspection shows small edge/glyph-region deltas: the 390px detail/login outputs are mutually exact but each has the same 20-pixel delta against the preserved reference; the edit-component edge differs by 9 pixels in runs 1–3 only; the 360px filter-row region ranges from 18–20 pixels in runs 1–3, is absent in run 4, and reaches 89 pixels in run 5. For `360x844/03-gallery-empty.png`, source-reference counts for runs 1–5 are `[20,18,20,0,89]`; pairwise run rows are `run1 [0,25,0,20,107]`, `run2 [25,0,25,18,103]`, `run3 [0,25,0,20,107]`, `run4 [20,18,20,0,89]`, and `run5 [107,103,107,89,0]`. The earlier 0/100/250/400/800ms probe recorded 20/20/18/18/18 pixels but did not isolate a cause. A focused rerun of the exact 360px capture sequence then mapped the run-5 89-pixel bbox `[34,404,302,430]` to the five subject-filter button labels (`전체`, `수학`, `과학`, `영어`, `역사`): 16/18/18/18/18 differing pixels hit those buttons and one hit their row container. At both 400ms and 800ms after blur, the capture remained 89 pixels from the reference and the two rerun images were mutually identical (0 pixels different); button/text rectangles and computed styles matched, focus was on `body`, scrollbar width was 0, fonts were ready, and the capture hid the caret and disabled animations. This rules out post-blur wait timing as the cause of that outlier, plus image decode, caret, animation, and scrollbar causes for that region. It does not explain why fresh contexts rasterize those Korean glyphs differently. Source/runtime/HAR/state/font-face differences and page/network errors were also ruled out. AC7 remains BLOCKED at zero tolerance; no cause or exception is claimed.

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
- Replay raster-cause investigation remains incomplete; see the preceding section.
- Manual keyboard/accessibility demonstration remains pending a human; only automated browser checks are recorded here.
- Real API/backend/database behavior, auth/session/cookie protection, actual health probes, and operational or release approval.
- Physical mobile devices and assistive-technology review; viewport and keyboard checks used desktop Chromium.
- Phase 1 auth, submit, and admin screens owned by other implementation tickets, and all Phase 2–7 work.
