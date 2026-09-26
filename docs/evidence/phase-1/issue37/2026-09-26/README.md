# Issue #37 local run evidence

Run date: 2026-09-26 (Asia/Seoul). Branch: `impl/issue-37`; base is the checked-out `origin/main` worktree. The implementation uses synthetic Phase 1 mock data. No backend, database, real cookie, production HTTP service, or real member data was used.

## Environment and scope

- Ubuntu 24.04 / WSL2 Linux x86_64; Node `22.23.2`, npm `12.0.2`; frontend dependencies were already installed.
- Playwright `1.63.0`; CI browser suites use one worker. Visual Chromium was pinned to `151.0.7922.34`, DPR 1, `ko-KR`, `Asia/Seoul`, the fixed source time `2026-09-22T00:12:00.000Z`, and `visual/fontconfig.conf` with Noto Sans CJK JP SHA-256 `b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a`.
- Fixed viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844.
- Scope follows [issue #37](https://github.com/DomineYH/vibe_coding_archive/issues/37), parent Phase 1 PRD [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30) (US-20, US-46–49, US-53), and the approval portions of [#24](https://github.com/DomineYH/vibe_coding_archive/issues/24). Password reset, reauthentication, account deletion, detailed/live health aggregation, and Phase 2–7 behavior are deferred. API auth stays unavailable in Phase 1; mocked fetch tests verify the API adapter contract, not a live backend.
- No source file, screenshot reference, generated visual baseline, lockfile, or pixel tolerance was changed. Human UI-D review and local handover acceptance remain pending.

## #24 case trace

“Partial” means only the stated deterministic mock analogue ran. It is not a pass for the complete #24 server, transaction, cookie, audit, or security guarantee. “Out of scope” is not tested and is not a failure result.

| #24 Q16 case | #37 approval slice         | Evidence and boundary                                                                                                                                                                                        |
| -----------: | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
|            1 | Partial, mock              | Service/E2E verifies explicit approval, version increment, later login, and denial of a later login after revocation. Audit atomicity and invalidation of an already active remote session are not verified. |
|            2 | Out of scope               | Password reset is deferred; no reset password, expiry, or session behavior is claimed.                                                                                                                       |
|            3 | Partial, mock              | Sequential duplicate execution returns an already-resolved result; concurrent same-key execution is a server transaction case and was not run.                                                               |
|            4 | Covered, mock              | `admin-service.test.ts` checks same-key changed approval input and version binding; API and OpenAPI tests check the explicit key/input contract.                                                             |
|            5 | Covered, mock              | Two different keys with the same expected account version resolve one approval and reject the stale competitor with `USER_STATE_CONFLICT`.                                                                   |
|            6 | Out of scope               | Password-reset races are deferred.                                                                                                                                                                           |
|            7 | Partial, approval side     | Stale approval versions conflict; reset-vs-revocation ordering and preserving reset state are deferred.                                                                                                      |
|            8 | Partial, mock              | Account versions are monotonic and stale expected versions are rejected; a full revoke/reapprove/old-request interleaving is not separately run.                                                             |
|            9 | Covered, mock              | A new same-value approval key increments the version; a stale competing key is rejected.                                                                                                                     |
|           10 | Partial, mock              | A delayed write is rejected after the admin principal/auth flow changes. Reauthentication, logout/expiry during hashing, and server-side final auth checks are not implemented.                              |
|           11 | Partial, mock              | Missing target finalizes as `USER_NOT_FOUND`; stale version conflict is tested. No concurrent delete, reset, or self-change race is implemented.                                                             |
|           12 | Partial, mock              | Login succeeds after approval and a later login is denied after revocation. Password reset and two-way login/password-change races are deferred.                                                             |
|           13 | Covered, approval analogue | A committed approval with a lost response remains `unknown` until GET returns the explicit succeeded operation. No current-state inference is used.                                                          |
|           14 | Covered, mock              | A succeeded approval result remains succeeded after a later revocation changes the current account version; replay does not reapply it.                                                                      |
|           15 | Partial, mock              | Cancel after success returns the succeeded result without rollback; cancel-first prevents later execution. Concurrent server cancel/commit ordering is not run.                                              |
|           16 | Partial, mock              | Repeating cancel returns the same canceled result. Cancel-response loss and duplicate audit writes are not implemented.                                                                                      |
|           17 | Out of scope               | Password input retention/wiping on reauthentication is deferred with password reset.                                                                                                                         |
|           18 | Partial, mock              | An expired key blocks execution with 410 and leaves the stored operation unresolved; expiry during a server-side operation is not run.                                                                       |
|           19 | Out of scope               | Database locks, hashing capacity, audit/result persistence, and rollback are not represented in the mock.                                                                                                    |
|           20 | Out of scope               | Process crash and commit-boundary recovery require a persistent backend.                                                                                                                                     |
|           21 | Partial, mock              | Non-admin access and protected admin targets are denied; multiple-admin key ownership and change-only/read-only sessions are not represented.                                                                |
|           22 | Partial, mock              | A late write cannot cross into a changed principal's admin screen. Reload/key-loss recovery and real tab/HTTP response ordering are not implemented.                                                         |
|           23 | Out of scope               | HMAC secret rotation/loss, key IDs, and backup restore are production operation work.                                                                                                                        |
|           24 | Partial, contract only     | Mappers reject contact/password fields from admin DTOs and operation results; no password reset/hash/token/log/cache path is implemented.                                                                    |
|           25 | Out of scope               | The fixture records first approval, but no 90-day deletion worker or deletion race exists.                                                                                                                   |
|           26 | Partial, mock              | Missing target is rejected without recreation. Delayed hard-delete confirmation is not implemented.                                                                                                          |
|           27 | Out of scope               | Historical reset success and password-delivery/current-validity decisions are deferred.                                                                                                                      |
|           28 | Partial, contract          | OpenAPI, generated types, mapper, mocked API headers, errors, and builds are checked. Real capability enforcement and API auth remain unavailable.                                                           |
|           29 | Partial, mock              | Stale expected versions and late auth-context changes are rejected. Operation keys are memory-only; reload/key loss is not recovered or described as prior success/failure.                                  |

## TDD and failure/fix record

- The first mapper test run was red because the new mapper functions were not present. After implementing the contract mappers, the focused run exposed an incomplete page fixture (`stats` missing and expected `total` stale); the fixture was corrected. The final targeted set passed 94/94 across five files; the added operation service checks passed 10/10.
- The first full CI-style E2E run passed 36/39 and exposed three test issues: the revocation case expected a successful login route for the intentionally rejected final login, an operation-state locator depended on a transient button label, and `page.evaluate` passed two arguments. The test now uses the login alert as the revoked-account result, observes `aria-busy`, provides a longer deterministic delayed-write window, and passes one payload object. The focused admin/auth E2E selection passed 7/7.
- The initial targeted admin visual capture passed 5/5. The first full visual run found the pre-existing auth visual case still expected the old admin placeholder; it now checks the dashboard route. The final CI-style visual suite passed 72/72. It recorded five list dimension mismatches and five product-only approval-confirmation captures. See [visual comparison JSON](visual/admin/visual-comparison.json); captures remain available for review in [`visual/admin/`](visual/admin/).

## Visual evidence

List screenshot product/source full-page heights are: 1440×1000, 1238/1111px; 1024×900, 1238/1111px; 768×1024, 1238/1218px; 390×844, 1730/2456px; 360×844, 1730/1560px. All five records say `dimensions_mismatch`, so there are no pixel counts for these comparisons. The approval panel is product-only because the available `19-admin-user-confirm.png` depicts account deletion, not approval. No source image or baseline was edited. Differences are recorded for review and are not approved here.

| Viewport  | Admin list capture                            | Approval confirmation capture                            |
| --------- | --------------------------------------------- | -------------------------------------------------------- |
| 1440×1000 | [PNG](visual/admin/admin-users-1440x1000.png) | [PNG](visual/admin/admin-approval-confirm-1440x1000.png) |
| 1024×900  | [PNG](visual/admin/admin-users-1024x900.png)  | [PNG](visual/admin/admin-approval-confirm-1024x900.png)  |
| 768×1024  | [PNG](visual/admin/admin-users-768x1024.png)  | [PNG](visual/admin/admin-approval-confirm-768x1024.png)  |
| 390×844   | [PNG](visual/admin/admin-users-390x844.png)   | [PNG](visual/admin/admin-approval-confirm-390x844.png)   |
| 360×844   | [PNG](visual/admin/admin-users-360x844.png)   | [PNG](visual/admin/admin-approval-confirm-360x844.png)   |

## Final verification

- `npm run check` — passed after the final visual assertion edit: OpenAPI lint/type parity, typecheck, ESLint, and Prettier.
- `npm test` — passed: 19 files, 220 tests.
- `CI=true npm run test:e2e -- --workers=1` — passed: 40 tests, one worker.
- `npm run build:mock` — passed.
- `npm run build && npm run check:dist` — passed; API bundle contains 96 files and no mock fixtures, tweaks, references, or source maps.
- `npm run check:reference` — passed: 11 original files match preserved SHA-256 and byte counts.
- `CI=true FONTCONFIG_FILE=visual/fontconfig.conf PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual -- --workers=1` — passed: 72 tests using pinned Chromium 151.0.7922.34 and the CI font config.

## Open and unverified

- No live API/backend, database transactions, audit events, cookies, CSRF enforcement, production auth/session invalidation, or distributed request ordering was run.
- The mock has one shared principal and cannot demonstrate invalidating a target's already-active independent session while a separate admin remains authenticated. Only later login denial is verified.
- Password reset, reauthentication, account deletion, scheduled pending-account deletion, live health probes, key-loss recovery, hosted CI, and human visual/local-handover approval remain unverified or out of scope.
- No secrets, real credentials, or personal contact data are included in this evidence.
