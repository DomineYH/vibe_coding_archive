# #95 Q17 zero-result EmptyState

Base: `39a227842fb736e57962cff78e30cfe1dc7daa16` (`wayfinder/issue-95`), branch `impl/issue-95`.

## HITL 권장안 채택

**DomineYH 승인(2026-09-30, 권장안 일괄 승인)**, delegated by the implementation request. Contract: [decision](https://github.com/DomineYH/vibe_coding_archive/issues/95#issuecomment-5906455892), [authorization addendum](https://github.com/DomineYH/vibe_coding_archive/issues/95#issuecomment-5906910707).

Recommended test seams: the existing GalleryView public controls/text and the routed gallery in mock and actual API mode. Observe committed conditions, keyboard reset, URL/history, focus and rendered first-page cards; control time/network only at browser boundaries. Adopted under the user's delegated HITL instruction.

Recommended UI-D03/UI-D09 change ID **Q17-95**: keep the existing zero-result title/description; add all three applied condition values and the existing native button style within EmptyState. Permit their height and wrapping differences only. No new scroll policy. Keep text fully readable, including long unbroken queries. Reset all conditions and draft input, cancel pending debounce/composition, replace the gallery query, focus search and restart the default list at offset 0 without accumulated pages.

The baseline recommendation is limited to these five **new product baselines**:

- `visual-state-baselines/gallery-empty-1440x1000.png`
- `visual-state-baselines/gallery-empty-1024x900.png`
- `visual-state-baselines/gallery-empty-768x1024.png`
- `visual-state-baselines/gallery-empty-390x844.png`
- `visual-state-baselines/gallery-empty-360x844.png`

The original `basic-design-runtime-20260922/reference/<viewport>/03-gallery-empty.png` files remain preserved, as do all other baselines. Normal visual runs read the new product baselines and never regenerate them. Pixel tolerance remains 0. This implementation recommendation supersedes the earlier decision-only session's recommendation of no baseline updates. Approval is delegated adoption, not a claim of direct human/device/screen-reader inspection.

## Verification

The shared implementation and all 18 new cases in each mode pass after targeted rechecks; the existing mock gallery cases pass 16/16. Five viewports × Enter/Space pass in mock and actual API mode. The pinned visual run passes 122/122; all 57 pixel comparisons report 0 differing pixels (46 full, 11 unchanged existing region comparisons). Of those, 5 compare approved new gallery-empty baselines and 52 retain their existing baselines. The suite also retains 25 product-only captures; a passing capture is not a claim of full-image equality for states with existing region comparison policy. See [comparison JSONs](visual/comparisons/) and [hash/scope summary](verification-summary.json). #95 stays OPEN until PR merge. No push, PR or deployment was performed.

## Environment and first failures

- Node `22.23.2`, npm `12.0.2`; `npm ci` completed (349 packages, 0 vulnerabilities). Lockfile unchanged.
- The initial mounted-filesystem Vitest fork and threads workers timed out before executing tests. Tests use a task-owned `/tmp/impl95-fast/node_modules` copy; the installed package metadata SHA-256 is `cc1fe30823bc386b4d324939025a5b3845ba387d73825512ef299c31a2cc1479`, identical to the fresh installation and the reused temporary dependency source. Package-lock SHA-256: `a144ceeb246e3a37aab67fec9912b0a95107b0b9c7dbb17b3c8fe1a93478c087`.
- An initial temporary dependency folder under the Vite root caused file-watcher load: our API-mode HTTP root timed out at 5 seconds; moving it beneath an ignored `node_modules` directory restored HTTP 200 in 0.24 seconds. API navigation and visual beforeAll timeouts are environment failures, separate from the actual TDD failures. No Vite configuration change.
- Browser execution is serialized with the user-specified `flock` lock and checks localhost/127.0.0.1 ports 5173/5174/8000 before every run. Other processes are never terminated. Playwright owns/cleans its web servers; API runner owns a migrated temporary SQLite database and deletes it on exit. The default-zero API fixture hides and restores only that test database's synthetic public rows, with an explicit environment/path guard.
- Visual browser: Chrome for Testing `151.0.7922.34`; pinned fontconfig and Noto Sans CJK JP SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`. Functional E2E uses the installed Playwright Chromium. External browser requests are blocked in the shared new E2E tests.

## TDD and measured source difference

1. Applied-condition test RED (missing condition text), then GREEN. The UI names the committed query, including while draft/debounce or composition input differs.
2. Native keyboard reset tests RED (search did not regain focus), then GREEN for pending debounce and IME. The entire GalleryView test file passed 17/17.
3. Actual API cache test RED (reset rendered 30 accumulated cards, expected first-page 24), then GREEN: default query reset triggers one `offset=0` request and retains the original first-page IDs. The API test runner now forwards test selectors so this boundary can be rechecked without repeatedly running the entire API suite.
4. Before product captures passed 5/5 against the preserved references at 0px. After captures intentionally failed the old comparison in exactly the five approved `gallery-empty` cases. [Before](visual/before/), [after](visual/after/), full and component captures plus [measured source differences](source-differences.json) retain that evidence.

Agent capture review adopted under **HITL 권장안 채택 — DomineYH 승인(2026-09-30, 권장안 일괄 승인)**: condition/button and resulting card height/wrapping only. The empty card gains 89.125 CSS pixels and the footer moves 89 raster rows; aligned footer content is 0px different at all five sizes. The header/intro/filter region is 0px different at four sizes. At 1024×900, the taller full-page capture crosses the viewport height and the unchanged backdrop surfaces rerasterize: 20,272 pixels differ in the header/filter area. This is explicitly retained as the height-related capture difference in the scoped five-product-baseline recommendation; no product header/filter source changed, no reference was replaced, and it does not authorize any other baseline or tolerance change.

The five reviewed after captures were manually copied to `visual-state-baselines/`; `VISUAL_BASELINE_CAPTURE=0` is used for normal verification. The new product baseline path is distinct from the preserved source path. `compare-evidence.py` is an evidence-only region/crop tool requiring Pillow; it never writes a baseline or changes a comparator threshold.

## Commands and results

All browser commands below are prefixed with `flock /tmp/claude-1000/-mnt-c-dev-vibe-coding-archive/f8bf8397-dea2-4b0b-ac26-c2b6e5aea7f6/scratchpad/playwright.lock bash /tmp/claude-1000/-mnt-c-dev-vibe-coding-archive/f8bf8397-dea2-4b0b-ac26-c2b6e5aea7f6/scratchpad/check-ports95.sh`, which checks the fixed ports before launching. Run from `frontend`; common environment is `CI=true FONTCONFIG_FILE="$PWD/visual/fontconfig.conf"`; API also uses `UV_PROJECT_ENVIRONMENT=/tmp/impl95-backend-venv`. Visual verification adds `VISUAL_BASELINE_CAPTURE=0 PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell`.

| Command after prefix/environment | Result / evidence |
| --- | --- |
| `npm test -- --pool=threads --maxWorkers=2 tests/gallery-view.test.jsx` | [17/17 targeted unit tests](logs/unit-gallery-green.log); applied text, pending draft reset and composition reset. |
| `npm test -- --pool=threads --maxWorkers=2` | [799/799, 29 files](logs/unit-final.log), full unit suite once at implementation end as required by implement; shared gallery route impact evaluated. |
| `npm run test:e2e -- e2e/gallery.spec.js e2e/gallery-zero-result.spec.js` | [31 passed, 3 initial failures](logs/mock-gallery.log). All 16 existing gallery cases and 15 new cases passed; the three remaining cases were rechecked below. |
| `npm run test:e2e -- e2e/gallery-zero-result.spec.js --grep 'accumulated\|history entry\|late prior'` | [History/debounce/IME and late-response cases pass](logs/mock-boundaries-final.log). A transient incorrect condition expectation was inserted into the cache test while this runner loaded it; corrected and rechecked separately. |
| `npm run test:e2e -- e2e/gallery-zero-result.spec.js --grep accumulated` | [1/1 cache boundary](logs/mock-cache-final.log); 24 first-page cards replace 28 accumulated cards. Mock distinct final coverage: 34/34. |
| `npm run test:e2e:api -- gallery-zero-result.spec.js` | [16 passed, 2 initial failures](logs/api-zero-result.log); includes all 10 keyboard/viewport cases. History fake-clock sequencing and an ambiguous status locator were test-control failures, corrected below. |
| `npm run test:e2e:api -- gallery-zero-result.spec.js --grep 'history entry\|late prior'` | [Late response passes](logs/api-boundaries-recheck.log); history exposed premature observation of the prior empty state. |
| `npm run test:e2e:api -- gallery-zero-result.spec.js --grep 'history entry'` | [1/1 final history/debounce/IME](logs/api-history-applied-final.log), explicitly waits for the committed condition before advancing the controlled clock. API distinct new coverage: 18/18. |
| `npm run test:e2e:api -- gallery-query.spec.js gallery-paging.spec.js gallery-ime.spec.js gallery-refetch.spec.js gallery-races.spec.js` | [13/13 PASS](logs/api-gallery-regression.log): IME, malformed/overflow query, positive/combined filters, disappearing facets, paging failures, stale responses and keyboard refetch. API distinct affected coverage: 31/31. |
| `npm run test:visual` | [122/122](logs/visual-final.log), capture OFF, 0px threshold, only the five scoped baseline paths redirected. Existing dimension/region policies unchanged. |
| `npm run check` | [PASS](logs/frontend-check.log): typecheck, ESLint, Prettier, OpenAPI lint/generated contract. Two pre-existing OpenAPI lint warnings remain. After final browser-test timing changes, targeted ESLint and Prettier checks also pass. |
| `npm run build:mock`; `npm run build` | [Mock build](logs/build-mock.log) and [API build](logs/build-api.log) PASS; existing API chunk-size warning. |
| `npm run check:dist`; `npm run check:reference` | [PASS dist](logs/dist-final.log): 96 files, excluded private/mock assets absent; [PASS references](logs/reference-final.log): all 11 original/copy hashes verified. |

Initial failing attempts are retained under [logs](logs/); committed copies normalize trailing whitespace only, while raw logs remain in the task scratch directory. Fake-timer userEvent setup, paused browser query notifications, observing an older already-empty condition, and the API header's second status region are explicitly test-fixture/control failures, not additional product regressions. Genuine TDD failures and fixes are identified above. No entire browser suite was repeatedly run; only failed boundaries were rechecked, with one complete pinned visual run.

## Review and limits

[Two-axis code-review](code-review.md) reports Standards 0 / Spec 0 against the fixed base. Automated browser, keyboard and visual evidence and delegated UI-D approval are complete locally. Screen-reader, physical-device, cross-browser and hosted-CI checks were not performed; they are not claimed as accepted. Existing project-wide pending acceptance remains unchanged.

Existing API regression helpers write captures into #82 history paths. Those 40 test-generated tracked images were archived only in the task scratch directory and restored to their original committed bytes; no historical evidence is included in the implementation diff. Fresh `npm ci` dependencies are restored as a normal local `frontend/node_modules` directory after verification.

[Completion and measured-difference approval record](https://github.com/DomineYH/vibe_coding_archive/issues/95#issuecomment-5909993510).
