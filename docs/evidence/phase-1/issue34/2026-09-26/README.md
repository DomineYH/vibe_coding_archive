# #34 local run evidence

Run date: 2026-09-26 (Asia/Seoul). Branch: `impl/issue-34`; starting commit: `6540e0995f9cf8f2d327e954964e9578e24f9f9b`. This run covers synthetic accounts and mock-only authentication/private reads. It uses no real user credentials, backend, database, or cookie session.

## Environment

- Node 22.23.2; npm 12.0.2; Playwright 1.63.0.
- Chromium 151.0.7922.34 headless-shell and the repository's pinned Noto Sans CJK JP/Pretendard fonts.
- Visual viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844; DPR 1; `ko-KR`; `Asia/Seoul`; fixed capture time `2026-09-22T00:12:00.000Z`.
- Mock accounts and private detail use only the original source fixture identities and content. Mock storage contains the principal ID, not passwords or cookies.

## Targeted implementation checks

| Check                           | Result                                                                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial TDD service test        | Expected Red before implementation: the `auth-service` module did not yet exist.                                                                                                                                 |
| Initial targeted unit run       | One assertion expected the wrong `AuthResult` shape; corrected to read `result.user`, then passed.                                                                                                               |
| First auth E2E run              | Three locator/text assertions failed; field/error selectors were corrected and the five-case rerun passed.                                                                                                       |
| Logout network-failure E2E      | Initially selected the detail loading `status` instead of the logout toast and left the active protected query pending; logout failure now restores the session/query, and the toast assertion selects its text. |
| Pending-account E2E             | First run reused the preceding `auth_network_error` scenario; reset the scenario before the approval check, then the focused rerun passed.                                                                       |
| Late private-response unit test | First run attached the rejection assertion after advancing fake time and emitted an unhandled-rejection warning; attach the assertion before advancing time, then the focused rerun passed.                      |
| Existing mock-state upgrade     | The test for the prior public-only storage version failed with `MOCK_STORAGE_ERROR` before migration; version 1 now upgrades with its public fixture preserved and no principal, and the focused rerun passed.   |
| Corrupt-storage detail E2E       | First full run stayed on the disabled detail query's pending state after auth restoration failed. Detail now shows the restoration error; the focused case and final E2E suite pass. |
| Gallery history E2E               | Back/forward restored `q` before the input sync, so its debounce cleared the route. A layout-phase sync preserves the restored filter; focused and full E2E runs pass. |
| API distribution check           | First API dist check found the mock nickname in the login placeholder. The example is now mock-only; the API build and distribution check pass.                              |
| Lint and formatting             | The first lint run flagged the control-character regex; replaced it with code-point checks. Initial format check listed changed files; formatted those files.                                                    |
| Initial visual invocation       | Failed before browser startup because the pinned Chromium environment variable was unset. Reran with the repository's pinned executable and font config.                                                         |

## Final verification

Final local verification results:

| Command                               | Result             |
| ------------------------------------- | ------------------ |
| `npm run check`                       | PASS: OpenAPI lint/check, typecheck, ESLint, and Prettier. |
| `npm test`                            | PASS: 16 files, 176 tests. |
| `npm run test:e2e`                    | PASS: 25 tests, including auth, corrupt-storage, and gallery-history regressions. |
| `npm run build:mock`                  | PASS: mock production bundle built. |
| `npm run build && npm run check:dist` | PASS: API bundle built; 96 files and no mock fixtures/reset UI. |
| `npm run check:reference`             | PASS: 11 preserved source files match by SHA-256 and byte count. |
| Pinned `npm run test:visual`          | PASS: 67 capture cases; 35 auth/private screenshots and metrics saved under `visual/`. |

## Authentication case trace

| Case                                    | Expected                                                                                                       | Local outcome                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Anonymous public read                   | Public detail remains readable without auth.                                                                   | PASS: existing public detail E2E and unit coverage.       |
| Anonymous private read and missing ID   | Both return the same 404 without showing protected content before restore.                                     | PASS: auth route E2E.                                     |
| Owner and administrator private read    | Approved owner and admin can read the source private fixture.                                                  | PASS: unit and auth route E2E, including refresh restore. |
| Other approved member private read      | Non-owner member gets the same 404.                                                                            | PASS: auth service unit test.                             |
| Existing public-only mock state         | Version-1 public state migrates to the auth-capable shape without signing in or discarding its public fixture. | PASS: mock-state validation test.                         |
| Invalid credentials and pending account | Invalid credentials return 401; correct credentials for an unapproved fixture return 403; neither signs in.    | PASS: service and E2E tests.                              |
| Authentication transport failure        | Login/logout failures remain errors; failed logout preserves the confirmed session.                            | PASS: unit and E2E tests.                                 |
| Form validation and duplicate submit    | Each required field has an associated error; pending submit blocks a second submission.                        | PASS: auth E2E.                                           |
| Return destination validation           | External, malformed, repeated-decoding, unknown, and duplicated route parameters are rejected.                 | PASS: route unit and E2E tests.                           |
| Logout and late private response        | Logout removes old protected view/cache; a late detail read is rejected after generation changes.              | PASS: cross-tab E2E and fake-timer service test.          |
| Signup and password change              | These actions remain unavailable and never report success.                                                     | PASS: auth E2E verifies unavailable state.                |

## Visual evidence and differences

The visual test captures seven auth/private states at all five fixed viewports (35 screenshots). Fifteen captures are compared with the preserved source login, login-error, and private-detail captures; twenty states without supplied references are recorded as product-only. The comparison recorded 11 full-page height mismatches and nonzero raster differences in all 15 source-reference captures. The visual runner records these differences without failing on them, so the run confirms capture coverage and leaves source-to-product fidelity approval open. Screenshots and per-capture pixel/dimension metrics are in [`visual/`](visual/). Source references and existing baselines were not modified.

The login copy now distinguishes the login ID from the public nickname, the demo card discloses mock-only credentials, and the private detail omits source edit/delete controls because app writes are outside #34. These differences are recorded in [`docs/ui-deviations.md`](../../../../ui-deviations.md); DomineYH visual/handover acceptance remains pending.

## Open and unverified

- API mode deliberately returns `FEATURE_UNAVAILABLE` for auth operations. No real backend, database, cookie/session security, or production credential handling is implemented or verified.
- Hosted CI is unverified because this task does not push or open a PR.
- Physical-device, assistive-technology, and human UI/handover acceptance remain pending.
- Signup, password change, user management, and app write actions remain out of scope and are not reported as implemented.
