# Issue #79 final verification evidence

## Scope and revision

Issue [#79](https://github.com/DomineYH/vibe_coding_archive/issues/79), under [Phase 2 spec #77](https://github.com/DomineYH/vibe_coding_archive/issues/77), connects the existing API-mode screen to real catalog metadata and distinguishes process liveness from migrated database readiness. The initial implementation checks below ran on `4e212cab6d699965e5fc19d0f48b93020474e4d6`. Review round 1 adds source commits `729facb` and `d168943`; its final checks and per-finding dispositions are recorded below against `d16894372a5c2be21e575075c80f89503a6a3a65`. Review round 2 adds source commit `7fbeec29c102fc744a6b2445762222f251c1ab1c`; its final checks and per-finding dispositions are recorded below against that exact revision. Review round 3 adds source commit `dfbc1b3ac0f0faf6d2f9b0c3c9898ba7d60fc9f8`; its final checks and dispositions are recorded below against that revision. This evidence/acceptance update is documentation-only; no application source changed after `dfbc1b3ac0f0faf6d2f9b0c3c9898ba7d60fc9f8`.

The API returns catalog values from `contracts/catalog.json`, UTC server time, nullable support fields, and disabled capabilities for all unimplemented operations. SQLite startup requires an explicit Alembic migration at the current head. `/healthz` returns only `{"status":"ok"}`; `/readyz` returns only `{"status":"ready"}` or `{"status":"not_ready"}`. No app-list/detail, authentication, write, admin, health-check, or worker behavior was added.

## Contract and runtime trace

| Requirement | Evidence | Result |
| --- | --- | --- |
| Explicit environment configuration and isolated DB | `backend/tests/test_settings.py`; `APP_ENV=test uv run --frozen pytest -q` | APP_ENV is required from the process. Test/production require explicit absolute DB path and origin; test/production paths inside the repository and non-HTTPS production origins are rejected. Development dotenv fallback is limited to development. |
| Explicit migration and safe startup refusal | `backend/tests/test_settings.py`, `backend/tests/contracts/test_public_meta_health.py` | An unmigrated DB does not auto-create product tables or start the API; process exits nonzero with generic stderr that omits the database path. Current-head startup and unknown-revision readiness behavior pass. |
| SQLite connection behavior | `backend/tests/contracts/test_public_meta_health.py` | Temporary file SQLite is in WAL mode; two independent connections each report `foreign_keys=1`; API readiness uses a request-scoped SQLAlchemy session. |
| Liveness/readiness, OpenAPI and FastAPI declarations | `backend/tests/contracts/test_public_meta_health.py`; `contracts/openapi.yaml`; `frontend/tests/openapi-contract.test.js` | Actual HTTP responses and generated FastAPI declarations match the single edited OpenAPI source and exact response bodies/statuses. Liveness remains 200 while readiness becomes 503 for an unknown revision. |
| Real metadata-to-screen path | `frontend/e2e-api/meta.spec.js`; `frontend/src/services/api/apps.ts`; `frontend/src/contracts/mappers.ts` | A real API-mode browser request returns canonical catalog values and `apps_read: false`; the existing screen shows unavailable guidance and does not request apps/auth/CSRF routes. Malformed keys, capability contradictions and invalid support URIs are rejected by the mapper. |
| Explicit retry and external-request isolation | `frontend/e2e-api/meta.spec.js` | The test holds metadata at 503 until keyboard activation of “다시 시도”, then lets the request reach the actual API. A fetch to `outside.invalid` is intercepted and aborted. |
| API runner owns its resources | `frontend/scripts/test-api-e2e.mjs` | Runner sets `APP_ENV=test`, migrates a per-run temp file DB, owns API `127.0.0.1:8000` and Vite `localhost:5174`, refuses occupied ports, and cleans processes/DB on completion. Final post-run inspection found no listeners, service processes, or `eduvibe-api-e2e-*` directory. |
| Fixed viewports and accessible retry/error state | `frontend/e2e-api/meta.spec.js`; final visual suite | Actual API screen checks 360×844, 390×844, 768×1024, 1024×900, and 1440×1000 for visible error/search/retry controls and no horizontal overflow; keyboard retry moves focus to the gallery. The pinned visual suite passed all 122 checks. |

## Red/green and first-failure record

- Initial `APP_ENV=test uv run --frozen pytest tests/test_public_meta_health.py -q` failed collection with `ModuleNotFoundError: No module named 'app'`. The backend pytest configuration now sets `pythonpath = ["."]`; final backend suite passes.
- The new malformed-origin parameterized test first failed all six cases, including raw `ValueError` for an unmatched IPv6 bracket. Settings validation now normalizes malformed URL/port parsing into a generic `ConfigurationError`; the six-case focused run passed.
- The optional support-URI mapper test first failed because relative/malformed strings were accepted. The mapper now validates absolute URI syntax; the focused run passed 1/1.
- Initial API E2E attempts exposed a Node ESM JSON-import incompatibility and then duplicate metadata attempts before explicit retry. The test uses `createRequire`, keeps all pre-retry metadata responses synthetic, and enables the real response only after keyboard retry. The final API E2E passed.
- Initial `npm run check` found stale generated OpenAPI types and then Prettier differences in three touched files. `npm run openapi:generate` was run explicitly after adding health/readiness to the OpenAPI source; the touched files were formatted. The final check passed. The two Redocly missing-4xx warnings are retained because the approved health/readiness GET contracts intentionally expose only their specified statuses.
- Initial Ruff checks found import ordering, one unused import, broad exception catches, and formatting issues. Imports/catches/formatting were corrected; final Ruff checks pass.

## Initial commands and results on implementation commit `4e212cab6d699965e5fc19d0f48b93020474e4d6`

Commands below were run from the indicated directory unless a command includes a working-directory change.

| CI/setup step | Command | Observed result |
| --- | --- | --- |
| Frontend locked install | `cd frontend && npm ci` | PASS, exit 0; 349 packages added, 350 audited, 0 vulnerabilities. npm reported the existing `esbuild@0.25.12` postinstall was blocked by its install-script allowlist. |
| Playwright + system dependencies | `cd frontend && npx playwright install --with-deps chromium` | Environment-limited failure, exit 1: sudo requires a password and a terminal. This did not block browser checks. |
| Playwright browser (without privileged system install) | `cd frontend && npx playwright install chromium` | PASS, exit 0. |
| CJK font resolution | `cd frontend && FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" fc-match --format='%{family}\n' 'monospace:lang=ko' && FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" fc-match --format='%{family}\n' 'Noto Sans CJK KR:lang=ko'` | PASS; both resolve to `Noto Sans CJK JP`. The CI apt install/remove commands were not run because the matching font was already available and sudo was unavailable. |
| Frontend static checks | `cd frontend && npm run check` | PASS, exit 0; OpenAPI lint, generated-type freshness, TypeScript, ESLint, and Prettier passed. Redocly emitted two non-fatal 4xx warnings for exact health/readiness response sets. |
| Frontend unit tests | `cd frontend && npm test` | PASS, exit 0; 28 files, 416 tests. |
| Mock browser suite | `cd frontend && CI=true npm run test:e2e` | PASS, exit 0; 106/106 tests. |
| Real API browser suite | `cd frontend && npm run test:e2e:api` | PASS, exit 0; 1/1 test in 18.5s. Actual FastAPI metadata, API-mode UI, explicit retry, external-request block, five viewport assertions, and cleanup were exercised. |
| Fixed-port refusal | `python -c 'import socket, subprocess; listener = socket.socket(); listener.bind(("127.0.0.1", 8000)); listener.listen(); result = subprocess.run(["npm", "run", "test:e2e:api"], cwd="frontend", text=True, capture_output=True); output = result.stdout + result.stderr; print(output, end=""); assert result.returncode == 1 and "Required API E2E port 8000 is already in use." in output; print("PASS: occupied fixed port is rejected before any server starts.")'` | PASS; runner failed before starting services with `Required API E2E port 8000 is already in use.`; the wrapper asserted this expected refusal. |
| Mock build | `cd frontend && npm run build:mock` | PASS, exit 0. Vite emitted its existing >500 kB chunk-size warning. |
| API build and bundle check | `cd frontend && npm run build && npm run check:dist` | PASS, exit 0; API dist contains 96 files and no mock fixtures, Tweaks, references, or source maps. Vite emitted its existing >500 kB chunk-size warning. |
| Source preservation | `cd frontend && npm run check:reference` | PASS, exit 0; all 11 original files and preserved copies match SHA-256 and byte counts. |
| Visual comparisons | `cd frontend && CI=true VISUAL_BASELINE_CAPTURE=0 FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | PASS, exit 0; 122/122 tests in 6.3m. Baseline capture was disabled; no visual baseline/reference changed. |
| Backend locked install | `cd backend && uv sync --locked` | PASS, exit 0; 42 packages resolved, 40 checked. |
| Backend lint | `cd backend && uv run --frozen ruff check .` | PASS, exit 0. |
| Backend formatting | `cd backend && uv run --frozen ruff format --check .` | PASS, exit 0; 9 files already formatted. |
| Backend tests | `cd backend && APP_ENV=test uv run --frozen pytest -q` | PASS, exit 0; 13 tests. One upstream Starlette/httpx deprecation warning was emitted. |

The pinned visual Chromium executable was already provisioned at the path used in the command above; the CI download step was not repeated. No database contents, secrets, or personal data are attached here.

## Review round 1 dispositions and final checks on source commit `d16894372a5c2be21e575075c80f89503a6a3a65`

### Independent review findings

| Finding | Disposition and evidence |
| --- | --- |
| 1 · duplicate Alembic settings call | Confirmed and removed. `backend/alembic/env.py` now reads `Settings.from_environment()` once. |
| 2 · Python dependencies | The live #15 resolution §4 mandates `pydantic-settings==2.15.0` and `pwdlib[argon2]==0.3.1`; both remain. `settings.py` imports `dotenv_values` directly, so `python-dotenv==1.2.3` was added as a direct pin matching the already locked version. `cd backend && uv lock` passed (42 packages resolved); `uv.lock` records the direct dependency. |
| 3 · repeated host allowlist | Confirmed and consolidated as `LOOPBACK_HOSTS` in `frontend/e2e-api/meta.spec.js`. |
| 4 · trailing-dot loopback host | Confirmed despite the review label `[WRONG]`. The new production-origin test first failed because `https://localhost.` was accepted, then passed after the loopback check normalized the hostname with `rstrip(".").casefold()`. |
| 5 · test DB isolation | Confirmed. Test settings now require a file path beneath a dedicated child directory of `tempfile.gettempdir()`. The direct settings test first failed for `/tmp/shared.sqlite3` and an outside-temp persistent path; both are now rejected. A Uvicorn subprocess using an outside-temp path exits nonzero with only the generic configuration error and no path in stderr. |
| 6 · API E2E fixture | Disputed for product/app rows. #29 Q6 and #77 §6 require synthetic test data/fixtures when a scenario needs them; #79 says “앱 자료의 실제 목록/상세는 T03이 담당하며 그 전에는 읽기 가용성을 성공으로 가장하지 않는다.” #77 §3 separates catalog-only `/api/v1/meta` from app list/detail. The sole baseline migration has no product tables. We interpret the fixture rule as not requiring irrelevant app rows for T02's meta-only scenario; loading them would invent T03 data. The runner now explicitly states that T03 owns app-row fixtures, and the E2E migrates its isolated DB without business rows. |
| 7 · unknown and mismatched DB revisions | Added process-start coverage for an unknown stored revision and for a migrated DB whose expected head is deliberately different in a test-only subprocess bootstrap. Both exit nonzero with generic stderr and no path. The repository currently has only `0001_baseline`, so no recognized older revision exists to use as a stale-head fixture. |
| 8 · external request blocking | Confirmed. The egress blocker now uses `context.route`, which covers popup initial requests, instead of page-only routing. The final API browser run also confirms a request to `outside.invalid` is intercepted and aborted. |

### TDD and first-failure trail

| Slice | Command | Observed result |
| --- | --- | --- |
| Trailing-dot origin, red | `cd backend && APP_ENV=test uv run --frozen pytest -q tests/test_settings.py::test_production_rejects_loopback_origin_with_trailing_dns_dot` | FAIL before the code change: `DID NOT RAISE ConfigurationError` for `https://localhost.`. |
| Trailing-dot origin, green | Same focused command | PASS, 1 test after hostname normalization. |
| Test DB path, red | `cd backend && APP_ENV=test uv run --frozen pytest -q tests/test_settings.py::test_test_environment_requires_a_dedicated_temporary_database` | FAIL before the code change: both direct-temp-root and outside-temp persistent paths were accepted (`2 failed`, `DID NOT RAISE`). |
| Test DB path, green | `cd backend && APP_ENV=test uv run --frozen pytest -q tests/test_settings.py` | PASS, 14 tests after adding the temp-root/subdirectory guard. |
| Persistent path at process boundary | `cd backend && APP_ENV=test uv run --frozen pytest -q tests/test_settings.py::test_persistent_database_path_refuses_test_process_start_safely` | PASS, 1 test; Uvicorn exits nonzero with generic stderr and no configured path. |
| Unknown and mismatched revisions | `cd backend && APP_ENV=test uv run --frozen pytest -q tests/test_settings.py` | PASS, 16 tests after adding both subprocess cases. The final 19-test suite below includes these and the persistent-path process test. |
| Initial backend style checks | `cd backend && uv run --frozen ruff check .`; `cd backend && uv run --frozen ruff format --check .` | First Ruff run found FLY002 in the test bootstrap join; format check flagged two `settings.py` lines. Replaced the join with a literal and ran `uv run --frozen ruff format app/settings.py tests/test_settings.py`; final Ruff/format checks below pass. |
| Initial frontend check | `cd frontend && npm run check` | First R1 run failed only at Prettier for `e2e-api/meta.spec.js`. `cd frontend && npx prettier --write e2e-api/meta.spec.js` passed; final check below passes. |

### Final commands and results

These commands were run against source commit `d16894372a5c2be21e575075c80f89503a6a3a65`.

| Check | Command | Result |
| --- | --- | --- |
| Dependency lock update | `cd backend && uv lock` | PASS, exit 0; 42 packages resolved. |
| Backend sync | `cd backend && uv sync --locked` | PASS, exit 0; 42 packages resolved, 40 checked. |
| Backend lint | `cd backend && uv run --frozen ruff check .` | PASS, exit 0. |
| Backend formatting | `cd backend && uv run --frozen ruff format --check .` | PASS, exit 0; 9 files already formatted. |
| Backend tests | `cd backend && APP_ENV=test uv run --frozen pytest -q` | PASS, exit 0; 19 tests in 32.52s. One upstream Starlette/httpx deprecation warning. |
| Frontend static checks | `cd frontend && npm run check` | PASS, exit 0; OpenAPI lint, generated-type freshness, TypeScript, ESLint, and Prettier pass. Redocly retains two non-fatal 4xx warnings for the exact health/readiness response contracts. |
| Frontend unit tests | `cd frontend && npm test` | PASS, exit 0; 28 files, 416 tests in 140.88s. |
| Real API browser suite | `cd frontend && npm run test:e2e:api` | PASS, exit 0; 1/1 test in 3.7s against the real API and per-run file DB. The external fetch was blocked and cleanup completed. |
| Mock browser suite | `cd frontend && CI=true npm run test:e2e` | NOT RUN in R1; only the API E2E test harness changed, with no shared production frontend code. Previous 106/106 result remains recorded above on the initial implementation source. |
| Visual suite | `cd frontend && CI=true VISUAL_BASELINE_CAPTURE=0 FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | NOT RUN in R1; no shared production frontend code changed. Previous 122/122 result remains recorded above on the initial implementation source; no baseline changed. |
| Optional system browser dependencies | `cd frontend && npx playwright install --with-deps chromium` | Still environment-limited from the initial setup: sudo required a password and terminal. The non-privileged browser install and browser suites passed; the privileged setup was not retried. |
| Process cleanup | `ss -ltnp` for ports 8000/5174 and process search for API E2E services | No API/Vite listener or runner service process remained after the final API E2E. |

The first R1 `npm run check` failed only because Prettier flagged the edited API E2E spec; `npx prettier --write e2e-api/meta.spec.js` fixed it, and the final check above passed. The first R1 Ruff check flagged a test-bootstrap string join, and the format check flagged two settings lines; the bootstrap was simplified and Ruff formatted the settings file before the final passing backend run. The pinned visual executable was already provisioned; no baseline, generated type, or frontend lockfile changed in R1.

## Review round 2 dispositions and final checks on source commit `7fbeec29c102fc744a6b2445762222f251c1ab1c`

### Independent review findings

| Finding | Disposition and evidence |
| --- | --- |
| 1 · duplicate process signal handlers | Confirmed. `frontend/scripts/test-api-e2e.mjs` now registers one `handleInterrupt` function for SIGINT and SIGTERM; both still mark interruption and stop owned child processes. |
| 2 · theme metadata not canonical | Confirmed. #77 §2 says “공개 catalog의 값·순서도 단일 원본을 사용한다”; #79 AC requires catalog values/order and rejects broken metadata. `mapMeta` validates the full canonical theme ID order through the existing `catalogValues` helper and checks each mapped theme field against `contracts/catalog.json`. The mock metadata already uses the full catalog, and the mapper fixture now does too. Red/green evidence is below. |
| 3 · production DB under temporary storage | Confirmed. #15 §7 says “운영은 외부 영속 영역의 명시적 절대경로.” `Settings` resolves `tempfile.gettempdir()` once and rejects production paths beneath that root; a `/tmp/production.sqlite3` regression test fails before the change and passes after it. Existing tests for valid production settings now use a path outside that temporary root. |
| 4 · failure/loading viewport coverage | Confirmed. The API E2E now checks metadata failure and a deterministically held pending-load state at all five fixed viewports. It retains the prior five-viewport unavailable/retry/search checks after metadata resolves. The R1 context-wide loopback-only route remains unchanged, so popup and other browser requests outside loopback stay blocked. |

The runner continues to use only the isolated migrated database and metadata endpoint for T02. No product app rows were added: #77 assigns real app list/detail to T03, while #29 requires a fixture for scenarios that need business data.

### Red/green and first-failure trail

| Slice | Command | Observed result |
| --- | --- | --- |
| Canonical themes, red | `cd frontend && npm test -- tests/mappers.test.ts -t 'requires themes to match the canonical catalog values and order'` | FAIL before the mapper change: the missing/reordered/invented-theme contract did not throw (`expected function to throw`). |
| Canonical themes, green | `cd frontend && npm test -- tests/mappers.test.ts` | PASS, 21/21 tests; mock metadata still maps the complete canonical list. |
| Production temporary DB, red | `cd backend && uv run --frozen pytest tests/test_settings.py::test_production_rejects_temporary_database_path -q` | FAIL before the settings change: `/tmp/production.sqlite3` was accepted (`DID NOT RAISE ConfigurationError`). |
| First settings rerun after implementation | `cd backend && uv run --frozen pytest tests/test_settings.py -q` | FAIL, 16 passed / 2 failed: two pre-existing production-origin tests selected `tmp_path.parent` paths still beneath `tempfile.gettempdir()`, so the new production path refusal correctly fired before the HTTPS assertions. Their test-only valid production DB paths were moved outside that resolved temp root. |
| Settings green | `cd backend && uv run --frozen pytest tests/test_settings.py -q` | PASS, 18 tests. The new temporary-path refusal and existing external persistent-path acceptance both pass. |
| First Ruff format check | `cd backend && uv run --frozen ruff format --check .` | FAIL only because Ruff wanted the new `DATABASE_PATH` test expression wrapped. `cd backend && uv run --frozen ruff format tests/test_settings.py` made that formatting-only correction; final format check below passes. |
| First complete mock browser run | `cd frontend && CI=true npm run test:e2e` | FAIL, 105/106 in 4.5m: one `page.goto('/auth?mode=login')` hit the 30s test timeout in `e2e/admin-apps.spec.js:106`; the other 105 tests passed. No R2 source issue was found. |
| Isolated retry | `cd frontend && CI=true npm run test:e2e -- e2e/admin-apps.spec.js:106` | PASS, 1/1 in 24.8s (test 11.4s). |
| Complete mock browser rerun | `cd frontend && CI=true npm run test:e2e` | PASS, 106/106 in 4.2m, including the previously timed-out first case. No source changes were needed. |

### Final commands and results

All commands below ran against source commit `7fbeec29c102fc744a6b2445762222f251c1ab1c`; no application source changed afterward.

| Check | Command | Result |
| --- | --- | --- |
| Backend lint | `cd backend && uv run --frozen ruff check .` | PASS, exit 0. |
| Backend formatting | `cd backend && uv run --frozen ruff format --check .` | PASS, exit 0; 9 files already formatted. |
| Backend tests | `cd backend && APP_ENV=test uv run --frozen pytest -q` | PASS, 20 tests in 37.14s; one existing Starlette/httpx deprecation warning. |
| Frontend static checks | `cd frontend && npm run check` | PASS, exit 0; OpenAPI lint, generated-type freshness, TypeScript, ESLint, and Prettier pass. Redocly retains the two existing non-fatal 4xx warnings for the exact health/readiness contracts. |
| Frontend unit tests | `cd frontend && npm test` | PASS, 28 files / 417 tests in 140.98s. |
| Real API browser suite | `cd frontend && npm run test:e2e:api` | PASS, 1/1 in 3.9s. The API runner owned the test API/Vite processes and temporary file database; the browser's context route blocked non-loopback traffic. Post-run inspection found no matching runner processes or `eduvibe-api-e2e-*` directories. |
| Mock browser suite | `cd frontend && CI=true npm run test:e2e` | Final rerun PASS, 106/106 in 4.2m. The earlier 105/106 timeout and isolated retry are recorded above. |
| API build | `cd frontend && npm run build` | PASS, exit 0; Vite emitted its existing >500 kB chunk warning. |
| API bundle contents | `cd frontend && npm run check:dist` | PASS, exit 0; 96 files, with no mock fixtures, Tweaks, references, or source maps. |

The R2 mapper change is covered by the full frontend unit suite and mock browser suite. No visual suite was run in R2; no visual baseline, generated type, lockfile, or reference asset changed. At the R2 evidence cutoff, hosted checks and DomineYH UI-D/source-difference, screen-reader/physical-device, and local handover reviews were pending; later frontend-only hosted outcomes are listed in the R3 section.

## Review round 3 dispositions and final checks on source commit `dfbc1b3ac0f0faf6d2f9b0c3c9898ba7d60fc9f8`

### Independent review findings

Findings 1–4 are the requested implementation/test/CI changes. Finding 5 is the coordinator's hosted-status evidence correction.

| Finding | Disposition and evidence |
| --- | --- |
| 1 · safe-startup assertion uses the wrong path | Confirmed. `_assert_safe_startup_rejection` now receives the exact `database_path` and asserts that path is absent from process output. All callers pass their actual DB path, including the test DB path outside pytest's `tmp_path`. The focused persistent-path subprocess test passes. |
| 2 · FastAPI metadata schema did not enforce catalog enums | Confirmed. #77 §2 says “공개 catalog의 값·순서도 단일 원본을 사용한다.” `MetaResponse.subjects` and `grades` now use `Literal` aliases expanded from `CATALOG`; values are not repeated. The contract test recursively dereferences each document's schema refs, drops generated titles, normalizes equivalent nullable `anyOf` schemas, and compares the full Meta property schemas. `Uri` keeps Pydantic `AnyUrl` runtime validation while its JSON Schema matches the canonical URI declaration. |
| 3 · public contract tests were outside `tests/contracts` | Confirmed. #77 §5 places API contract checks under `backend/tests/contracts`. `backend/tests/test_public_meta_health.py` was git-moved to `backend/tests/contracts/test_public_meta_health.py` without duplication; the full backend suite still collects both contract tests. |
| 4 · hosted CI omitted backend and real API checks | Confirmed. #77 §5 requires backend locked setup, Ruff, format, and pytest from Phase 2 plus frontend `npm run test:e2e:api`; `#15` pins Python `3.12.3` and uv `0.11.28`. `.github/workflows/frontend-ci.yml` now has a separate backend job with those pins and steps. The prior frontend job and its steps remain unchanged. No lockfile was changed. |
| 5 · hosted-status evidence was stale | Confirmed and corrected. All six cited runs were refreshed with `gh run view`; each is completed success on workflow `frontend`, including both runs at the current PR head `2b2f464`. Those runs do not include the unpushed R3 backend/API job, which awaits the coordinator's push. The evidence and acceptance text now state both facts. |

### Red/green and first-failure trail

| Slice | Command | Observed result |
| --- | --- | --- |
| Full metadata declaration comparison, red | `cd backend && APP_ENV=test uv run --frozen pytest tests/test_public_meta_health.py::test_fastapi_declarations_match_the_single_openapi_source -q` | FAIL before implementation: subject/grade array items were declared as unconstrained strings while the canonical contract references catalog enum schemas. Direct property comparison also exposed Pydantic-generated titles and nullable schema representation differences. |
| Full metadata declaration comparison, green | `cd backend && APP_ENV=test uv run --frozen pytest tests/contracts/test_public_meta_health.py::test_fastapi_declarations_match_the_single_openapi_source -q` | PASS, 1 test after catalog-backed literals and recursive schema normalization. |
| Out-of-tree DB process assertion | `cd backend && APP_ENV=test uv run --frozen pytest tests/test_settings.py::test_persistent_database_path_refuses_test_process_start_safely -q` | PASS, 1 test; the helper now checks the exact persistent database path in process output. |

### Hosted run status observed before this evidence update

The listed GitHub Actions runs all belong to workflow `frontend`; they do not include the R3 backend/API job. The current PR head remains `2b2f464c489715dd726d52a53a37a63989a463d6`, so the workflow change at `dfbc1b3` has not yet been pushed and its backend/API hosted checks have not run.

| Run ID | Event | SHA | Workflow | Observed status |
| --- | --- | --- | --- | --- |
| 36466907789 | push | `229511e3b5c2adc76baca9a27b7fed9319d950b1` | `frontend` | completed · success |
| 36466917554 | pull_request | `229511e3b5c2adc76baca9a27b7fed9319d950b1` | `frontend` | completed · success |
| 36471384319 | push | `baa47dedccd4687cc5c4f5277a1e68ecc856fe1b` | `frontend` | completed · success |
| 36471391290 | pull_request | `baa47dedccd4687cc5c4f5277a1e68ecc856fe1b` | `frontend` | completed · success |
| 36476521653 | pull_request | `2b2f464c489715dd726d52a53a37a63989a463d6` | `frontend` | completed · success |
| 36476516129 | push | `2b2f464c489715dd726d52a53a37a63989a463d6` | `frontend` | completed · success |

The first four runs were refreshed with `gh run view` immediately before documenting them. The two `2b2f464` checks were also refreshed immediately before this update; both are completed successes, not pending. Backend lint/tests and API E2E hosted coverage begin only after the coordinator pushes the workflow commit and are pending then.

### Final commands and results

All commands below ran against source commit `dfbc1b3ac0f0faf6d2f9b0c3c9898ba7d60fc9f8`; no application source changed afterward.

| Check | Command | Result |
| --- | --- | --- |
| Locked backend setup | `cd backend && uv sync --locked` | PASS, exit 0; 42 packages resolved, 40 checked. `uv.lock` remained unchanged. |
| Backend lint | `cd backend && uv run --frozen ruff check .` | PASS, exit 0. |
| Backend formatting | `cd backend && uv run --frozen ruff format --check .` | PASS, exit 0; 9 files already formatted. |
| Contract tests alone | `cd backend && APP_ENV=test uv run --frozen pytest tests/contracts` | PASS, exit 0; 2 tests. One upstream Starlette/httpx deprecation warning. |
| Full backend suite | `cd backend && APP_ENV=test uv run --frozen pytest` | PASS, exit 0; 20 tests in 27.95s. One upstream Starlette/httpx deprecation warning. |
| Frontend static checks | `cd frontend && npm run check` | PASS, exit 0; OpenAPI lint/check, TypeScript, ESLint, and Prettier passed. Redocly emitted its two existing non-fatal missing-4xx warnings for the approved health/readiness response sets. |
| Frontend unit tests | `cd frontend && npm test` | PASS, exit 0; 28 files / 417 tests in 158.73s. |
| Real API browser suite | `cd frontend && npm run test:e2e:api` | PASS, exit 0; 1/1 test in 19.2s, using the actual API process and isolated migrated file database. |
| Workflow YAML syntax | `python -c 'import yaml; yaml.safe_load(open(".github/workflows/frontend-ci.yml")); print("workflow YAML parsed")'` | PASS; PyYAML parsed the workflow. `actionlint` is not installed in this environment. |
| Whitespace check | `git diff --check` | PASS before the source commit. |
| Mock E2E and visual suites | Not run | R3 changed no shared production frontend code; these suites were not requested in the R3 check list. No visual baseline, generated type, npm lockfile, or Python lockfile changed. |

Local backend/API CI steps pass on the exact source revision. GitHub has not run the new job because the coordinator has not pushed `dfbc1b3`; DomineYH UI-D/source-difference review, screen-reader/physical-device review, and local handover acceptance also remain pending.

## Review round 4 dispositions and final checks on source commit `d2dd08915e9dd6c120f7b6c1f70a82e7455b1f68`

All R4 source checks below ran against `d2dd08915e9dd6c120f7b6c1f70a82e7455b1f68`. No source, workflow, or test code changed after that commit; the later commit adds only this evidence, the captures/comparison record, and the acceptance row.

### Findings and decisions

| Finding | Disposition and evidence |
| --- | --- |
| 0 · hosted setup-uv action tag failed | Confirmed. Run [36480308385](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36480308385) completed failure on `a1012a80f4cca2168d1f2f6b4f4e70c18db12e0e`: the frontend job completed successfully through all 15 steps, while the backend job failed at setup with `Unable to resolve action astral-sh/setup-uv@v10, unable to find version v10`. `gh api repos/astral-sh/setup-uv/git/ref/tags/v10.2.0` returned commit `c18668ad3cf93ea998bef934396af7bb5c839dc7`; the workflow pins `astral-sh/setup-uv@v10.2.0`. The new backend/API workflow has not been hosted yet because R4 is not pushed. |
| 1 · unused `app.state.settings` | Confirmed and removed. Search found no reader of `app.state.settings`; no meaningful runtime behavior depended on the write, so no behavior test was available. Existing backend startup/readiness tests were rerun in the final suite. |
| 2 · custom API runner vs. Playwright `webServer` | Switched to ordered `webServer` entries with `reuseExistingServer: false`, fixed API/Vite URLs and ports, and the existing Vite strict-port option. The small wrapper now owns only the test environment and unique temporary DB: it preflights ports 8000/5174, creates the per-run path, migrates with `uv run --frozen alembic upgrade head` before Playwright starts, passes `APP_ENV=test` and `DATABASE_PATH` to both servers, and removes the directory after Playwright tears its servers down. A repository-wide/global setup is not used: installed Playwright 1.63.0 starts webServer plugins before global setup, and global-setup teardown runs before plugin teardown, so it cannot both migrate before API start and safely delete the DB after API shutdown. The runner/config pair is 51 lines shorter overall than the previous pair (163+17 lines became 94+35). |
| 3 · workflow/job names | Confirmed. Workflow name is now `Frontend and backend/API CI`; its job is `backend-api`. The frontend job and existing frontend steps remain present. YAML parsing and scope assertions pass locally. |
| 4 · repeated viewport/overflow loop | Confirmed. `inspectViewport` performs the viewport resize, expected state/retry/search assertions, overflow check, font/paint settling, and full/component screenshots for all three metadata states. The R2 popup-safe context route remains intact. |
| 5 · missing API-state captures/comparison | Confirmed. Final API E2E recorded failure, held loading, and unavailable states at 360×844, 390×844, 768×1024, 1024×900, and 1440×1000: 15 full-page and 15 status-card PNGs. [`visual/api-mode/comparisons.json`](visual/api-mode/comparisons.json) compares every full-page capture with the matching mock state: failure → `gallery-failure`, loading → `gallery-loading`, and unavailable → closest `gallery-empty`. Twelve pairs have matching dimensions and exact pixel counts; three record dimension mismatches without padding or pixel-equivalence claims. The unavailable comparison explicitly records the API capability-disabled message vs. mock empty-gallery discovery copy. These are local comparison decisions only; no visual baseline or threshold changed. Human UI-D approval remains pending. |

### Runner probes and first-failure record

| Probe | Observed result |
| --- | --- |
| First raw-listener probe, before restoring the port preflight | A Python TCP listener held port 8000 but accepted no connection and returned no HTTP response. Playwright stayed in server readiness rather than producing the fixed-port refusal; the probe was deliberately interrupted with SIGINT after startup remained stuck. It exited 130; no API/Vite listener or temp directory remained. A second raw listener on 5174 let the API start, then stalled Vite readiness; SIGINT unwound the API and temp directory. This exposed that the webServer URL alone does not provide the required immediate occupied-port refusal. |
| Port-harness setup | The first local socket-harness attempt could not bind 8000 because the prior API run had left a `TIME_WAIT` connection. The probe was rerun with `SO_REUSEADDR` on its test-only listener; it then held each occupied port and exercised the runner preflight successfully. |
| Occupied-port verification after the minimal preflight | A Python harness held 8000, then 5174, invoking `npm run test:e2e:api` for each. Both exited 1 with `Required API E2E port <port> is already in use.` before temp DB creation; no runner service child was launched. |
| Forced Vite startup failure | A temporary `npm` executable returned 73 for `npm run dev:api` after the actual API had started. Playwright exited 1, the API listener was gone, and the unique DB directory was removed. The first verifier incorrectly required Uvicorn shutdown-log text; the corrected check verified process/port and DB cleanup directly and passed. |
| SIGINT forwarding | A harness started the wrapper and sent SIGINT after both fixed ports were ready. It exited 130, Playwright/server processes stopped, ports 8000/5174 had no listener, and the temporary DB directory was removed. POSIX Playwright is launched in its own process group so the wrapper forwards one signal rather than sharing the terminal's group signal. Playwright's built-in teardown is used without `gracefulShutdown`, which is unsupported on Windows. |
| Unused settings state | `rg -n "app\.state\.settings|state\.settings" backend` found no application reader; removed the write-only assignment. |

### Final checks

| Check | Command | Result |
| --- | --- | --- |
| Backend lint, format, and tests | `cd backend && uv run --frozen ruff check . && uv run --frozen ruff format --check . && APP_ENV=test uv run --frozen pytest` | PASS. Ruff passed; 9 files already formatted; 20 tests passed in 82.05s. One upstream Starlette/httpx deprecation warning. |
| Frontend static checks | `cd frontend && npm run check` | PASS. OpenAPI source/type freshness, TypeScript, ESLint, and Prettier passed. Redocly emitted the two existing non-fatal missing-4xx warnings for the approved health/readiness response sets. |
| Frontend unit tests | `cd frontend && npm test` | PASS, 28 files / 417 tests in 155.96s. |
| Real API browser suite | `cd frontend && npm run test:e2e:api` | PASS, 1/1 test in 18.8s (39.5s total command). Actual Uvicorn/FastAPI and isolated migrated SQLite were used; the browser blocks non-loopback requests. It wrote the 30 product captures listed above. |
| Workflow syntax/scope | `python -c 'from pathlib import Path; import yaml; p=Path(".github/workflows/frontend-ci.yml"); w=yaml.safe_load(p.read_text()); assert w["name"] == "Frontend and backend/API CI"; assert set(w["jobs"]) == {"backend-api", "frontend"}; assert w["jobs"]["backend-api"]["steps"][1]["uses"] == "astral-sh/setup-uv@v10.2.0"; print("PASS YAML parse; workflow/job scope and action pin verified")'` | PASS; parsed `Frontend and backend/API CI`, `backend-api`, and `astral-sh/setup-uv@v10.2.0`. `actionlint` is not installed. |
| Whitespace / artifact scope | `git diff --check`; inspected status and paths | PASS before source commit; no lockfile, generated type, source reference, or visual baseline changed. |

### Hosted and human gates at the R4 evidence cutoff

At the R4 evidence cutoff, PR #90 head was `a1012a80f4cca2168d1f2f6b4f4e70c18db12e0e`; source commit `d2dd08915e9dd6c120f7b6c1f70a82e7455b1f68` was local and no hosted R4 run existed. The invalid action tag from run 36480308385 was fixed locally; hosted verification awaited a coordinator push. Prior successes on `229511e`, `baa47de`, and `2b2f464` were frontend-only and did not verify the backend/API job. Later hosted outcomes are recorded in the R5 section below. DomineYH's UI-D/source-difference review, screen-reader and physical-device review, and local handover acceptance remained pending, not PASS. T03 owns app list/detail; auth, writes, admin, health workers, and related capabilities remain disabled.

## R4 acceptance boundary at the R4 evidence cutoff

At that cutoff, the R4 local backend/frontend/API checks and API-state captures passed on source commit `d2dd08915e9dd6c120f7b6c1f70a82e7455b1f68`. They did not establish hosted workflow results, deployed database/monitoring behavior, server-side authorization for future features, or human handover. Human visual/accessibility/device review remained pending.

## Review round 5 dispositions and final checks on source commit `933a1ed78b190b1b5325e56bb899c26c537ae79d`

### Findings

| Finding | Disposition and evidence |
| --- | --- |
| 1 · malformed production origin was accepted | Confirmed. The production case `https://bad host` failed first with `DID NOT RAISE ConfigurationError`. `Settings.from_environment` now rejects raw whitespace/control characters before `urlsplit`, malformed DNS/IDN labels, invalid numeric IPv4, malformed or non-IPv6 brackets, credentials, query/fragment, and any path (including `/`). It accepts only HTTP(S) `scheme://host[:port]` origins with DNS/IDN, IPv4, or bracketed IPv6 hosts and preserves optional valid ports. Existing production HTTPS and normalized non-loopback checks are unchanged; callers still receive generic `ConfigurationError` messages. No DNS/network lookup or dependency was added. |
| 2 · duplicated R3 acceptance row | Confirmed. Removed exactly one of the two byte-identical `#79 R3 · review findings 1–5` rows. A scan of #79 acceptance rows found no remaining exact duplicate rows. |

### Red/green and first-failure trail

| Check | Command / setup | Observed result |
| --- | --- | --- |
| Production whitespace regression, before implementation | `cd backend && APP_ENV=test uv run --frozen pytest tests/test_settings.py::test_production_rejects_origin_with_whitespace_in_host -q` | Expected red: failed with `DID NOT RAISE ConfigurationError` for production `https://bad host`. |
| Exact-origin root path regression | `cd backend && APP_ENV=test uv run --frozen pytest 'tests/test_settings.py::test_invalid_public_origin_is_reported_as_configuration_error[https://archive.example.org/]' -q` while temporarily allowing `parsed.path` | Expected red: failed with `DID NOT RAISE ConfigurationError`; restoring path rejection made it pass. |
| First valid-host matrix attempt | `cd backend && APP_ENV=test uv run --frozen pytest tests/test_settings.py -q` | Six valid-origin cases initially failed because their temporary DB path was inside the supplied `repo_root`. The test fixture was corrected to use `tmp_path.parent`; no product code change was needed for this failure. |
| Origin invalid/valid matrix | `cd backend && APP_ENV=test uv run --frozen pytest tests/test_settings.py::test_invalid_public_origin_is_reported_as_configuration_error tests/test_settings.py::test_valid_dns_ip_and_idn_origins_are_preserved -q` | PASS, 19 cases. Invalid DNS labels/IDN, bracket syntax, raw whitespace, root slash, malformed ports, query, and fragment reject; valid DNS, IPv4/port, bracketed IPv6/port, Unicode and punycode IDN origins preserve their input. |
| Ruff first attempt/fix | `cd backend && uv run --frozen ruff check .` | First attempt flagged FURB188; changed the trailing-dot normalization to `str.removesuffix`, then reran successfully. |

### Final local commands on the exact source commit

These commands were run on the exact source tree committed as `933a1ed78b190b1b5325e56bb899c26c537ae79d`; no source changes followed.

| Check | Command | Result |
| --- | --- | --- |
| Backend lint | `cd backend && uv run --frozen ruff check .` | PASS, `All checks passed!` |
| Backend formatting | `cd backend && uv run --frozen ruff format --check .` | PASS, 9 files already formatted. |
| Backend tests | `cd backend && APP_ENV=test uv run --frozen pytest` | PASS, 34 tests in 26.50s; one upstream Starlette/httpx deprecation warning. |
| Diff whitespace | `git diff --check` before the source commit | PASS. |

### Hosted runs observed

Both runs below were refreshed with `gh run view` during R5. They validate the hosted R4 source `56d3c256ef6cf278176fb68ed698141bd8cdd8f1`, not R5 source `933a1ed`; hosted R5 checks await the coordinator's push. Each run completed successfully with both `backend-api` and `frontend` jobs.

| Run ID | Source SHA | Workflow | Jobs / result |
| --- | --- | --- | --- |
| [36485103493](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36485103493) | `56d3c256ef6cf278176fb68ed698141bd8cdd8f1` | `frontend` | `backend-api` success; `frontend` success. |
| [36485107672](https://github.com/DomineYH/vibe_coding_archive/actions/runs/36485107672) | `56d3c256ef6cf278176fb68ed698141bd8cdd8f1` | `frontend` | `backend-api` success; `frontend` success. |

## Current acceptance boundary after R5

The production `PUBLIC_ORIGIN` validation, preserved valid-origin matrix, backend Ruff/format, and full backend pytest pass locally on source commit `933a1ed78b190b1b5325e56bb899c26c537ae79d`. Hosted R5 checks do not yet exist because this local branch was not pushed; the listed successful hosted runs are on R4 commit `56d3c25`. Human UI-D/source-difference, screen-reader/physical-device, and local handover acceptance remain pending. T03 still owns app list/detail; auth, writes, admin, and health workers remain disabled.
