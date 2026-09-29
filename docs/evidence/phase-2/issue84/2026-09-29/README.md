# Issue #84 local run evidence

## Scope and boundary

Issue [#84](https://github.com/DomineYH/vibe_coding_archive/issues/84) delivers the explicit development seed command and a safe end-to-end verification of the public seeded sample. It follows Phase 2 spec [#77](https://github.com/DomineYH/vibe_coding_archive/issues/77), including the approved #15 seed command and the #77 requirement to test the actual CLI through a real TTY in a test-owned temporary working copy.

No seed HTTP route, startup seed, automatic migration, administrator, authentication, recovery, external probe, health job, OpenAPI change, generated type, dependency, lockfile update, or visual baseline was added. The seed uses fixed synthetic, RFC-valid UUIDs because the existing public mapper validates UUID version and variant bits.

## Isolated seeded scenario

The pytest case copies only the backend source and catalog into a `tmp_path` checkout, migrates that copy’s own development SQLite file explicitly, then runs `python -m app.cli seed` under `pty.fork()`. The shared synthetic test password is typed only into the real hidden prompts; pytest verifies the input is not echoed and verifies that separately salted hashes accept it. No developer database is opened. The API server inherits a listener on an OS-assigned loopback port, and Playwright’s Vite server also binds port 0; the browser UI run is not routed through or mistaken for any existing server. The normal API E2E remains a separate `APP_ENV=test` fixture run and never invokes seed.

The scenario seeds two ordinary synthetic members and one public plus one private app, checks the unchecked health state, reads public list/detail and private 404 through the API, edits public values, deletes the private app in the test fixture, and reruns seed. The rerun preserves the edited public name/prompt, password hash and approval state, restores only the absent private app, and a repeat reports zero additions without a password prompt. After fresh API process starts, public IDs/count/raw prompt and edited values remain stable; private fields remain absent.

The standalone browser runner is invoked by that same scenario against its own temporary development API. It uses the API-mode service and shared mapper, captures gallery and detail at all five fixed widths, checks the displayed edited title and prompt, public nickname, unchecked state, keyboard Tab/Enter open and return, and private detail 404. Browser traffic has no auth, health, admin, or write API request. Capture files and the compact result summary are in [visual/seed-mode](visual/seed-mode/); e.g. [gallery at 1440×1000](visual/seed-mode/gallery-1440x1000.png) and [detail at 360×844](visual/seed-mode/detail-360x844.png). They contain only synthetic demo values. No database, password, cookie, token, or user content is included.

Reproduce the integrated seed/TTY/API/restart/UI case from `backend/` with:

```sh
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell \
ISSUE84_VERIFY_SEEDED_UI=1 APP_ENV=test \
uv run --frozen pytest tests/test_dev_seed.py::test_seed_cli_seeds_only_missing_rows_and_preserves_existing_edits -q
```

The only opt-in is for this test harness to invoke the browser evidence runner; the product CLI has no bypass flag or arbitrary target path. The seed process itself receives only `APP_ENV=development` and the test-owned copy’s default settings.

## Requirement trace

| Requirement | Test/evidence and result |
| --- | --- |
| #84 AC1 · #15 explicit command, environment/path/symlink and migration head | [CLI](../../../../../backend/app/cli.py) refuses non-development, non-designated, missing, escaped, unknown, stale and multiple-current revisions. Tests verify refusal leaves the test DB unchanged and API startup does not auto-seed or migrate. PASS locally. |
| #84 AC2 · fixed-ID, missing-only, preserve, rollback | The seed integration test verifies only missing rows are restored; an existing member’s trimmed/case-fold-equivalent login ID, edited nickname/hash/approval, and the public app edits survive; repeat adds 0/0. Collision tests verify generic rejection before prompting/writes for both login-key and fixed-ID conflicts, plus whole-call rollback on insert collision. PASS locally. |
| #84 AC3 · real-TTY shared password | The seed test runs the CLI with a pty, enters a synthetic password through hidden input/confirmation, verifies no echo, separately salted hashes and no prompt when no member is missing; short/mismatched values leave no rows. PASS locally. |
| #84 AC4 · no admin, unchecked app and no external work | DB/API checks prove both users are ordinary, new app health is `unchecked` with no job or timestamps, the browser displays `미검사`, and browser API traffic contains no health/auth/admin/write request. PASS locally. |
| #84 AC5 · test-owned working copy, no bypass or real target | All CLI, DB, API and UI actions happen inside the pytest-created temporary copy. Noninteractive, wrong environment/path, symlink escape, missing DB and incompatible revision cases are refused. PASS locally. |
| #84 AC6 · separate API E2E fixtures | `npm run test:e2e:api` continues to use its own temporary `APP_ENV=test` database and fixtures; its runner does not call seed. Seed-mode checks use a distinct development-mode temporary copy and separate screenshots/results. PASS locally; counts below. |
| #84 AC7 · real API → mapper → gallery/detail and restart | The seeded browser run reads the existing `/api/v1/apps` and detail routes through API mode, displays the edited public values, sees the private 404, and captures only that same temporary database after fresh API process starts. PASS locally; 10 captures across five widths. |
| #84 AC8 · existing screen/contract boundaries | No new endpoint or contract/type change. Actual responses use the existing metadata/list/detail APIs; current mapper carries the seeded UUIDs to the screen. No OpenAPI generation was run. PASS locally. |
| #84 AC9 · UI-D02/04/06, T-DATA-01, local T-OPS-01 partial | Five viewport sizes, overflow limits, keyboard open/return, nickname display, private exclusion, unchecked health, mock/API build separation and bundle checks are linked below. Only local T-OPS migration/revision/seed/restart portions are tested. PASS for the local portions listed; DomineYH visual and local handover acceptance remains pending. |
| #84 AC10 · regression and protected assets | Backend/frontend gates below ran with baseline capture OFF. No lockfile, type, source reference, or baseline was modified. API E2E and development seed fixtures remain separate. PASS locally; hosted CI and human acceptance are not inferred. |

## Iteration trail

| First result | Correction and re-verification |
| --- | --- |
| The first TDD CLI test could not import `app.cli`, as expected before the command existed. | Added the explicit seed CLI and exercised the pty scenario; the seeded integration test passes. |
| The initial login-collision assertion could pass for any nonzero CLI result before reaching the conflicting insert. | Tightened it to require the generic conflict message and assert rollback/no partial apps; the test then passed against the collision case. |
| Deleting the test’s private app initially left related grade/health rows because raw fixture SQLite had foreign keys disabled. | Enabled FK enforcement in the fixture connection before the delete; production code was unchanged. The preservation/reseed path passes. |
| A first test API startup using fixed port 8000 found a pre-existing listener. It did not send a request to or stop that service. | Changed the seed test API to inherit its own ephemeral loopback socket FD; the current helper checks its own `/healthz` endpoint. |
| The first optional UI integration attempted to resolve `frontend/` from the copied checkout and exited before running the browser. | The test now resolves this repository’s frontend with its module root while retaining the backend/database inside `tmp_path`; the next run reached the browser. |
| The first seeded UI read reached the API but the existing mapper rejected the card because seed UUIDs used invalid version/variant bits. | Changed only the fixed synthetic IDs to RFC-valid version/variant values; pty → reseed → API restart → mapper/gallery/detail now passes. |
| A first browser traffic assertion classified Vite `/src/...health...` module requests as health API calls. | Restricted the assertion to `/api/v1/` requests and GET methods. The UI scenario passed with no health/auth/admin/write requests. |
| First `npm run check` found browser globals undefined by the Node ESLint configuration in the new Playwright script. | Declared the two browser globals for ESLint; focused ESLint and the full `npm run check` pass. |
| First `npm run test:e2e:api` run finished 22/23: the existing `apps.spec.js` screenshot case exceeded its 30-second timeout by less than a second while setting the next viewport. | The unchanged full API E2E rerun passed 23/23. It rewrote tracked #81/#82 API-mode capture outputs during execution; those exact pre-existing capture directories were restored afterward. |
| The two new PTY regressions failed against the prior CLI: both cases prompted twice and returned the short-password validation error instead of rejecting conflicting member identity. | Preflight normalized login keys and fixed member IDs before requesting the password. Both tests now pass 2/2 with the generic conflict message, zero prompts, and no seed-member/app writes. |
| The first Ruff format check found only layout in the new PTY assertions. | Formatted only `tests/test_dev_seed.py`; Ruff format check now passes for all 21 backend files. |

## Final local verification

Commands are run in their named directory. Full API E2E uses its separate test fixture database. The development seed case uses a temporary working copy and ephemeral API/Vite ports. `VISUAL_BASELINE_CAPTURE=0` prevents baseline mutation.

| Scope | Command | Result |
| --- | --- | --- |
| Locked backend environment | `uv sync --locked` (`backend/`) | PASS; resolved 42 packages, checked 40; lock unchanged. |
| Backend lint | `uv run --frozen ruff check .` (`backend/`) | PASS; all checks passed. |
| Backend format | `uv run --frozen ruff format --check .` (`backend/`) | PASS; 21 files formatted. |
| Backend tests | `APP_ENV=test uv run --frozen pytest -q` (`backend/`) | PASS; 74 passed in 285.77s; one existing Starlette/httpx deprecation warning. |
| Seed CLI + UI integration | Reproduction command above (`backend/`) | PASS; final rerun 1/1 in 78.41s with normalized-identity, edited nickname/hash/approval, API restart and browser assertions; 10 screenshots at five widths. |
| Acceptance record regression | `npm test -- tests/acceptance-record.test.js` (`frontend/`) | PASS; 10/10. |
| Frontend static checks | `npm run check` (`frontend/`) | PASS; ESLint, formatting, OpenAPI checks, and typecheck completed. OpenAPI lint retains two existing `/healthz` and `/readyz` missing-4xx notices. |
| Frontend unit tests | `npm test` (`frontend/`) | PASS; 423 tests across 28 files. |
| Mock browser E2E | `CI=true npm run test:e2e` (`frontend/`) | PASS; 106/106. |
| API browser E2E | `npm run test:e2e:api` (`frontend/`) | First run 22/23 due to the transient screenshot timeout above; full rerun PASS 23/23. #81/#82 capture outputs were restored after the run. |
| Visual suite, baseline capture OFF | `CI=true VISUAL_BASELINE_CAPTURE=0 FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` (`frontend/`) | PASS; 122/122; `VISUAL_BASELINE_CAPTURE=0`. |
| Mock build | `npm run build:mock` (`frontend/`) | PASS; 1,646 modules transformed; Vite reports the existing >500 kB chunk advisory. |
| API build | `npm run build` (`frontend/`) | PASS; 1,646 modules transformed; Vite reports the existing >500 kB chunk advisory. |
| API distribution | `npm run check:dist` (`frontend/`) | PASS; 96 files; no mock fixtures, Tweaks, references, or source maps. |
| Preserved references | `npm run check:reference` (`frontend/`) | PASS; 11 original files match their preserved-copy SHA-256 and byte counts. |
| Patch whitespace | `git diff --check` (repo root) | PASS after documentation updates. |

## Handover and unverified scope

- UI-D02 is checked for the seeded nickname/ID distinction; UI-D04 retains mock/API separation and the API distribution gate; UI-D06 shows persisted `unchecked` status without health requests. Five-width captures and automated keyboard checks are local Chromium evidence only.
- T-DATA-01 is covered only for the current public-response exclusion, private 404, and separate mock/API/test data paths. Credential/session transitions and future cache/data paths remain later-phase work.
- T-OPS-01 is only locally partial: explicit migration, FK-backed schema, revision rejection, seed idempotence, and temporary-database server restarts. This is not production backup/restore or operational recovery acceptance.
- DomineYH’s UI-D review and Phase 2 local handover acceptance remain pending. Screen-reader/physical-device checks and hosted CI were not run.
- Real login/session, administrator bootstrap/recovery, writes, external health checks, worker jobs, production serving, backups/restores, and operational approval are out of scope and unverified.
- Visual baseline capture was OFF. The #81/#82 outputs rewritten temporarily by the first API E2E run were restored; no final changes to existing screenshots, baselines, source references, generated types, or lockfiles remain.
