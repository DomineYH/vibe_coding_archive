# Issue #210 — accessible administrator operational restrictions

The existing member list and Health Monitor show a shared visible note only for
an action disabled by an explicitly disabled capability with
`operational_restriction`. Password reset retains the mock-mode enablement rule;
individual and batch health capability decisions remain independent. Each
restricted button references the existing DOM note through `aria-describedby`.
Enabled controls remove the operational reference. Static notes have no alert
role, tooltip dependency, inferred cause or internal operational details.

- Reset: “비밀번호 초기화 운영 준비가 확인되지 않아 임시 비밀번호를 설정할 수 없어요.”
- Health: “연결 검사 운영 준비가 확인되지 않아 새 검사를 접수할 수 없어요. 기존 연결 결과는 확인할 수 있어요.”

## Red / Green

Commands ran from `frontend/` with `--pool=threads --maxWorkers=1 --no-cache
--configLoader=runner` after the default fork worker timed out during startup.
The thread runs reached actual assertion failures before production changes.

| Slice  | Command before / after implementation                                                  | Red                                                                                                                               | Green                                |
| ------ | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Reset  | `npx vitest run tests/admin-view.test.jsx -t 'connects only operationally restricted'` | [Actual failure](checks/red-reset-retry.log): mixed `operational_restriction`/`not_implemented`, missing visible notice (`null`). | [4 passed](checks/green-reset.log).  |
| Health | `npx vitest run tests/admin-view-apps.test.jsx -t 'explains .* independently'`         | [2 failures](checks/red-health.log): `health_check` and `health_batch` each lack the visible notice.                              | [2 passed](checks/green-health.log). |

[The initial fork-worker timeout](checks/red-reset.log) did not execute tests and
is not counted as Red. Existing “준비 중” absence assertions remain in the tests.

## Verification

| Check                                                                                                                                                                        | Result and evidence                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx vitest run tests/admin-view.test.jsx tests/admin-view-apps.test.jsx tests/health-check-control.test.jsx --pool=threads --maxWorkers=1 --no-cache --configLoader=runner` | [73 passed](checks/affected-components.log).                                                                                                            |
| `npm run check`                                                                                                                                                              | [Passed](checks/frontend-check.log): contract generation, type checking, lint and formatting. OpenAPI lint retains two existing warnings.               |
| Mock Playwright: `e2e/admin.spec.js e2e/admin-apps.spec.js e2e/health-check.spec.js`                                                                                         | [34 passed](checks/mock-browser-rerun.log), one worker.                                                                                                 |
| `npm run test:visual -- --config=<temporary visual config> visual/admin.spec.js --grep='1440x1000\|390x844\|360x844'`                                                        | [3 passed](checks/admin-visual.log), one worker; 33 capture records, including existing reset/reauth/delete/progress states.                            |
| API Playwright: `npm run test:e2e:api -- e2e-api/admin-apps.spec.js --config=<temporary API config>`                                                                         | [6 passed, exit 0](checks/api-browser-rerun.log); [saved exit status](checks/api-exit.txt). All six owned-fixture cleanup checks report zero leftovers. |
| `git diff --check`                                                                                                                                                           | Passed (checked again before the final commit).                                                                                                         |

The temporary runner configs live in
`/home/dominelinux/.cache/vibe_coding_archive/coord/b210/`. They retain the repo
configs and redirect Vite caches to that directory, allow read access to fonts
through the dependency symlink, and select the required Chromium executable.
The mock runner allows 90 seconds for test completion because the first cold
page load exceeded 30 seconds. Assertions and visual pixel thresholds are
unchanged. The [first mock attempt](checks/mock-browser.log) records the cold
load timeout and blocked symlink-font requests; it was stopped before the
corrected passing run. The font URL returned HTTP 200 after the runner fix. The first attempt
reported three failures (cold navigation and two font/layout checks), three
passes, one interrupted case and 27 unrun cases; the corrected rerun executed
and passed all 34 cases.

The [first API command](checks/api-browser.log) printed six passing tests and
zero leftovers but its outer command returned 143 after completion. The same
selected API spec was rerun in a PTY without source/config changes, producing
six passing tests and a recorded exit status of 0. The first termination was
not reproduced; it is recorded rather than counted as a clean command pass.

Environment: WSL, Node 24.21.0, npm 12.2.0, Chromium headless shell
151.0.7922.34, Python 3.12.3. The API runner uses the existing prepared blocklist,
a frozen isolated venv in the coordinator directory, temporary test data and
synthetic test-only HMAC material, `PYTHONDONTWRITEBYTECODE=1`, and
`TMPDIR=/tmp/e210` to keep Unix socket paths short. It does not provision or
activate production capabilities. Browser suites ran serially. Copied evidence logs trim trailing whitespace
for repository checks; the original command output is retained in the
coordinator directory.

## Acceptance criteria

| Criterion                                                                                                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Visible API-mode notices and accessible descriptions for all three independent capabilities                                                  | Reset parameterized notice test and shared-member test; `explains health_check independently…` / `explains health_batch independently…`; API notice capture case.                                                                                                                                                                                          |
| Real unique IDs for multiple members/apps; protected admins retain no reset action                                                           | Shared-member test checks one shared ID and protected row; health tests check multiple app rows and every description target; API test checks all IDs and every description reference across real rendered lists.                                                                                                                                          |
| Enabled transition removes notice/reference; no false notice for unresolved, other reasons, busy/pending/in-progress or enabled mock actions | Component tests cover transitions (including enabled metadata retaining the reason), unresolved metadata, `not_implemented`, `verification_pending`, approval/reset locks, pending batch admission, queued/running row jobs and mock reset enablement. Enabled mock health actions retain their existing descriptions in the passing browser monitor case. |
| Disabled actions issue no checks/batches/reset operations; existing reads/recovery continue                                                  | Unit service spies on disabled controls, API non-GET request collection, retained stored health summaries, disabled-admission job and batch read-recovery tests. Existing reset/reauth/unknown/cancellation recovery browser cases pass. Admission/progress/read conditions are unchanged in production.                                                   |
| Readable mobile and desktop layout; existing rows and controls usable                                                                        | API notice captures and no-horizontal-overflow checks at 360/390/1440px; existing mock narrow-row/header tests and three admin visual cases; [UI deviation entry](../../../../ui-deviations.md).                                                                                                                                                           |
| Affected regressions and frontend check pass; old preparation expectations retained                                                          | 73 component cases, 34 mock browser cases, 3 admin visual cases, API result above and `npm run check`; exact commands and raw logs are linked here.                                                                                                                                                                                                        |

## Visual evidence

The API case uses the real isolated authentication and list services with
controlled `/api/v1/meta` capability responses. All three actions are disabled
with `operational_restriction` for the captures, then enabled without sending
an action request. Capability-response control is browser-test-only. These are
product-only observations, not pixel baselines or approval to enable a worker
or a password reset gate.

| Viewport  | Restricted member list                                    | Restricted Health Monitor                                             |
| --------- | --------------------------------------------------------- | --------------------------------------------------------------------- |
| 1440×1000 | [Reset notice](api/admin-users-operational-1440x1000.png) | [Individual/batch notice](api/admin-health-operational-1440x1000.png) |
| 390×844   | [Reset notice](api/admin-users-operational-390x844.png)   | [Individual/batch notice](api/admin-health-operational-390x844.png)   |
| 360×844   | [Reset notice](api/admin-users-operational-360x844.png)   | [Individual/batch notice](api/admin-health-operational-360x844.png)   |

[Capture dimensions and fixture context](api/captures.json).

The evidence keeps the six existing mock member-list / Health Monitor source
comparisons from the passing visual run. The original local run also captures
other unchanged operation panels; those remain under
`frontend/test-results/visual/admin/` and are summarized by the raw passing log.

| Viewport  | Mock member list: product/reference height    | Mock Health Monitor: product/reference height  |
| --------- | --------------------------------------------- | ---------------------------------------------- |
| 1440×1000 | [1378 / 1111](mock/admin-users-1440x1000.png) | [1893 / 1966](mock/admin-health-1440x1000.png) |
| 390×844   | [1870 / 2456](mock/admin-users-390x844.png)   | [3751 / 2977](mock/admin-health-390x844.png)   |
| 360×844   | [2110 / 1560](mock/admin-users-360x844.png)   | [3768 / 3069](mock/admin-health-360x844.png)   |

All six are `dimensions_mismatch`, so there are no pixel-difference counts.
[Comparison JSON](mock/visual-comparison.json) retains zero pixel tolerance and
`comparisonEnforced: false` from the existing admin comparator. Preserved
`18-admin-users.png` / `21-admin-health.png` references, product/source
baselines, manifests and masks were not changed.

The known 16 local font-related failures listed in
`/home/dominelinux/.cache/vibe_coding_archive/coord/b160/logs/repair2-visual-base.log`
are the five-view registration/edit/private-owner-detail comparisons (15) and
the gallery-loading font assertion (1). Those other specs were not rerun for
this view-only change. All three affected admin visual cases passed; the
reported dimension mismatches are comparison records, not new test failures.

## Unrun scope and review limits

The full component/browser/visual suites and unchanged API specs were not run:
the two admin components have a known, narrow caller scope, and targeted
regressions cover the changed behavior. Backend source, contracts, dependencies,
lockfiles, operational docs, storage, `.env` files and production gates were
not changed. No external app probe was issued. Human UI-D, screen-reader and
physical-device acceptance remain pending; automated description/layout checks
and screenshot inspection do not replace them. The coordinator owns the
independent post-commit review.
