# Issue #79 final verification evidence

## Scope and revision

Issue [#79](https://github.com/DomineYH/vibe_coding_archive/issues/79), under [Phase 2 spec #77](https://github.com/DomineYH/vibe_coding_archive/issues/77), connects the existing API-mode screen to real catalog metadata and distinguishes process liveness from migrated database readiness. The initial implementation checks below ran on `4e212cab6d699965e5fc19d0f48b93020474e4d6`. Review round 1 adds source commits `729facb` and `d168943`; its final checks and per-finding dispositions are recorded below against `d16894372a5c2be21e575075c80f89503a6a3a65`. This evidence/acceptance update is documentation-only; no application source changed after `d168943`.

The API returns catalog values from `contracts/catalog.json`, UTC server time, nullable support fields, and disabled capabilities for all unimplemented operations. SQLite startup requires an explicit Alembic migration at the current head. `/healthz` returns only `{"status":"ok"}`; `/readyz` returns only `{"status":"ready"}` or `{"status":"not_ready"}`. No app-list/detail, authentication, write, admin, health-check, or worker behavior was added.

## Contract and runtime trace

| Requirement | Evidence | Result |
| --- | --- | --- |
| Explicit environment configuration and isolated DB | `backend/tests/test_settings.py`; `APP_ENV=test uv run --frozen pytest -q` | APP_ENV is required from the process. Test/production require explicit absolute DB path and origin; test/production paths inside the repository and non-HTTPS production origins are rejected. Development dotenv fallback is limited to development. |
| Explicit migration and safe startup refusal | `backend/tests/test_settings.py`, `backend/tests/test_public_meta_health.py` | An unmigrated DB does not auto-create product tables or start the API; process exits nonzero with generic stderr that omits the database path. Current-head startup and unknown-revision readiness behavior pass. |
| SQLite connection behavior | `backend/tests/test_public_meta_health.py` | Temporary file SQLite is in WAL mode; two independent connections each report `foreign_keys=1`; API readiness uses a request-scoped SQLAlchemy session. |
| Liveness/readiness, OpenAPI and FastAPI declarations | `backend/tests/test_public_meta_health.py`; `contracts/openapi.yaml`; `frontend/tests/openapi-contract.test.js` | Actual HTTP responses and generated FastAPI declarations match the single edited OpenAPI source and exact response bodies/statuses. Liveness remains 200 while readiness becomes 503 for an unknown revision. |
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

## Acceptance boundary and open items

Local API, database, contract, frontend, and build checks pass. This does not establish hosted CI, deployed database/monitoring behavior, server-side authorization for future features, or human handover. T03 owns app list/detail; auth, writes, admin, health workers, and related capabilities remain disabled. DomineYH UI-D/source-difference review, screen-reader review, physical-device review, and local acceptance remain pending. Hosted CI remains pending the coordinator's PR workflow.
