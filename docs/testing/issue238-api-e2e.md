# #238 bounded API E2E verification — I1 revision 1

2026-10-13. Four spec changes retain the three pre-existing corrections and make HTTP/DOM completion explicit. Product code, fixture sources, dependencies, runtime pins and CI are unchanged. The approved classification exception and test-first decision were used; no new routing calls, delegation, commit, push, PR or issue mutation occurred. This report does **not** accept or close #238.

## Runtime and source

Node **22.23.2**, npm **12.0.2**, Python **3.12.3**, uv **0.11.28**, Playwright **1.63.0**, Chrome headless-shell **151.0.7922.34**. The official Node archive was checked against `SHASUMS256.txt`; Node/npm were installed only under `/tmp/issue238-current/toolchain`. Existing dependencies were reused. Historical Node24/npm12.2 results do not count here.

Base HEAD: `97035fcb3ae95c1c6207e4c7a6253539699bdd5e`, plus the existing apps/detail readiness and delete completion corrections. Pristine baseline specs are exact `git show HEAD:frontend/e2e-api/<spec>` copies. The initial four-spec SHA256 manifest digest is `7404db9d411dfd46f979c7a74278461a570636d203807e2854544f6fb405467f`; snapshots and the pre-existing diff are retained locally.

Final SHA256 values, under `frontend/e2e-api/`:

| Spec                               | SHA256                                                             |
| ---------------------------------- | ------------------------------------------------------------------ |
| apps.spec.js                       | `372d3131d02f52adf39284d82f6b9b77b0c4aeadb397732ecce946581fdb5083` |
| detail.spec.js                     | `afaa47edd4564f42d10901ab542fd98432685db0195f52009c1ab886c1e6c50b` |
| admin-user-delete-recovery.spec.js | `c89162276ca19eebce2f941fe681263045b87f39d913fa31f89427415e370508` |
| health-real.spec.js                | `8e309c810a8a4cb37fb427abc7179a4356bdb90b4845e660b48408047d11a066` |

The disposable mirror copies repository product/runner source unchanged; only its Vite allow-list admits the existing node_modules symlink. All runs use the existing isolated runner, private SQLite databases, synthetic prepared authentication, and the owned controlled worker for health. No application `.env` was sourced for backend settings. Workers=1, retries=0; existing 30s gallery/detail, 90s deletion and 120s health budgets remain unchanged.

Warm runs explicitly use anonymous-gallery/card-count/font readiness in a disposable globalSetup, with no authentication writes. Unpreheated runs use the original runner and repository source/server directories; specs stay mirrored solely to keep generated captures under `/tmp`. Existing Vite dependency caches are reused. The mirror and original repository filesystem conditions differ. Trace-on/off and cold/warm counts are conditional, **not a like-for-like causal improvement claim**. Playwright's installed default is trace-off; the ordinary CI API command does not add tracing. No warmup was added to the production runner.

## Changes and red/green evidence

- **Gallery:** reuse the positive accessible-name readiness wait after the new document. Add exact detail GET200 and restored first-page card count24; retain heading, reload, filters, pagination, request checks and captures. Pristine baseline reproduces the original heading failure: card click precedes renewed auth observations, with **0 target detail GETs**. A held real auth response reproduces the same heading failure; releasing through readiness permits detail GET200 and the original scenario.
- **Late detail:** reuse readiness before first entry and after history return; require the held real first detail response200. Auth-held original control times out awaiting a first request that never occurs. The readiness control drives the actual held first request, second-app navigation and late release, preserving the second app's heading. Neither missing requests nor permission errors count as success.
- **Delete:** reuse expiry+idle before refresh and exact target GET200+UI idle after it. Add issuance/submitted-key equality, original-key lookup410/`OPERATION_EXPIRED`, and the unknown-history assertion. All8 pristine repeats observe automatic lookup200/unresolved then manual lookup410, but finish final assertions before any refreshed target GET appears. A controlled real target response lets the original final assertions pass while busy; its completion assertion goes red (`targetComplete=false`). The completion-wait control goes green. Original key, issuance count1, expired/unknown history and forbidden-action assertions remain. The historical CI expiry-notice disappearance is **not reproduced or declared fixed**.
- **Health:** wait for first24 rows and observed offset0 reads to settle; verify offset24 response200 contains the target, then its DOM row. Retain completed/blocked result, list refresh, detail reload, result reuse and no-new-job checks. All8 pristine repeats show one initial request cancellation, then successful offset0/24 responses and DOM/job completion. Held actual responses show zero pending initial HTTP reads at the normal additional-page click and target membership before DOM delivery. Completed-job invalidation subsequently refetches offsets0/24. Cancellation alone is not a defect; the original CI missing-row signature and overlapping-refetch hypothesis remain unreproduced. Both original-path and final-path read-only query-state probes pass and record `fetchStatus=idle`, `isFetching=false`, one loaded page and zero pending initial HTTP reads at the actual capture-phase click (`controls-query-original`, `controls-query-state`). Neither reproduces a click during a refetch.

Original CI assertions/locations are those in #238's authoritative Agent Brief: gallery heading, late-detail30s timeout, health target-row visibility before its POST, and deletion final expiry text. Historical logs remain in `/tmp/issue238/ci-all-target-failures.txt`; their old runtime/source conditions are not reused as current pass evidence.

## Verification results

Every target below executed at least8 before and8 after, workers1/retries0, target skips0. Counts are pass/fail/skip.

| Target                    | Pristine baseline | Final verification | Final condition/artifact                     |
| ------------------------- | ----------------- | ------------------ | -------------------------------------------- |
| Gallery                   | 5/3/0             | 8/0/0              | warm, trace-off; `candidate-gallery-default` |
| Late detail               | 8/0/0             | 8/0/0              | warm, trace-on; `candidate-targets`          |
| Expired deletion recovery | 8/0/0             | 8/0/0              | warm, trace-on; `candidate-targets`          |
| Blocked health result     | 8/0/0             | 8/0/0              | warm, trace-on; `candidate-health`           |

The **traced** candidate gallery remains7/8: one32.4s budget failure after15 captures totaling16.3s, around entry to readiness. The combined runner exited1 after23 pass/1 fail and never started health; the standalone health8 run supplies that missing verification. These failures are retained, not replaced by trace-off results.

Controls: auth-held originals2 expected failures/readiness variants2 passes; held-target original1 expected completion failure/wait variant1 pass; initial/additional-page response-order control1 pass; original/final query-state controls2 passes. All four final-source controls passed once. The later normal-only artifact-recovery control run passed2 and failed gallery during captures before reaching auth. Initial final-control normal traces were overwritten when the unchanged runner started its health phase in the same output directory; its log preserves all4 passes, while earlier controls and final target traces remain. No such overwrite affected the23/24 candidate matrix because it stopped before health.

| Related group                                              | Pass/fail/skip | Condition                                                                |
| ---------------------------------------------------------- | -------------- | ------------------------------------------------------------------------ |
| Prepared gallery/detail,9 selected cases                   | 9/0/0          | warm, trace-off; unavailable-only case omitted for prepared mode         |
| Same group with tracing                                    | 8/1/0          | gallery capture budget failure after successful detail navigation        |
| Full deletion recovery group                               | 8/0/0          | warm, trace-on; includes retry, reauth, logout and other-account history |
| Admin default/additional-page and insert/delete pagination | 2/0/0          | warm, trace-on                                                           |
| Full controlled-health group                               | 5/1/0          | unchanged disable/re-enable case fails replacement-worker readiness      |

The adjacent health failure is `health-real.spec.js:421`: `SELECT ready FROM health_worker` stays `[[0]]` instead of `[[1]]` during the unchanged10s restart poll. The blocked-result target passes in that group. This is distinct from #238's missing target row; its root cause is unconfirmed and no unrelated repair was made. Owned-fixture cleanup reports zero surviving rows.

Unpreheated original-runner checks, one attempt each:

| Target/mode           | Pass/fail/skip | Observed boundary                                       |
| --------------------- | -------------- | ------------------------------------------------------- |
| Gallery, trace-on     | 0/1/0          | initial `page.goto('/')` exceeds30s; no API request yet |
| Late detail, trace-on | 0/1/0          | login-document load in beforeEach exceeds30s            |
| Delete, trace-on      | 1/0/0          | full completion/history contract passes,42.6s           |
| Health, trace-on      | 1/0/0          | full blocked/reload/reuse contract passes,43.1s         |
| Gallery, trace-off    | 0/1/0          | initial card count remains0 when the30s budget expires  |

The traced cold gallery observes HTML200 taking10.2s and `src/main.jsx`200 taking11.7s, before any API request. This separates initialization from the readiness boundary; it does not establish the cause of the slow resource responses. Cold/diagnostic gallery stability is **not established**, and tracing alone is **not proven** to cause the budget failures.

Changed-file ESLint, Prettier, frontend `npm run typecheck`, scoped `git diff --check`, mirror/final-spec equality and product/runner/config hash checks pass. Full unrelated suites were not run because no shared code/schema/config changed. Full-workspace diff-check still sees pre-existing AGENTS.md trailing whitespace, which was preserved.

## Commands and retained artifacts

All local artifacts are under `/tmp/issue238-current`. `run.sh` uses a cleared environment, pinned PATH, the explicitly prepared R15 blocklist and pinned browser; it invokes `npm run test:e2e:api` with workers1/retries0/trace-on and an output directory named by the label. `controls-*`, `candidate-*` and `groups-*` labels add the disposable warm config. `run-default.sh` uses the same environment with trace-off; its callers explicitly select warm or original-runner config.

Representative exact invocations (`R=/tmp/issue238-current`, `M=$R/mirror`):

```bash
$R/run.sh "$M" baseline-gallery e2e-api/apps.spec.js e2e-api/detail.spec.js --grep 'public API gallery filters|ignores a late detail' --repeat-each=8
$R/run.sh "$M" baseline-delete e2e-api/admin-user-delete-recovery.spec.js --grep 'expired lookup and target refresh' --repeat-each=8
$R/run.sh "$M" baseline-health e2e-api/health-real.spec.js --grep 'administrator blocked result' --repeat-each=8
$R/run.sh "$M" candidate-targets e2e-api/apps.spec.js e2e-api/detail.spec.js e2e-api/admin-user-delete-recovery.spec.js e2e-api/health-real.spec.js --grep 'public API gallery filters|ignores a late detail|expired lookup and target refresh|administrator blocked result' --repeat-each=8
$R/run-default.sh "$M" candidate-gallery-default e2e-api/apps.spec.js --grep 'public API gallery filters' --repeat-each=8 --config=playwright.issue238.api.config.js
$R/run.sh "$M" candidate-health e2e-api/health-real.spec.js --grep 'administrator blocked result' --repeat-each=8
$R/run.sh "$M" controls-query-original e2e-api/issue238-query-original-health-real.spec.js --grep 'administrator blocked result'
$R/run-default.sh "$M" groups-gallery-default e2e-api/apps.spec.js e2e-api/detail.spec.js --grep-invert 'unavailable auth preserves' --config=playwright.issue238.api.config.js
$R/run.sh /mnt/c/dev/vibe_coding_archive cold-gallery e2e-api/apps.spec.js --grep 'public API gallery filters' --config="$R/original-runner.config.mjs"
$R/run-default.sh /mnt/c/dev/vibe_coding_archive cold-gallery-default e2e-api/apps.spec.js --grep 'public API gallery filters' --config="$R/original-runner.config.mjs"
```

Complete actual control/group/cold/static commands and exit records are in `baseline-rest.sh`, `final-runs.sh`, `remaining-runs.sh`, `default-and-health-runs.sh`, `default-related-runs.sh`, `query-state-run.sh`, their matching `.log`/`.exit` files and `results-summary.json`. Static commands ran from `frontend`: `node_modules/.bin/eslint` and `node_modules/.bin/prettier --check` on the four affected specs, then `npm run typecheck`. No live shell wrapper was edited after the coordinator's capacity-resume instruction; the existing candidate process/result was reused.

Evidence: `snapshots/`, `final-spec-hashes.txt`, `control-hashes.txt`, `final-control-hashes.txt`, `implementation.diff` (four-spec diff from HEAD), `new-work.diff` (new work against preserved starting specs), `*-results/*/trace.zip`, `*-results-sanitized.json`, `cold-gallery-initialization-network.json` and mirror captures. Raw auth-bearing traces remain local; summaries contain sanitized network paths/status/timings only.

Excluded procedural artifacts: the first mirror setup attempt was interrupted after correcting a duplicate disposable Vite allow-list key. Editing the disposable wrapper while baseline deletion was running caused a trailing shell exit127 **after** the runner's8/8 pass; both counts and wrapper failure are recorded. Neither is an original application failure, and neither is hidden as a successful shell exit.

Remaining uncertainty: historical health/deletion CI causes, unpreheated initialization and traced gallery budgets, and the adjacent worker-restart failure. No product fix or whole-issue stability claim follows from these conditional passes.

Independent review R1 (2026-10-13, GLM-5.3/max) passed the bounded test changes after checking connected code, source integrity and actual logs. The coordinator verified the unchanged four-spec hashes and scoped diff check. Full #238 acceptance remains open because the historical health/deletion causes and documented cold/adjacent failures are unresolved. The review report is retained locally at `/tmp/issue238-current/review-report.txt`; no issue closure, publication or deployment was performed.

## PR242 repair I2 / verification VP2 candidate

2026-10-13. Base HEAD `5954daa2c8ff94bf1e1141804f2d43c11261631b`. This feature-local repair addresses the proven invalidation-during-pagination defect. It does not establish which event initiated the historical CI failure, accept #238/PR242, or replace mandatory GitHub CI. Product and test files were frozen for independent review after the final 90-test/static/build candidate. No delegation, commit, push, GitHub mutation, deployment, shared auth/query configuration, schema or dependency-pin changes occurred. Existing user files and committed PR fixes were preserved.

### Repair and regression evidence

A private `refreshAdminApps` helper is used by batch dashboard refresh, health-expiry refresh, and row-check completion/result reuse. It waits for an active apps read before invalidating with `cancelRefetch:false`; cancellation stops the deferred refresh, and query identity prevents refreshing a replaced scope. Idle refresh still starts immediately. Existing scope keys, read ownership and `retireApps` cancellation/removal are unchanged. CRUD invalidation is unchanged.

The real AdminView/service-boundary regression was written before the repair. `regression-red.log` records an aborted offset24 read; `regression-dom-red.log` records the missing target row after releasing its target-bearing response. The final regression was also run against exact `git show HEAD` copies of both original components: `final-test-baseline-red.log`, exit1, missing `모니터 앱 25`. D1 records the corresponding cache loss: `request24 → abort24 → request0 → late response24-target`, page parameters `[0]`, target absent. This is a controlled local reproduction, not historical HTTPS causation proof.

The single row-result regression first went green in `regression-green.log`, exit0. Final affected verification is `affected-final.log`, exit0: **5 files, 90 passed, 0 failed, 0 skipped**. It covers the real three background producers, target-row append plus eventual existing-row health freshness, idle paging, refresh-before-click, rejected paging/refetch and recovery, and pending-refresh retirement after identity/activity/capability changes. Existing admin view, apps isolation, delete and health-control contracts also pass; pre-existing assertions were retained, with the row-control invalidation expectation updated for the helper's explicit options.

A disposable control using only non-cancelling invalidation fails (`noncancel-only-final-red.log`, exit1): offset24 survives and its row appears, but no subsequent offset0 read starts (`2` reads instead of at least `3`). The final component probe passes (`final-dom-order-complete.log`, exit0): `request0 → request24 → background refresh (not aborted) → response24-target → request0 → request24`, cache page parameters `[0,24]`, target present and existing row updated to the blocked result. Neither the controlled probe nor the query-only D1 loop substitutes for native HTTPS.

### Candidate checks and provenance

Changed-file ESLint, Prettier, frontend typecheck and scoped diff check exit0 (`eslint`, `prettier`, `typecheck`, `diff-check` logs/exit files). The final-helper API production build and `check:dist` pass in the native attempt logs; output contains96 files and excludes mock fixtures/references/source maps. The existing >500kB chunk warning remains. The full unrelated frontend/backend suites were not run.

SHA256 values (paths relative to `frontend/`):

| File                                        | SHA256                                                             |
| ------------------------------------------- | ------------------------------------------------------------------ |
| src/features/admin/refresh-admin-apps.js    | `c695c28213025df1743afbd3173ac3198033bbd8151d172f54886cef684cece8` |
| src/features/admin/view-admin.jsx           | `b38cf732d65b1b371887cfeda26e7f2e41202a712d9c678484d5081680da14cc` |
| src/features/admin/health-check-control.jsx | `cfbe3a2e0240c429b3ccbad0c1ebc0a9eeff3ad01039f9a9b75bcf921e78ac92` |
| tests/admin-view-apps.test.jsx              | `0223ca0072bacb4bd6f456aa39ea08188763b6cd0665430d5a48f6860c2f5776` |
| tests/health-check-control.test.jsx         | `b14ea87706c4b296d0756e73371340ec61629d11d79f0a16edd7e24d07ab6360` |

Node22.23.2/npm12.0.2, Python3.12.3 and the existing Chrome151 executable were used. No warmup was added. The disposable Linux mirror uses the original runner/config/source and isolated databases, workers1/retries0/trace-off. Source/dependency storage and existing caches differ from the Windows-mounted checkout and historical CI; these are unpreheated runner checks, not a pristine cold-cache claim.

`source-manifest.json` verifies all199 selected frontend/source/test/runner/config/contract/deploy files against the repository. `dependency-provenance.json` verifies all350 installed package versions/resolved URLs/integrities and selected React/Query/Vitest/Vite/jsdom bytes. Frontend dependencies were reconstructed offline from the unchanged lockfile after the Windows-filesystem copy was stopped. `backend-source-manifest.json` verifies the unchanged backend copy; `python-dependency-provenance.json` verifies all installed distribution names/versions. The unchanged Python frozen lock was installed under `/tmp` (offline cache miss retained, then frozen downloads succeeded). A preliminary frozen sync checked the original41 packages because the shell retained the old symlink working directory; it reported no package changes. Application `.env` files were not sourced.

### Environment failures and focused matrix

The native checkout Vitest attempt reached startup but timed out90s without executing tests (`native-red.log`, exit124). The Linux regression's initial five-second timeout and incorrect `li` lookup were test-harness failures, retained separately. Intermediate affected/regression runs retain timeout, batch-fixture and overly strict empty-query-object failures in `affected-unit.log`, `producers-green.log`, `regressions-cycle2.log` and `regressions-final.log`. The final fixture serves responses by actual offset and uses focused row lookups; no timeout/retry/sleep masking was added. Retirement asserts that protected cached data and DOM rows disappear; disabled observers can recreate an empty query object.

Official Ubuntu nginx1.28.3/age1.2.1 packages were extracted under `/tmp`, without system installation/services. The package hashes, wrapper and smoke configuration are under `native-tools/`. The unchanged nginx template requires `/etc/nginx/mime.types`; a private bubblewrap mount supplies the extracted distro file and permits owned `/tmp` runtime writes. The binary version and smoke syntax check pass. The real unchanged native harness still fails at nginx startup (diagnostics suppressed), after backend readiness and before test execution. There is no Vite fallback and no native functional pass claim.

The unchanged bootstrap additionally failed in the incomplete Linux mirror before any credential prompt: the verifier requires `docs/research/password-blocklist-provenance/metadata/candidate_sources.json`, which had not been copied. `bootstrap-diagnostic/result.log` records migration0, CLI1, zero prompts and no password echo; `blocker.json` identifies the missing metadata. Copying that existing file unchanged lets bootstrap complete. Initial incomplete-environment matrix failures are retained in `environment-incomplete/` and `matrix.log`. The first incomplete `native-health-target-linux.log` was overwritten on rerun; its exit1 and bootstrap-failure summary remain in the archived exit/matrix log. No executed-test failure or pass was inferred from those setup failures.

Final focused results (the complete-environment attempts use the frozen candidate):

| Check                                                      | Runner exit | Executed pass/fail/skip               | Evidence                         |
| ---------------------------------------------------------- | ----------- | ------------------------------------- | -------------------------------- |
| HTTP blocked-result target,8 repeats                       | 0           | 8/0/0                                 | `api-health-target.log`          |
| HTTP full controlled-health group                          | 0           | 6/0/0                                 | `api-health-group.log`           |
| HTTP admin default/additional and insert/delete pagination | 0           | 2/0/0                                 | `api-admin-pagination.log`       |
| Native HTTPS blocked-result target,8 requested repeats     | 1           | 0 tests executed; environment blocked | `native-health-target-linux.log` |
| Native HTTPS full controlled-health group                  | 1           | 0 tests executed; environment blocked | `native-health-group.log`        |

The HTTP health group includes the unchanged disable/re-enable worker-readiness case that failed in the earlier environment; it now passes under these Linux conditions. This is not a repair or causal claim for that prior failure. Every completed HTTP case reports zero owned fixture leftovers. The native attempts build/check the final API release, reach backend readiness, and then fail nginx startup; they do not satisfy native target repetition or native group verification. Real GitHub CI must supply that VP2 evidence.

### Reproduction commands and artifacts

All artifacts are under `/tmp/issue242-ci`. The test and runner commands use the unchanged mirrored files and the pinned PATH described above:

```bash
cd /tmp/issue242-ci/repair/frontend
VITE_DATA_MODE=mock node node_modules/vitest/vitest.mjs run --maxWorkers=1 tests/admin-view-apps.test.jsx tests/admin-view.test.jsx tests/admin-apps-isolation.test.jsx tests/admin-apps-delete.test.jsx tests/health-check-control.test.jsx
/tmp/issue242-ci/check-static.sh
/tmp/issue242-ci/run-e2e.sh native-health-target-linux --nginx-functional e2e-api/health-real.spec.js --grep 'administrator blocked result' --repeat-each=8
/tmp/issue242-ci/run-e2e.sh native-health-group --nginx-functional e2e-api/health-real.spec.js
/tmp/issue242-ci/run-e2e.sh api-health-target e2e-api/health-real.spec.js --grep 'administrator blocked result' --repeat-each=8
/tmp/issue242-ci/run-e2e.sh api-health-group e2e-api/health-real.spec.js
/tmp/issue242-ci/run-e2e.sh api-admin-pagination e2e-api/admin-apps.spec.js --grep 'default and additional pages|offset paging across inserts'
```

The original failure log and D1 artifacts remain in `failed.log` and `diagnosis/`. Candidate hashes are in `candidate-hashes.txt`; controlled final component ordering is in `final-dom-order-complete.log`; exact original-component red and inadequate-fix red are in `final-test-baseline-red.log` and `noncancel-only-final-red.log`. `matrix-complete-environment.log` collects the completed environment attempts. Auth-bearing browser/runtime artifacts remain local. Wider API/auth regression and the native functional release contracts remain mandatory in real GitHub CI after coordinator review/push.

Independent delta review R2 (GLM-5.3/max) passed the unchanged five source/test hashes. Its real-query supplemental probe confirms that a same-scope refetch superseded by pagination can skip that health-refresh cycle while preserving both pages and last-good rows; this behavior also occurred before the repair. A later refresh producer updates those rows. This report does not guarantee a recovery deadline or that an expiry timer always exists. The review and probe remain local at `/tmp/issue242-ci/review-report.txt` and `review/supersede-freshness.mjs`.
