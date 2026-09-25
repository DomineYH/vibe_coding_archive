# Issue #35 local run evidence

Run date: 2026-09-26 (Asia/Seoul). Branch: `impl/issue-35`; starting commit: `1b4eec2`. Product mode was the deterministic mock. No backend, database, real user data, external application URL, or real health probe was used.

## Environment

- Ubuntu 24.04.3 / WSL2 Linux x86_64.
- Node `22.23.2`, npm `12.0.2`; frontend dependencies were already installed.
- Functional browser suite: Playwright `1.63.0`.
- Visual suite: Chromium `151.0.7922.34` headless-shell, DPR 1, `ko-KR`, `Asia/Seoul`, fixed source time `2026-09-22T00:12:00.000Z`, and source font configuration.
- Fixed viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844.

## Signup case trace

| Case                                        | Expected result                                                                                                                                            | Evidence                                                                                                      |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Signup form labels and tab order            | Required/optional labels are exposed in field order; optional contact privacy note is visible.                                                             | `frontend/e2e/auth.spec.js`; all five viewport captures.                                                      |
| Disabled optional contacts                  | Non-empty synthetic email/phone show field errors. A blank retry succeeds without a partial account.                                                       | `frontend/e2e/auth.spec.js`; `visual/auth/auth-signup-collection-disabled-*.png`.                             |
| Confirmation mismatch and duplicate ID      | Each error is attached to its field and entered values remain.                                                                                             | `frontend/e2e/auth.spec.js`; `visual/auth/auth-signup-confirm-error-*.png` and `auth-signup-duplicate-*.png`. |
| Successful registration and pending login   | Success does not log in; expiry is the mock server time plus 90 days; after navigating to login and refreshing, the account remains pending and anonymous. | `frontend/e2e/auth.spec.js`; `visual/auth/auth-signup-pending-*.png` and `auth-signup-login-pending-*.png`.   |
| Network failure, repeated submit, and reset | Failure keeps values; second submit is blocked; reset invalidates delayed registration.                                                                    | E2E and mock service tests.                                                                                   |

Every account value used by tests and screenshots is synthetic. The UI directs developers to use fake passwords and contact values. Passwords only persist inside the development mock so that the pending account can be tested after navigation/refresh; this is not production authentication or secure credential storage.

## Visual comparisons

The auth visual run captures 65 states (13 per viewport). Forty states have no supplied original screenshot and are product-only captures. Twenty-five states compare with source references: 21 report different full-page dimensions and four have matching dimensions with non-zero pixel deltas. Signup and confirmation-error pages are taller than the source signup images because #35 adds nickname, optional contact fields, and guidance. Existing auth/login and private-detail differences remain visible in the same report. No source reference, product baseline, or pixel threshold was changed. These deltas are recorded for human review and are not approved by automation.

Screenshots and per-state dimensions/pixel metrics are in [`visual/auth/`](visual/auth/). The main report is [`visual/auth/visual-comparison.json`](visual/auth/visual-comparison.json). Source and product images use only synthetic values; password inputs are masked.

## First failures, fixes, and rechecks

- TDD red: the new registration service tests failed because `authService.register` did not exist. After implementing the contract/mock path, targeted service, mapper, API-mode, OpenAPI, and stored-state tests passed.
- The first typecheck found login ID sets inferred as fixture-only literal unions. Their element type was widened to `string`; typecheck then passed.
- The first signup E2E run exposed ambiguous `getByLabel("비밀번호")` selectors after adding the confirmation field. The form and visual test helpers now select the required password label explicitly.
- The next E2E run exposed that a successful signup view remained mounted after the login link changed route mode. The success view now renders only in signup mode; the disabled-contact retry and delayed-submit scenarios passed on recheck.
- The first visual attempt found the same ambiguous selector in its registration helper; after correcting that helper, all five auth viewport captures passed.
- The new acceptance-record check first failed because the #35 AC rows and run README were not yet present. Final trace and evidence checks are recorded below.
- A full `npm test -- --isolate=false --pool=forks --maxWorkers=1` run reported 187/190, with three existing detail-view tests seeing duplicate DOM because file isolation was disabled. No product code changed for those failures; the package's standard isolated `npm test` then passed 190/190. A separate single-worker isolated attempt was stopped after slow serial WSL worker startup; the default worker pool completed successfully.

## Final verification

| Command                                                                                                                                                                                                                    | Result                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `npm run openapi:lint` and `npm run openapi:check` (through `npm run check`)                                                                                                                                               | PASS                                                                     |
| `npm run typecheck`, `npm run lint`, and `npm run format:check` (through `npm run check`)                                                                                                                                  | PASS                                                                     |
| `npm test`                                                                                                                                                                                                                 | PASS; 16 files, 190/190 tests with normal isolation                      |
| `npm run test:e2e`                                                                                                                                                                                                         | PASS; 30/30 browser scenarios, including all 14 auth cases               |
| `npm run build:mock`                                                                                                                                                                                                       | PASS; 1,641 modules transformed                                          |
| `npm run build`                                                                                                                                                                                                            | PASS; 1,637 modules transformed                                          |
| `npm run check:dist`                                                                                                                                                                                                       | PASS; 96 API files, no mock fixtures, Tweaks, references, or source maps |
| `npm run check:reference`                                                                                                                                                                                                  | PASS; 11/11 original/reference pairs match hashes and byte counts        |
| `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/dominelinux/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | PASS; 67/67 viewport scenarios                                           |

The focused auth unit run passed 99/99 tests across five files; the #35 acceptance trace passed 1/1 targeted checks. The full visual suite passed 67/67 scenarios. Its auth matrix captured 65 states: 25 source comparisons and 40 product-only states; 21 source comparisons had full-page dimension differences and four had same-size non-zero pixel deltas. All 65 product screenshots and comparison metrics are retained under `visual/auth/`.

## Open and unverified

- The production common-password blocklist is not applied by the mock. The candidate data sources have unresolved rights/provenance; see [`docs/research/password-blocklist-provenance.md`](../../../../research/password-blocklist-provenance.md). Do not treat password-blocklist validation as passing.
- Real API/backend, database, session/cookie security, password storage, and HTTP registration are not implemented. API-mode auth remains `FEATURE_UNAVAILABLE` as required for Phase 1.
- Email and phone collection remain disabled. No real contact values or support address are configured; admin approval belongs to T07.
- DomineYH visual approval and local handover acceptance remain pending. Physical-device behavior and hosted CI for this unpushed worktree were not run.
