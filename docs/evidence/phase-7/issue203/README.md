# #203 Phase 7 local integration and release handover

**Release verdict: BLOCKED.** This record can support a local handover review after source-bound executions are attached; it does not approve Phase 7, public deployment, health/auth activation, contact values, or human acceptance. DomineYH owns T10 #193, T11 #194, T12 #204 and T13 #205; [#144 G01–G18](https://github.com/DomineYH/vibe_coding_archive/issues/144) and Q33 remain the original public gates.

The structured companion is [ledger.json](ledger.json). Its 189 required item IDs now cover 326 rows: 32 current CI scoped PASS rows, 281 NOT RUN rows and 13 BLOCKED rows. The four earlier CI failures remain in `ci_history`; 23 earlier local execution records remain in `local_history`, each retaining its actual source, counts, logs and limits. These histories are not current-source acceptance coverage. No skip, collection, command exit alone or successful refusal path approves the release.

## Binding and evidence flow

The active ledger binds source `7be91b0bf93f1dbbb6ba78f4667b769ec1e25adf`, release `phase7-t09-candidate`, and successful [CI run 37942811301, attempt 1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/37942811301/attempts/1). Both jobs succeeded. Final T08 is `f705c69efa5894be7a59f4c4f1d3affc367a8a19`; original implementation and repairs remain in Git history. This phase D commit changes evidence only. The active source binding always names the executable source, not this later documentation commit.

Original d97 FAIL run/row payloads were archived intact into `ci_history` before rebinding; the 8d failures remain there with their own actual source and URLs. No failed result is relabeled as current-source PASS. Local histories distinguish original d97 runs, 8d completion/repair runs, and the 7be repair checks. RED stubs identify their base plus uncommitted state. Wrapper timestamps that include queue holds are labeled separately from test durations.

Current CI bindings distinguish backend/API and frontend Chromium 153.0.8010.12 from pinned visual Chromium 151.0.7922.34. The log records Ubuntu 24.04.5 LTS/image 20261004.327.1, Node 22.23.2, Python 3.12.3 and uv 0.11.28. The successful explicit npm pin installs 12.0.2; setup-node's earlier npm 10.9.8 is not the test-step version. Playwright is 1.63.0 in the source lock. Nginx is 1.24.0 and OpenSSL 3.0.13. The frontend font selection check enforced Noto Sans CJK JP. Local versions and unavailable native tools remain separate.

Full log: `/home/dominelinux/.cache/vibe_coding_archive/coord/impl8/ci-t09-5-full.log`; SHA-256 `e1c100490c217b5f6aa646e74a6c1a283ec2b0db2695c2b118f1cf8f3f81dcc0`. Each CI run record names its job/step, exact command, timestamps, source/lock binding and this log hash. Historical runtime gaps are preserved as gaps.

CI run [37919950902 attempt 1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/37919950902/attempts/1) is **FAIL**: existing API command collected 352, executed 261, passed 260, failed 1, skipped 91 across its reached subruns. The unavailable-mode 91 skips have a separate NOT RUN subset; overlapping counts are not additive. `health-real.spec.js:158` failed its blocked-result reload check (known T07 flake); the new native step did not run. Frontend job succeeded, as relayed by the coordinator.

[Attempt 2](https://github.com/DomineYH/vibe_coding_archive/actions/runs/37919950902/attempts/2) is **FAIL**: existing API command and frontend job succeeded according to the coordinator, but the new native normal subrun collected/executed 48, passed 44, failed 4, skipped 0. Three lost-reply routes used Node fetch without trusting the generated certificate; the missing visible result follows failed fetch. The fourth failure independently classified `__Host-` cookie names using an underscore split. Fixed-clock captures, configured support, restore and controlled worker did not run after that failure. Step logs: `/home/dominelinux/.cache/vibe_coding_archive/coord/impl8/ci-t09-{1,2}.log`.

The repair supplies `NODE_EXTRA_CA_CERTS` with the generated run certificate only to functional HTTPS child processes. Static Nginx and default Vite mode retain their environment behavior; TLS verification stays enabled. Cookie-kind classification removes the HTTPS `__Host-` prefix before applying the existing classifier; all cookie attributes, rotation, expected recovery/session kinds and negative checks remain. Local Nginx is absent; native repair verification passed in CI 37942811301.

Local Node/npm are 24.21.0/12.2.0, differing from CI's configured 22.23.2/12.0.2. Python is 3.12.3, uv 0.11.28, and the pinned local Chrome for Testing is 151.0.7922.34. The configured Playwright version is 1.63.0. Local Nginx/age are unavailable. Local font failures are recorded separately from CI's Noto Sans CJK JP requirement. These differences remain explicit in the current bindings and local histories.

PASS requires nonzero execution, passed = executed = collected, zero failed/skipped, the expected result, and a matching source/lock/release/run/evidence binding. NOT RUN/BLOCKED require a reason and owner. Each skipped case gets its own NOT RUN subset; do not give its parent scope a PASS. Keep the original failed command alongside any targeted retry. Case coverage is deduplicated by case, mode and release; counts for overlapping requirement rows must never be added together.

## Repair 2 CI history

Additional `ci_history` records preserve source `8d1cbec9c9a53b23ede3919f3011d1931be77527` separately from the original d97 candidate rows. They are historical invocation records with source/lock/runtime limitations, not current acceptance coverage or repair-source PASS. The current evidence binding is separate from these historical records.

Run [37932036263 attempt 1](https://github.com/DomineYH/vibe_coding_archive/actions/runs/37932036263/attempts/1) is **FAIL**: existing API subruns collected 257, executed 166, passed 165, failed 1, skipped 91. `admin-apps.spec.js:275` observed 3601000 instead of 3600000, a pre-existing fixture SQL clock flake owned by the original admin-apps/health ticket; T09 does not repair it. Remaining groups and the native step did not run.

[Attempt 2](https://github.com/DomineYH/vibe_coding_archive/actions/runs/37932036263/attempts/2) is **FAIL**: native normal subrun collected/executed 48, passed 46, failed 2, skipped 0. The logout and committed-lost-reply assertions at `auth-login.spec.js:125` and `:233` still parsed `__Host-` names as empty cookie kinds. Existing API passed, and frontend succeeded both attempts, per coordinator relay. Native captures/support/restore/worker did not run after the failure. Original logs: `ci-t09-3.log` and `ci-t09-4.log` in the coordinator evidence directory.

Repair 2 uses one `authCookieKind` helper for all three semantic cookie-kind assertions. The complete API spec/helper sweep found no other kind parser in the functional selection; identity comparisons and HTTPS prefix/Secure checks remain unchanged. Default Vite behavior is verified by the targeted login spec using `/tmp`, as authorized by repair order 2. Native verification passed in CI 37942811301; release remains BLOCKED.

## CI run 37942811301

Both jobs succeeded on `7be91b0`. Counts below are actual selected executions. Overlapping test invocations and requirement rows must not be added to estimate distinct coverage.

| Job / step | Exact command | Observed result |
| --- | --- | --- |
| backend lint | `uv run --frozen ruff check .` | All checks passed; one completed lint check, not a test count |
| backend format | `uv run --frozen ruff format --check .` | 165 files already formatted |
| real age | `APP_ENV=test uv run --frozen pytest -m requires_age tests/test_backup_process.py tests/test_restore_process.py -ra` | 8 selected passed; 37 discovered, 29 deselected outside marker scope |
| full backend | `APP_ENV=test uv run --frozen pytest` | 1,618 passed; zero failed/skipped |
| backend API build | `npm run build && npm run check:dist` | Build passed, 1,653 modules; 96 artifact files checked |
| static HTTPS | `npm run test:e2e:api -- --nginx e2e-api/static-serving.spec.js` | 9 passed |
| safe logging/retention | `APP_ENV=test uv run --frozen pytest tests/test_safe_logging.py tests/test_purge_expired.py -ra` | 50 passed; overlaps full pytest |
| full Vite API | `npm run test:e2e:api` | 353 raw collected, 262 executed/passed, zero failed, 91 skipped NOT RUN |
| service/migration/worker | `systemd-analyze --version`, then `APP_ENV=test uv run --frozen pytest tests/test_service_units.py tests/test_migration_lifecycle.py tests/test_health_worker_process.py -ra` | 34 passed; overlaps full pytest |
| functional HTTPS | `npm run test:e2e:api -- --nginx-functional` | 74 passed across five subruns; zero failed/skipped |
| frontend checks | `npm run check` | Five configured checks completed; existing OpenAPI warnings retained |
| frontend Vitest | `npm test` | 1,673 tests in 52 files passed |
| mock browser | `npm run test:e2e` | 128 passed |
| mock build | `npm run build:mock` | Build passed; 1,654 modules |
| frontend API build/dist | `npm run build && npm run check:dist` | Build passed; 1,653 modules and 96 checked files |
| reference preservation | `npm run check:reference` | 11 original/copy pairs match SHA-256 and byte counts |
| visual, all six files | `npm run test:visual` with step `FONTCONFIG_FILE` | 146 passed on pinned Chromium 151; zero failed/did-not-run |

The full API command's subruns are 54 + 1 + 1 + 110 + 20 + 1 + 1 + 1 + 1 + 46 + 20 + 5 + 1 = 262 passed: unavailable, configured support prepared/unavailable, prepared moving clock/fixed-clock cards, four candidate modes, fault moving clock/fixed-clock captures, controlled health and empty archive. The first invocation collected 145 and skipped 91; its executed PASS row covers only 54. The 91 named skipped cases have a separate NOT RUN row. Later prepared execution does not erase those skips.

Native functional subruns are normal 48, fixed-clock cards 15, configured support 1, process recovery/restore 5 and controlled health 5 = 74 passed. Login's five viewport states run in the moving-clock normal group; fixed-clock cards cover registration, approval and private access. `SUPPORT-production` and `HTTPS-support` reference the same one invocation, not two distinct cases. Restored-process refusal checks and controlled test workers do not prove actual-host operation or real activation.

Lint/build/check counts explicitly name their units: a completed check/build, formatted or checked files, or original/copy comparisons. Transformed modules and Vitest files are measurements, not fabricated test counts. All automated CI values remain separate from human/host acceptance.

## Local results retained

These original outcomes remain unchanged and source-bound in `local_history`, with full logs and timestamp/exit sidecars under `logs-t09`. The coordinator [implementation report](/home/dominelinux/.cache/vibe_coding_archive/coord/impl8/report-impl-t09.md) retains all development RED/GREEN records, exact completion commands and failure routing.

| Source | Local scope | Original result |
| --- | --- | --- |
| d97a284 | lint / format / frontend checks | Passed; 165 formatted files and five frontend checks |
| d97a284 | full pytest | FAIL: 1,602 passed, five health deadline failures, 11 age skips; 1,618 collected |
| d97a284 | full Vitest | FAIL: 1,512 tests passed in 48 files, four worker-start errors; four files uncollected NOT RUN |
| d97a284 | mock E2E | FAIL: 125 passed, three failed / 128 |
| d97a284 | first full API invocation | FAIL: 51 passed, three failed, 91 skipped / 145; remaining original command groups did not run |
| d97a284 | prepared normal completion | FAIL: 106 passed, four failed / 110; fixed-clock capture group did not run |
| d97a284 | support / candidate completion | Two support and four candidate raw invocations passed |
| d97a284 | full visual | FAIL: 36 passed, 22 failed, 88 did-not-run / 146; all 16 historical font failure titles plus six additional failures retained |
| d97a284 | mock/API build, dist, reference | Passed: 1,654/1,653 modules, 96 artifact files, 11 original/copy pairs |
| 8d1cbec | local fault completion | FAIL before collection: 114-byte Unix socket path, listen EINVAL; zero tests executed, selected cases NOT RUN |
| 8d1cbec | controlled health / empty archive | Five plus one passed |
| repair 1 | RED / GREEN | Actual RED assertion failed; GREEN 53 passed. RED identifies its uncommitted stub/base |
| repair 2 / 7be91b0 | RED / GREEN / Vite login | Actual RED assertion failed; GREEN 54 passed; requested Vite login 13 passed using `/tmp` |

Local original heavy-suite overlap and font allowlist limitations are retained; successful CI does not erase them. The 11 age skips, four unstarted Vitest files, 88 visual cases and unstarted local capture/fault groups remain NOT RUN for those invocations. Local Nginx/age are unavailable. Human 70 state/viewport procedures, actual-host eight groups and real operator values/notice remain NOT RUN/BLOCKED.

## Complete required crosswalk

Every ID below has its own ledger item and actual test-case references or an explicit human/host procedure. The source descriptions and case names in the JSON are the crosswalk, not inferred suite-wide approval.

| Set | Required IDs | Source and limits |
| --- | --- | --- |
| Phase 7 pass conditions | P7-01, P7-02, P7-03, P7-04, P7-05, P7-06, P7-07 | PRD §12 Phase 7: restart, deep routes, restore, bundle exclusions, privacy, integrations, UI judgment; local and host/human rows separate |
| §13.1 complete table | T-UI-01, T-UI-02, T-UI-03, T-AUTH-01, T-AUTH-02, T-AUTH-03, T-ACL-01, T-ACL-02, T-APP-01, T-APP-02, T-ADMIN-01, T-HEALTH-01, T-HEALTH-02, T-HEALTH-03, T-DATA-01, T-OPS-01 | All 16 PRD rows, mapped to named current pytest/browser/visual cases |
| §13.2 complete prose | PERF-01 through PERF-12 | 1,000 members/5,000 apps; 2vCPU/4GB; 50 readers; p95 500ms; environment/DB/query/sample report; 5min warm-up + 10min ×3 (#192); paged reads/no eager probes/needed polling; separate hashing/write load; tuning and separate DB decision. Host capacity NOT RUN → #204 |
| §13.3 complete prose | PRIVACY-01 through PRIVACY-19 | Purpose/retention/access/notice/non-disadvantage/legal limits; safe request logs and exclusions; DB/storage/backup protection; SQLite not automatically encrypted; audit/backup expiry/redeletion/no immediate erasure promise. #9/#16: request7d, ordinary audit90d, legal access≥1yr, backup cleanup29d/max30d, ledger copy-expiry+7d. Actual classification/notice remains BLOCKED → #194 |
| §13.4 complete prose | DEPLOY-01 through DEPLOY-17 | HTTPS/same-origin/CORS exception; static exclusions and API/asset non-HTML; daily/pre-migration consistent backup; RPO24h/RTO48h (#16/#192 replaces PRD4h); isolated integrity/FK/session invalidation/redeletion; disk/locks/worker/backup observations. Actual copies/authority/supervision/RPO/RTO NOT RUN → #193/#204 |
| Current UI deviations | UI-D01 through UI-D09 | docs/ui-deviations.md and #49 crosswalk; current states at all five widths; no blanket approval inherited from #95/#105. Human current-build judgment NOT RUN → #205 |
| Authentication event order | R23-01 through R23-29 | [#23 resolution §8](https://github.com/DomineYH/vibe_coding_archive/issues/23#issuecomment-5806449465), #49 crosswalk and #121 current-case inventory. Real BFCache, natural cookie eviction and missing Fetch/device primitives retain explicit host NOT RUN rows |
| Administrator event order | R24-01 through R24-29 | [#24 resolution §9/Q16](https://github.com/DomineYH/vibe_coding_archive/issues/24#issuecomment-5806786959), mapped to current approval/reset/delete/race/process tests. Earlier mock evidence cannot approve real API work |
| Phase 6 host groups | HOST-egress_dns_tls, HOST-http_headers_deadline, HOST-resource_cleanup_concurrency, HOST-supervisor_single_worker, HOST-clock_suspend, HOST-database_fencing_recovery, HOST-api_batch_retention, HOST-disable_reenable | health-checks.md activation-before-host-validation and phase-6/verification.md. All eight actual-host rows NOT RUN → #204; controlled worker counts are separate |
| Original public gates | G01-G18 | One pointer item names G01 through G18 and links #144. No copied gate checklist or invented approvals |
| #203 criteria and predecessors | AC01 through AC07; T01 through T08 | All issue checkboxes including handover/common verification, and T01–T08 source/test links; final T08 source required in phase D |
| T08 support | SUPPORT-unset, SUPPORT-valid, SUPPORT-invalid, SUPPORT-production, SUPPORT-approval | Synthetic configuration and production-artifact notice/keyboard proof; actual values/notice BLOCKED → #194 |
| Human and automated UI checks | MANUAL-viewports, MANUAL-accessibility, AUTOMATED-accessibility | 14 screen/state groups × five widths; screen reader/device judgment separate. Automated keyboard/label PASS only with actual execution counts |
| Native HTTPS modes | HTTPS-normal, HTTPS-support, HTTPS-restore, HTTPS-health, HTTPS-static, HTTPS-not-selected | Separate native normal/configured support/restore/worker/static evidence and explicit excluded spec rows |
| Final commands | RUN-backend-lint, RUN-backend-format, RUN-backend-pytest, RUN-age, RUN-frontend-check, RUN-vitest, RUN-mock-e2e, RUN-api-e2e, RUN-visual, RUN-build-mock, RUN-build-api, RUN-dist, RUN-reference | Separate local/CI rows; counts come from actual command/job logs |

## Harness scope and proof modes

`npm run test:e2e:api -- --nginx-functional` reuses `prepareNginx()` and the deployment template. It builds/checks/copies the API artifact once, uses HTTPS `https://localhost:8443`, and creates fresh DB plus Nginx runtime/log/PID paths for each invocation. It selects register, approval, login, access, create/edit/delete, administrator reset/delete; configured support runs separately; process recovery/restore uses the existing fault launcher; health uses the controlled test worker. Existing fixed-clock capture separation is retained. The original static `--nginx` mode and full Vite API matrix remain separate.

Amendment 2 proof is mode-specific: default Vite `auth-access` source-module probes remain unchanged; functional HTTPS observes the actual `/auth/csrf` and `/auth/me` contextual HTTP proof, and `/recovery-cookie/rotate` + `/ready` + `/flow-state` continuity through HTTPS. The same full-session, revision-change/identity-continuity, DOM visibility, keyboard exclusion and negative checks remain. No source module is exposed from the production static root.

Browser contexts use the runner origin and the private test certificate; functional-mode Node requests also trust that generated certificate through the child-process environment. HTTPS cookie assertions require the `__Host-` prefix and Secure; HTTP preserves its development cookie expectations. No login flow or rate-limit exemption is added. Existing reset/delete/admin-apps fixture cleanup still owns its rate events. `APP_ENV=test`, isolated paths and `HEALTH_CHECKS_ENABLED=false` are retained; controlled `health_testing` is not real activation.

The additional HTTPS variant excludes the remaining specs, each listed with “not selected in HTTPS variant” in the ledger. They still run in the unchanged full API command. Nginx buffering/production timeouts and all existing spec timeouts/assertions remain unchanged. Functional tests keep their existing 30-second default; static smoke retains its 120-second default. The new CI addition is exactly one backend-api step, with CI=true and HEALTH_CHECKS_ENABLED=false; no upload/reporting pipeline was added.

## Final command inventory

Run all shell commands after sourcing `/home/dominelinux/.cache/vibe_coding_archive/coord/issue121-resume-env.sh`. Heavy commands use `systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=512M`. E2E/visual uses private disk-backed TMPDIR `/home/dominelinux/.cache/vibe_coding_archive/coord/impl8/tmp-t09`; backend pytest retains `/tmp` for its fixtures. Never terminate unowned listeners; wait/retry port conflicts.

The successful CI command inventory and per-subrun counts appear above and in the source-bound ledger. Original local command variants, including `pytest -ra`, `--maxWorkers=1`, local `FONTCONFIG_FILE` and the private TMPDIR, remain in `local_history`; they are not substituted for CI's actual commands. Phase D ran only the requested ledger/acceptance tests and checked that executable source and locks match `7be91b0`. No full-suite retry or new executable was introduced.

The active ledger's local full-suite rows remain NOT RUN for the repaired source where no such local rerun occurred. Historical local logs retain their actual d97/8d/7be identity. Counts for a repeated case/mode across old and current releases are not added. Logs cited in this document exclude raw cookies, CSRF, DB contents, real contact values and activation records.

## Human handover and defect routing

Human five-viewport rows cover gallery, public/private detail, login/signup/support/change-only cards, admin approval/reset/delete/monitor, and app create/edit/delete, including hidden/recheck/long/empty/dirty/error/conflict states. Widths are 1440×1000, 1024×900, 768×1024, 390×844, 360×844. Each procedure checks overflow, long values, empty/long lists, error location/text, focus order/visibility, labels, icon names, non-color status, direct routes and reload. DomineYH performs this and screen-reader/physical-device acceptance under #205. Pinned Chromium screenshots cannot substitute.

Route defects without product edits: serving #196; activation/config #197; backup #195; restore #198; migration/supervisor #199; logs/retention #200; ops/HMAC #201; support #202; prior auth/admin/health to its original issue. T09 owns ledger/harness/integration only. Preserve first failure, affected source, impact and owning ticket. Independent backup authority, maintenance-required restore, blocked purge classes and observational ops limits remain explicit; successful refusal tests do not establish production resume/compliance/capacity.
