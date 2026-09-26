#44 local implementation evidence

Issue: [#44 administrator reauthentication, member password reset, and result recovery](https://github.com/DomineYH/vibe_coding_archive/issues/44). Parent: [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30). Decision sources: [#7](https://github.com/DomineYH/vibe_coding_archive/issues/7#issuecomment-5775997962), [#23](https://github.com/DomineYH/vibe_coding_archive/issues/23#issuecomment-5806449465), [#24](https://github.com/DomineYH/vibe_coding_archive/issues/24#issuecomment-5806786959), [#15](https://github.com/DomineYH/vibe_coding_archive/issues/15#issuecomment-5808935379), and [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29#issuecomment-5809422519).

This evidence covers the deterministic Phase 1 mock and the API contract/client boundary. It does not claim actual backend, database, password hashing/HMAC, cookie/CSRF enforcement, cross-device revocation, password delivery, production operations, hosted CI, or human UI-D acceptance. The reset and reauthentication capability flags remain disabled according to #24 case 28's phase gate.

## TDD failure history

- The password-reset mapper test first failed because the mapper did not exist. The strict result mapper now rejects unexpected secret fields and passes the test.
- The reset service flow first failed because the service/mocks lacked reset operations and result server time. The contract, adapter, state mutation, and deterministic result record were added; targeted service tests pass.
- The first browser reauthentication run lost the invalid-credential message while the auth observation changed to checking, and successful reauthentication stayed on the auth route because the mock did not rotate the session generation. The reauth card now remains mounted through observation, and the mock rotates the session generation while preserving absolute expiry and identity revision.
- The first T08 browser attempt reloaded the full document after reset. The mock intentionally keeps its emulated temporary credential in tab module memory, so the reload erased it. The scenario now logs out and switches member sessions through the SPA without reloading. The report records this mock limit.
- The first full browser run found a regression in the existing unauthenticated reauth route: it showed an admin-required error instead of the Phase 1 unavailable state. The exact test failed twice in isolation; the route now keeps the unavailable state for a ready session with no user while preserving the active-admin reauth card. The focused regression test and final full browser suite pass.
- The focused reauth/reset/unknown-response Playwright run passed all five reset scenarios. The final CI visual suite passed all 102 cases, including the five fixed viewport admin captures after capturing new states as product-only.

## #24 case trace

The statuses below are scoped to #44's mock/API/UI work. “Partial” and “Not run” are not acceptance passes.

| #24 case                                                    | #44 trace and status                                                                                                                                                                    |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Approval/approval removal normal                         | **Covered as regression:** existing admin service/E2E path remains in the full frontend suite.                                                                                          |
| 2. Password reset normal                                    | **Covered in mock:** reauthentication, target refresh, version increment, approval preservation, temporary-password login, and T08 self-change.                                         |
| 3. Same-key concurrent reset                                | **Not run:** mock does not exercise concurrent database transactions.                                                                                                                   |
| 4. Same key with different input/target/version             | **Partial:** different password returns `OPERATION_KEY_MISMATCH`; concurrent and every other mismatch dimension are not all exercised.                                                  |
| 5. Different-key approval versus revoke                     | **Not run:** cross-key concurrency is backend work.                                                                                                                                     |
| 6. Different-key reset versus reset                         | **Not run:** concurrent reset arbitration is backend work.                                                                                                                              |
| 7. Approval revoke versus reset                             | **Not run:** no concurrent cross-kind transaction test.                                                                                                                                 |
| 8. Old operation after revoke/reapprove                     | **Not run:** only a persistent server transaction can prove the full race.                                                                                                              |
| 9. New key setting the same approval value                  | **Covered as regression:** existing admin service test verifies the explicit same-value version increment.                                                                              |
| 10. Admin auth changes during hashing                       | **Partial:** delayed reset is rejected after the principal/session changes; reauth/logout/recovery/expiry during real hashing are not implemented.                                      |
| 11. Target deletion/reset/self-change during hashing        | **Partial:** missing and stale reset targets are rejected before key issue; concurrent mutation during hashing is not implemented.                                                      |
| 12. Login/self-change versus reset in both orders           | **Partial:** sequential temporary login and T08 change are covered; races are not.                                                                                                      |
| 13. Reset response lost after commit                        | **Covered in mock:** unknown remains unknown until an explicit result lookup confirms success.                                                                                          |
| 14. Success followed by later reset/change/delete           | **Partial:** reset success and following T08 version increment are covered; later reset/delete ordering is not.                                                                         |
| 15. Cancel versus success race                              | **Partial:** unresolved cancel is explicit; no concurrent success/cancel transaction race.                                                                                              |
| 16. Cancel response loss/retry                              | **Partial:** repeated cancel returns the same rejected record; response loss is not simulated.                                                                                          |
| 17. Reauthentication clears password and does not auto-run  | **Covered in UI:** invalid credentials retain the session; successful reauth returns to a fresh target read and empty form; unknown work requires explicit check/re-entry/retry/cancel. |
| 18. Key expiry boundary/during hashing                      | **Not run:** the reset-specific expiry race is not simulated.                                                                                                                           |
| 19. DB lock, hashing capacity, audit/result rollback        | **Not run:** no database or real hasher exists in Phase 1.                                                                                                                              |
| 20. Process interruption around commit                      | **Not run:** there is no persistent server transaction or crash harness.                                                                                                                |
| 21. Admin target/foreign key/ordinary/change-only/R session | **Partial:** protected admin, missing target, recent-auth, and current full-admin checks are covered; cross-owner keys and recovery-only auth are not.                                  |
| 22. Tab close/refresh/reordered response/A→B→A              | **Partial:** delayed stale-auth response is rejected; reset key loss on reload and cross-tab response ordering are not exercised as success guarantees.                                 |
| 23. HMAC secret rotation/key-id/backup restore              | **Not run:** these remain backend/operations responsibilities.                                                                                                                          |
| 24. Password normalization, error/log/cache exposure        | **Partial:** NFC/length, mapper secret rejection, and local-storage non-exposure are checked; production logs, DevTools, and runtime memory erasure are not.                            |
| 25. First approval versus 90-day deletion                   | **Not run:** automatic deletion is outside #44.                                                                                                                                         |
| 26. Delete-result delay versus admin reset                  | **Not run:** account deletion is outside #44.                                                                                                                                           |
| 27. Historical success/current version/delivery ambiguity   | **Partial:** success shows no delivery or member verification, and displays its deadline; later-version/delivery races are not.                                                         |
| 28. Capability and response contract                        | **Covered for this scope:** OpenAPI lint/generated-type checks and API tests pass; mock capability flags remain disabled at the planned phase gate.                                     |
| 29. Lost key/new explicit judgement/late old request        | **Partial:** delayed stale-auth execution is blocked; persistent old-key races after a lost key are not implemented.                                                                    |

No overall #24 PASS is claimed.

## Visual evidence

[`visual/admin-reset/`](visual/admin-reset/) contains 35 screenshots and `visual-comparison.json`. Reset/re-auth screens at 1440×1000, 1024×900, 768×1024, 390×844, and 360×844 are product-only. The admin-users view compares to preserved `18-admin-users.png`, but all five full-page dimensions differ: actual/reference heights are 1238/1111, 1238/1111, 1238/1218, 1730/2456, and 1730/1560 pixels. Those dimension mismatches report no pixel counts. No source reference, visual baseline, or threshold was changed. The run used the pinned Chromium 151.0.7922.34 and `visual/fontconfig.conf` as CI does.

## Final verification

Final CI-equivalent local run on the final source tree:

- `npm run check` — passed: OpenAPI lint/generated-contract check, typecheck, ESLint, and Prettier.
- `npm test` — passed: 21 files, 321 tests.
- `CI=true npm run test:e2e` — passed: 82 tests, one worker, including all five new reset flows.
- `npm run build:mock` — passed (Vite reported its existing >500 kB chunk-size advisory).
- `npm run build && npm run check:dist` — passed: API bundle has 96 files and excludes mock fixtures, Tweaks, references, and source maps.
- `npm run check:reference` — passed: all 11 original files match preserved SHA-256 and byte counts.
- `FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell CI=true npm run test:visual` — passed: 102 tests on pinned Chromium 151.0.7922.34.
- `npm test -- tests/admin-service.test.ts` — passed: 13 tests. The expired-recent-auth reset flow and the pre-existing unauthenticated reauth regression also passed their focused Playwright checks after their fixes.

The first full E2E run had one failure in the unauthenticated reauth route; it was reproduced twice, fixed, and the final 82-test run passed. Browser suites use `CI=true` and one worker, matching the Playwright configs and issue instruction.

## Open and unverified

- Real API/database transactions, durable idempotency/HMAC, password hashing, HTTP cookie/CSRF/Origin enforcement, multi-client races, and production auth are not implemented or verified.
- The mock credential and reset-operation binding are held in module memory. A full page reload loses the synthetic temporary credential and operation records; no credential is written to localStorage, and no server persistence is represented.
- Real target-session invalidation, delivery, current member identity verification, capability activation, and HMAC/key rotation are not demonstrated.
- Human UI-D, physical-device, screen-reader, hosted CI, and local handover approval remain pending. No push, PR, or merge is part of this work.
- The independent code review is intentionally left to the next reviewer as requested.
