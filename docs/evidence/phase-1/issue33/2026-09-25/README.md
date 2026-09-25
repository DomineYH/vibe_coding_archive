# Issue #33 local run evidence

Run date: 2026-09-25 (Asia/Seoul). Branch: impl/issue-33; starting commit: 445318f3e3ce0e599e7e5474320adb3e550880f3. This run uses the deterministic public mock only. No real backend, database, external app site, credentials, private data, or health probe is involved.

## Environment

- Node 22.23.2; npm 12.0.2; Playwright 1.63.0.
- Chromium 151.0.7922.34 headless-shell.
- Noto Sans CJK JP at /home/dominelinux/.fonts/NotoSansCJK-Regular.ttc; SHA-256 b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a.
- Visual viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844; DPR 1; ko-KR; Asia/Seoul; fixed capture time 2026-09-22T00:12:00.000Z.
- Thirty visual-only references cover API order, active filters, over-limit search, duplicate-only continuation, next-page failure, and developer reset recovery at all five fixed viewports. They are stored under visual-state-baselines/. Source screenshots and #31 references remain unchanged.

## Targeted implementation checks

| Command / check                                        | Result                                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial TDD run for apps-service tests                 | Red as expected before implementation: 4 failures, 5 passes. Failures exposed post-fold length, catalog filter, and unknown-query validation gaps.                                                                                                   |
| Targeted service/mock tests                            | An intermediate run had one ordering assertion failure because tie-sorted duplicate records were compared as arrays. The assertion was corrected to compare ID sets. Final full unit results are below.                                              |
| npm run typecheck                                      | First run after generated catalog unions found three string-array typing errors in mock metadata/facets. The mock now uses the generated catalog union; the final typecheck result is below.                                                         |
| npm run test:e2e -- --grep 'same-path filter history'  | Initial regression failed because Back to the same pathname scrolled to the top. History-entry key restoration was added; targeted rerun passed 1/1.                                                                                                 |
| npm run test:e2e -- --grep 'unabortable stale search'  | Targeted rerun passed 1/1. The scenario delays an older search past a newer result to exercise query-key isolation.                                                                                                                                  |
| Acceptance-record contract test                        | Initial targeted run found malformed #33 rows: an unescaped table delimiter in AC6 and missing cells in AC7/AC11. After correction, the contract test passed 4/4.                                                                                    |
| Same-range refetch failure E2E                         | Red before adding a delayed refetch-failure mock scenario: invalid mock-state error surfaced instead. After the scenario was added, targeted E2E passed 1/1 and verified old cards are hidden while loading and after failure.                       |
| Initial full visual matrix                             | 57/62 passed; the five corrupt-storage recovery captures differed by 919 pixels each after the developer reset option label changed. A separate #33 product reference was added for that dev-only state; #31 and source references were not changed. |
| Pinned visual baseline capture, reset recovery         | PASS; 5/5 new #33 references captured, preserving the prior #31 references.                                                                                                                                                                          |
| Pinned visual baseline capture, API order              | PASS; 5/5 viewports captured.                                                                                                                                                                                                                        |
| Pinned visual baseline capture, new interaction states | PASS; 20/20 viewports captured. The final suite below compares all 25 new references against fresh captures.                                                                                                                                         |

## Final verification

The final visual comparison is preserved at [visual/visual-comparison.json](visual/visual-comparison.json): 62 captures compared, including 30 #33 references, with zero differing pixels.

| Command                                    | Result                                                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| npm run check                              | PASS: OpenAPI lint/type comparison, typecheck, ESLint, and Prettier.                           |
| npm test                                   | PASS: 156/156 tests across 13 files.                                                           |
| npm run test:e2e                           | PASS: 16/16 Playwright tests.                                                                  |
| npm run build:mock                         | PASS.                                                                                          |
| npm run build && npm run check:dist        | PASS: API distribution has 96 files and excludes mock fixtures, dev reset UI, and source maps. |
| npm run check:reference                    | PASS: 11/11 source/reference files match.                                                      |
| Pinned Chromium/font `npm run test:visual` | PASS: 62/62 comparisons, zero differing pixels; see visual/ and visual-state-baselines/.       |

## #8 case trace

The 17 handover cases from #8 are recorded here so excluded work is visible and not reported as a pass.

| #   | #8 case                                                          | Issue #33 applicability, owner, and outcome                                                                                                                                                               |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Same URL registered as two apps by one member                    | PASS: duplicate-pages E2E retains distinct IDs with repeated URLs; the final page contributes four distinct cards.                                                                                        |
| 2   | Name trim-only edit versus prompt trailing-space edit            | Not in scope: registration/edit dirty comparison belongs to the later app-write flow. No #33 result claimed.                                                                                              |
| 3   | Name/stack newlines versus prompt newline normalization          | Not in scope: app input validation/storage belongs to registration/edit. No #33 result claimed.                                                                                                           |
| 4   | Search text of 51 sharp-s characters                             | PASS: unit/E2E coverage confirms the typed value remains visible, folded length over 100 is rejected, and prior cards are hidden.                                                                         |
| 5   | Repeated identical subject parameter                             | PASS: repeated subject keys are rejected and the explicit reset is available.                                                                                                                             |
| 6   | subject=전체, unknown tracking key, malformed percent or UTF-8   | PASS: invalid query conditions are reported without silently widening the query.                                                                                                                          |
| 7   | limit=101 and negative, fractional, or exponent-form page values | Partially verifiable locally: service bounds and integer checks are tested, but lexical query parsing belongs to an HTTP server that is not part of this mock-only task. No HTTP parsing pass is claimed. |
| 8   | Valid offset beyond result count                                 | PASS: service/mock tests return an empty page without resetting the valid offset.                                                                                                                         |
| 9   | Delete the last accessible app under a selected subject          | Read-side zero-result behavior is applicable and tested with valid empty conditions; the actual delete/mutation is outside scope and belongs to app-write work.                                           |
| 10  | Offset page contains only previously seen IDs and hasMore        | PASS: duplicate-only pages dedupe by ID, stop automatic loading, and expose Continue; no-progress responses stop paging.                                                                                  |
| 11  | New condition versus additional-page request                     | PASS: refetch hides old cards while pending/failed; next-page failure retains cards already loaded.                                                                                                       |
| 12  | Create a science app while filtered to math, then return         | The app creation and filtered app-write return are out of scope; #33 covers read-only detail/history return. The write-return owner is the later app-write flow.                                          |
| 13  | Write request completes but its response is lost                 | Not in scope: persistence outcome and safe retry belong to app-write contract/implementation.                                                                                                             |
| 14  | Re-login after an unknown write outcome                          | Not in scope: authentication and write-outcome verification have separate owners. No auth return behavior is claimed.                                                                                     |
| 15  | Repeated login failures versus confirmed account switch          | Not in scope: auth/session draft policy belongs to the authentication work.                                                                                                                               |
| 16  | Stale edit cannot fetch latest record                            | Not in scope: edit conflict recovery belongs to app update work.                                                                                                                                          |
| 17  | Clipboard fallback failure or stale copy result                  | Adjacent issue #32 detail-copy behavior; it is not changed or claimed as new #33 behavior.                                                                                                                |

Authentication return_to is separately out of scope because this ticket implements no auth route; its routing owner remains the auth/routing follow-up. The filtered app-write return in case 12 is also explicitly out of scope. Neither exclusion is labeled PASS.

## Open and unverified items

- Real API/backend, database, HTTP lexical parsing, auth/session/cookie security, app writes, and real health checks were not run.
- Hosted CI is pending because this task does not push or open a PR.
- Physical-device review, assistive-technology review, and DomineYH UI/handover acceptance remain human follow-ups.
- Page-number controls, user-selectable sorting, and fuzzy search were not added.
