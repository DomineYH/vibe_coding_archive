# Issue #80 implementation and verification evidence

## Scope and revision

Issue [#80](https://github.com/DomineYH/vibe_coding_archive/issues/80), under [Phase 2 spec #77](https://github.com/DomineYH/vibe_coding_archive/issues/77), adds the file-SQLite schema and the basic public app list/detail HTTP boundary. The initial implementation results below refer to source commit `1063bff59c793f5e812477cd80ec2a1059ec39d1`; fix-round-1 results are recorded against `73c7f27d2d90eea033d66c2df589d78a755b71cc` on branch `feat/issue-80-public-app-db-list-detail`.

The migration adds distinct member ID/login/nickname fields, owned apps, app grades, and health summaries with real foreign-key, uniqueness, check, and duplicate-grade constraints. Public GET handlers use explicit card/detail DTOs, only read rows whose public flag is true, use one generic 404 for private/missing IDs, and return stored UTC health/timestamps without creating jobs. `apps_read` remains disabled. Authentication, writes, admin access, search, filtering, full facets/raw-query behavior, and health checks remain disabled or owned by later tickets; no result below claims those features.

No frontend source, OpenAPI source, generated API types, dependency lock, or visual baseline changed. The #80 UI-capture acceptance criterion is applicability-excluded because app-read availability and product UI did not change. Per the coordinator's additional evidence request, API-mode failure, loading, and unavailable screen states were captured at the five fixed viewports anyway; the capture and comparison are supplemental and do not constitute human UI acceptance.

## Runtime and data isolation

Linux 6.6.87.2 WSL2 x86_64; Python 3.12.3; SQLite 3.45.1; uv 0.11.28; FastAPI 0.141.1; SQLAlchemy 2.0.54; Ruff 0.16.8; Node v22.23.2; npm 12.0.2; Playwright 1.63.0; visual Chromium 151.0.7922.34. Both Korean font matches resolved to Noto Sans CJK JP. The frontend lock SHA-256 is `a144ceeb246e3a37aab67fec9912b0a95107b0b9c7dbb17b3c8fe1a93478c087`; `backend/uv.lock` SHA-256 is `6d18d4707b42bc09fd2817dec3968d02f3f992af9b682fdb57a1a5513322d8d9`.

Tests use synthetic member/app rows, including private/login/email/phone/password-hash sentinel values. HTTP assertions check response allow-lists and the same private/missing 404. The restart test migrates a temporary file DB once, starts the actual API process, terminates it, starts a second process on the same file, and reads the same list and exact detail URL/prompt. API browser checks use an isolated migrated test DB; the temporary DB and both server processes were removed after the capture run. No real credentials, contact information, or database files are included here.

## Red/green and first-failure record

- Before implementation, `cd backend && APP_ENV=test uv run --frozen pytest tests/contracts/test_public_apps.py -q` failed as expected: the new route and `members` table did not exist. The tests then passed against the real migrated file DB after the schema and route were added.
- The first generated-schema comparison found FastAPI emitted `anyOf` for nullable `latest_job` while the single OpenAPI contract requires `oneOf`; the DTO schema was corrected and the complete response-schema comparison now passes.
- The focused public-app plus metadata contract run passed 7 tests. The final backend run passed 39 tests. The API worker-restart test was also observed independently at 1/1, including detail URL and multiline prompt preservation.
- After the final persistence assertion was added, Ruff's format check identified one test-line wrap. The file was formatted and the source commit amended before final checks; final Ruff lint and format checks both pass on the recorded SHA.

## Final local checks on source commit `1063bff59c793f5e812477cd80ec2a1059ec39d1`

Commands are from the repository root unless their first path changes the working directory.

| Scope | Command | Observed result |
| --- | --- | --- |
| Backend locked setup | `cd backend && uv sync --locked` | PASS; 42 packages resolved, 40 checked. |
| Backend lint | `cd backend && uv run --frozen ruff check .` | PASS; all checks passed. |
| Backend formatting | `cd backend && uv run --frozen ruff format --check .` | PASS; 15 files already formatted. |
| Backend suite | `cd backend && APP_ENV=test uv run --frozen pytest` | PASS; 39/39 tests in 49.67s. Existing Starlette/httpx deprecation warning only. |
| Frontend locked setup | `cd frontend && npm ci` | PASS; 349 packages added, 350 audited, 0 vulnerabilities. npm reported the existing blocked `esbuild@0.25.12` install script and deprecation notices for `whatwg-encoding@3.1.1` and `eslint@9.39.5`. No lockfile changed. |
| Playwright browser availability | Command not run; browser executable availability/version checked locally | NOT RUN; Chromium was already cached. The CI `--with-deps`/system-package install was also not run because Chromium, pinned visual Chromium, and CJK font were already present; the two CI font matches were checked locally. |
| Frontend static checks | `cd frontend && npm run check` | PASS; OpenAPI lint, generated type freshness, TypeScript, ESLint, and Prettier. Redocly emitted the existing two warnings that `/healthz` and `/readyz` have no 4xx response. |
| Frontend unit tests | `cd frontend && npm test` | PASS; 417/417 tests across 28 files in 160.83s. |
| Actual API-mode browser test | `cd frontend && npm run test:e2e:api` | PASS; 1/1 real API E2E in 42.8s. It verifies `apps_read` is false and the UI does not call apps/auth/CSRF endpoints. |
| Existing mock-mode browser suite | `cd frontend && CI=true npm run test:e2e` | PASS; 106/106 tests in 4.2m. |
| Mock output | `cd frontend && npm run build:mock` | PASS; typecheck and mock build succeeded. Existing Vite >500 kB chunk-size warning. |
| API output and separation | `cd frontend && npm run build && npm run check:dist` | PASS; API dist contains 96 files and no mock fixtures, Tweaks, references, or source maps. Existing Vite >500 kB chunk-size warning. |
| Source preservation | `cd frontend && npm run check:reference` | PASS; all 11 original files and preserved copies match SHA-256 and byte counts. |
| Visual CI comparisons | `cd frontend && CI=true VISUAL_BASELINE_CAPTURE=0 FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" npm run test:visual` with `PLAYWRIGHT_CHROMIUM_EXECUTABLE` set to the pinned browser | PASS; 122/122 comparisons in 6.3m using Chrome for Testing 151.0.7922.34. `VISUAL_BASELINE_CAPTURE=0`; no baseline/reference update. The ephemeral executable path is omitted from this repository record. |
| Supplemental real API-mode captures | Set `DB` to a runner-owned temporary SQLite file; run `APP_ENV=test DATABASE_PATH="$DB" PUBLIC_ORIGIN=http://localhost:5174 uv run --frozen alembic upgrade head` from `backend`, then `APP_ENV=test DATABASE_PATH="$DB" PUBLIC_ORIGIN=http://localhost:5174 npx playwright test --config=playwright.api.config.js e2e-api/issue80-capture.spec.js` from `frontend`. | PASS; 1/1 actual FastAPI/Vite scenario generated 30 full/status PNG captures (failure, held loading, unavailable × five viewports). `issue80-capture.spec.js` was a temporary copy of the existing API test with only the output directory redirected; it was removed after the run. The DB was isolated and removed after capture. No fixture rows were seeded for this UI scenario and `apps_read` remained false. |

The API-mode captures are in [`visual/api-mode/`](visual/api-mode/). [`comparisons.json`](visual/api-mode/comparisons.json) compares their full-page and status-card PNGs to the accepted #79 API-mode captures at the same viewports and DPR. All 15 status-card pairs are pixel-identical. Twelve of 15 full-page pairs are pixel-identical; the three 390×844 state captures each record the same 16 differing pixels (maximum channel delta 18). Those differences are retained in the comparison record for human review; no padding, threshold change, or baseline update was made. Human UI-D/accessibility review remains pending.

The CI's pinned visual Chromium download and apt font setup were not repeated because Chromium 151.0.7922.34 and the required Noto Sans CJK JP font were already available locally. The local build produced only its existing chunk-size warning. Normal checks did not regenerate types, alter lockfiles, or modify visual baselines.

## Fix round 1 dispositions

1. **Query and stored-data errors:** confirmed. #77 §3 distinguishes validation/input errors from service failures; the OpenAPI `GET /apps` response declares a 400 `ErrorEnvelope`, and `frontend/src/services/api/apps.ts` allows `GET /apps` 400 `VALIDATION_ERROR` with optional `fields`. The route now parses and validates query values before database access, returns those field errors for invalid input, and maps stored timestamp conversion failures to generic 503 `SERVICE_UNAVAILABLE`. The regression corrupts a stored health timestamp and checks status, code, and redaction.
2. **Schema normalizer duplication:** confirmed. Both contract suites now use the single `normalize_schema` fixture in `backend/tests/contracts/conftest.py`.
3. **Test ownership/layout:** confirmed. Process startup, HTTP reads, and restart persistence coverage moved to `backend/tests/test_public_app_restart.py`; database migration and synthetic public/private seeding fixtures live in `backend/tests/conftest.py`. `test_public_apps.py` now contains only public-app contracts and database constraints.
4. **AC10 hosted status:** corrected. On prior source `5d72a88`, hosted `backend-api` runs `36498908887` and `36498915706` passed; the frontend run was pending. These results do not cover R1 source `73c7f27`, whose hosted run remains pending coordinator confirmation. AC10 therefore records local checks as passed and hosted CI as pending, rather than marking the whole acceptance row PASS.

The regression test first failed as expected: the corrupt stored timestamp returned 400 instead of 503, and the query-error assertion observed `INVALID_QUERY` instead of `VALIDATION_ERROR`. An initial test setup attempt accessed the app engine before entering `TestClient`; moving the corruption inside the client context fixed the harness. The focused public-app, metadata, and restart tests then passed 8/8.

## Fix round 1 final checks on source commit `73c7f27d2d90eea033d66c2df589d78a755b71cc`

Commands ran from `backend/` unless otherwise noted.

| Scope | Command | Observed result |
| --- | --- | --- |
| Backend lint | `uv run --frozen ruff check .` | PASS; all checks passed. |
| Backend formatting | `uv run --frozen ruff format --check .` | PASS; 17 files already formatted. |
| Full backend suite | `APP_ENV=test uv run --frozen pytest` | PASS; 40/40 tests in 53.43s. Existing Starlette/httpx deprecation warning only. |
| Focused contracts and restart | `APP_ENV=test uv run --frozen pytest tests/contracts/test_public_apps.py tests/contracts/test_public_meta_health.py tests/test_public_app_restart.py -q` | PASS; 8/8 tests. |
| Frontend checks | Not run | No frontend or generated contract files changed in R1; no lockfile, API type, OpenAPI source, reference, or visual baseline changed. |
| Hosted CI | Coordinator observation for prior source `5d72a88` | `backend-api` runs `36498908887` and `36498915706` passed; frontend pending. Hosted CI for source `73c7f27` remains pending coordinator confirmation. |

The R1 source commit is `73c7f27d2d90eea033d66c2df589d78a755b71cc`. The evidence and acceptance-ledger update is committed separately; it does not change the source tested above.

## Acceptance and remaining gates

Local backend/API/DB behavior and current frontend regression checks pass. Search/filter semantics, full facets, actual user-facing list/detail activation, auth, writes, administrator access, and health jobs are not claimed; `apps_read` remains false pending T04. The product screen was not switched to the new routes.

Hosted CI observed for prior source `5d72a88` has two passing backend-api runs (`36498908887`, `36498915706`) and a pending frontend run. Hosted CI for R1 source `73c7f27` remains pending coordinator confirmation. DomineYH's visual, accessibility/device, and local handover acceptance remain pending. The capture comparison records the small 390×844 differences for that review and does not mark them accepted.
