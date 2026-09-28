# Issue #79 final verification evidence

## Scope and revision

Issue [#79](https://github.com/DomineYH/vibe_coding_archive/issues/79), under [Phase 2 spec #77](https://github.com/DomineYH/vibe_coding_archive/issues/77), connects the existing API-mode screen to real catalog metadata and distinguishes process liveness from migrated database readiness. The application source tested below is commit `4e212cab6d699965e5fc19d0f48b93020474e4d6` on `feat/issue-79-real-meta-db-readiness`. This evidence/acceptance update is a documentation-only follow-up; no application source changed after that commit.

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

## Final commands and results on source commit `4e212cab6d699965e5fc19d0f48b93020474e4d6`

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

## Acceptance boundary and open items

Local API, database, contract, frontend, and build checks pass. This does not establish hosted CI, deployed database/monitoring behavior, server-side authorization for future features, or human handover. T03 owns app list/detail; auth, writes, admin, health workers, and related capabilities remain disabled. DomineYH UI-D/source-difference review, screen-reader review, physical-device review, and local acceptance remain pending. Hosted CI remains pending the coordinator's PR workflow.
