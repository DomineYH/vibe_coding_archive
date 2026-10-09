# #203 Phase 7 local integration and release handover

**Release verdict: BLOCKED.** This record can support a local handover review after source-bound executions are attached; it does not approve Phase 7, public deployment, health/auth activation, contact values, or human acceptance. DomineYH owns T10 #193, T11 #194, T12 #204 and T13 #205; [#144 G01–G18](https://github.com/DomineYH/vibe_coding_archive/issues/144) and Q33 remain the original public gates.

The structured companion is [ledger.json](ledger.json). Its 189 required item IDs cover 312 initial rows, including separate local/CI command rows and human/host portions. All rows start NOT RUN or BLOCKED, with zero execution, a reason and an owner. Historical PASS links are context only. No suite collection, skip, command exit alone, or successful negative restore path is release approval.

## Binding and evidence flow

This is the **source-commit skeleton**, prepared on T08 `f705c69efa5894be7a59f4c4f1d3affc367a8a19`, under coordinator decision amendments 1 and 2. The candidate binding names that baseline and records the actual two lock SHA-256 values and local runtime/browser versions. It contains no executed results. After the coordinator pushes the implementation source commit and relays its CI run/job URLs, phase D creates a separate evidence-only commit: replace the pending candidate binding with that actual source SHA/release/runtime identity, attach local command logs and CI job counts, and cite the final T08 SHA. Never relabel evidence from a different executable source. Verify executable code and both locks did not change in the evidence-only commit.

Local Node/npm are 24.21.0/12.2.0, differing from CI's configured 22.23.2/12.0.2. Python is 3.12.3, uv 0.11.28, and the pinned local Chrome for Testing is 151.0.7922.34. The configured Playwright version is 1.63.0. Local Nginx/age are unavailable. Local font failures are recorded separately from CI's Noto Sans CJK JP requirement. These differences must remain visible when phase D binds results.

PASS requires nonzero execution, passed = executed = collected, zero failed/skipped, the expected result, and a matching source/lock/release/run/evidence binding. NOT RUN/BLOCKED require a reason and owner. Each skipped case gets its own NOT RUN subset; do not give its parent scope a PASS. Keep the original failed command alongside any targeted retry. Case coverage is deduplicated by case, mode and release; counts for overlapping requirement rows must never be added together.

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

Browser contexts use the runner origin and the private test certificate. HTTPS cookie assertions require the `__Host-` prefix and Secure; HTTP preserves its development cookie expectations. No login flow or rate-limit exemption is added. Existing reset/delete/admin-apps fixture cleanup still owns its rate events. `APP_ENV=test`, isolated paths and `HEALTH_CHECKS_ENABLED=false` are retained; controlled `health_testing` is not real activation.

The additional HTTPS variant excludes the remaining specs, each listed with “not selected in HTTPS variant” in the ledger. They still run in the unchanged full API command. Nginx buffering/production timeouts and all existing spec timeouts/assertions remain unchanged. Functional tests keep their existing 30-second default; static smoke retains its 120-second default. The new CI addition is exactly one backend-api step, with CI=true and HEALTH_CHECKS_ENABLED=false; no upload/reporting pipeline was added.

## Final command inventory

Run all shell commands after sourcing `/home/dominelinux/.cache/vibe_coding_archive/coord/issue121-resume-env.sh`. Heavy commands use `systemd-run --user --scope -q -p MemoryMax=3G -p MemorySwapMax=512M`. E2E/visual uses private disk-backed TMPDIR `/home/dominelinux/.cache/vibe_coding_archive/coord/impl8/tmp-t09`; backend pytest retains `/tmp` for its fixtures. Never terminate unowned listeners; wait/retry port conflicts.

| Cwd | Command | Initial state |
| --- | --- | --- |
| backend | `uv run --frozen ruff check .` | NOT RUN |
| backend | `uv run --frozen ruff format --check .` | NOT RUN |
| backend | `APP_ENV=test HEALTH_CHECKS_ENABLED=false uv run --frozen pytest -ra` | NOT RUN; execute full local suite once |
| backend | `CI=true APP_ENV=test uv run --frozen pytest -m requires_age tests/test_backup_process.py tests/test_restore_process.py -ra` | NOT RUN locally; actual age CI required |
| frontend | `npm run check` | NOT RUN |
| frontend | `npm test -- --maxWorkers=1` | NOT RUN |
| frontend | `npm run test:e2e` | NOT RUN |
| frontend | `npm run test:e2e:api` | NOT RUN; account for each unavailable/prepared/support/candidate/fault/health/empty/capture subrun |
| frontend | `npm run test:e2e:api -- --nginx e2e-api/static-serving.spec.js` | NOT RUN locally; Nginx CI required |
| frontend | `npm run test:e2e:api -- --nginx-functional` | NOT RUN locally; critical-path native CI required |
| frontend | `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" npm run test:visual` | NOT RUN; all six files, known local font failures retained separately |
| frontend | `npm run build:mock`; `npm run build`; `npm run check:dist`; `npm run check:reference` | NOT RUN; count real build modules/dist/reference files |
| frontend | `npm test -- tests/phase7-ledger.test.js tests/api-e2e-runner.test.js tests/nginx-serving.test.js tests/acceptance-record.test.js --maxWorkers=1` | Targeted RED/GREEN evidence held in implementation report; attach source binding in phase D |
| frontend | `node scripts/check-phase7-ledger.mjs ../docs/evidence/phase-7/issue203/ledger.json` | Structural validity only, never release approval |

Phase C appends exact commands, timestamps, exits, counts and original failures to the coordinator implementation report. Phase D fills this table and ledger from those records and the relayed CI run/job URLs. Skips from the first unavailable run are retained even when the same case later executes in prepared mode; they do not inflate coverage. Log evidence must exclude cookies, CSRF, raw DB/config/contact values and activation records.

## Human handover and defect routing

Human five-viewport rows cover gallery, public/private detail, login/signup/support/change-only cards, admin approval/reset/delete/monitor, and app create/edit/delete, including hidden/recheck/long/empty/dirty/error/conflict states. Widths are 1440×1000, 1024×900, 768×1024, 390×844, 360×844. Each procedure checks overflow, long values, empty/long lists, error location/text, focus order/visibility, labels, icon names, non-color status, direct routes and reload. DomineYH performs this and screen-reader/physical-device acceptance under #205. Pinned Chromium screenshots cannot substitute.

Route defects without product edits: serving #196; activation/config #197; backup #195; restore #198; migration/supervisor #199; logs/retention #200; ops/HMAC #201; support #202; prior auth/admin/health to its original issue. T09 owns ledger/harness/integration only. Preserve first failure, affected source, impact and owning ticket. Independent backup authority, maintenance-required restore, blocked purge classes and observational ops limits remain explicit; successful refusal tests do not establish production resume/compliance/capacity.
