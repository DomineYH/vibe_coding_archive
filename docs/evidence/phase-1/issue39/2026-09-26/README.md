# Issue #39 local run evidence

Run date: 2026-09-26 (Asia/Seoul). Branch: `impl/issue-39`, based on `origin/main` at `f2bb531a63c2ec12e27fcda78b8847ae854321db`. This implementation uses the deterministic Phase 1 mock. No backend, database, production cookie, or real member data was used.

## Environment and scope

- Ubuntu 24.04 / WSL2 Linux x86_64; Node `22.23.2`, npm `12.0.2`; frontend dependencies were already installed.
- Playwright `1.63.0`; `.github/workflows/frontend-ci.yml` configures one worker for both browser suites. Visual Chromium: Chrome for Testing `151.0.7922.34`, DPR 1, locale `ko-KR`, timezone `Asia/Seoul`, fixed test time `2026-09-22T00:12:00.000Z`.
- Fixed visual viewports: 1440×1000, 1024×900, 768×1024, 390×844, and 360×844. Visual runs use `frontend/visual/fontconfig.conf` and `/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell`.
- Scope follows [issue #39](https://github.com/DomineYH/vibe_coding_archive/issues/39), parent Phase 1 PRD [#30](https://github.com/DomineYH/vibe_coding_archive/issues/30), and the auth/session decisions in [#7](https://github.com/DomineYH/vibe_coding_archive/issues/7), [#12](https://github.com/DomineYH/vibe_coding_archive/issues/12), [#15](https://github.com/DomineYH/vibe_coding_archive/issues/15), [#23](https://github.com/DomineYH/vibe_coding_archive/issues/23), and [#29](https://github.com/DomineYH/vibe_coding_archive/issues/29).
- Source references, visual baselines, browser/font configuration, and pixel threshold were not changed. Human UI-D, device, and local-handover acceptance remain pending.

## Implemented mock behavior

- Added flow-scoped transition IDs, strict flow/transition mappers, generated OpenAPI types, and the recovery/settle/discard/reset operations to the contract and Promise service. The API adapter remains `FEATURE_UNAVAILABLE`; no HTTP implementation was added.
- Mock flow preparation covers create, recovery-cookie issue/confirmation, anonymous-session issue, abandon-before-ready, recovery-context, recovery CSRF read, recovery-cookie rotation, and restart eligibility. The initial mock store starts with a prepared anonymous flow for the existing UI.
- Auth transitions validate the expected flow, revision, session generation, and transition sequence. A pending transition blocks a second admission. Mock time expires permits and transition-result records; the sequence gate allows tests to settle a request or release it without sleep-based ordering.
- Lost responses remain unresolved. A received session can be revealed only after its terminal result is settled. A successful session whose cookie was not received can be discarded only by its exact transition ID and matching session generation. A password change remains applied when its newly issued session is explicitly discarded.
- An unavailable result remains unresolved and blocks protected reads until an explicit flow reset and preparation of a new anonymous session. Reset preserves changed credentials and registered accounts; the developer mock reset separately restores fixtures, clock, flow history, and observation generation.
- Public browsing remains usable during uncertainty. Mock private-app and admin reads, `getMe`, and CSRF reads require a resolved, unexpired flow and a present session cookie.
- The recovery UI uses the existing auth route and `EmptyState` conventions. It offers result check, exact missing-session discard when applicable, and explicit flow reset. The member stays concealed while unresolved.

## TDD and failure/fix record

- Mapper and service tests first failed on the missing flow-state mapper/service methods; contract, generated type, mapper, and deterministic mock behavior were then added at the pre-agreed seams.
- The first focused auth run exposed old assumptions that an anonymous mock had no session generation and that logout could race an admitted transition. Tests now assert the prepared anonymous generation/revisions and explicitly settle the pending request before starting logout.
- A focused Playwright recovery run first selected a heading for the shared `EmptyState`, which exposes the message through its status region. The test was changed to use the exact main/status/button roles. The final recovery E2E selection covers lost response, two-tab settlement, missing login/password-change session cookies, and unavailable-result reset.
- OpenAPI tests were updated for the full `AuthFlowState` response and referenced CSRF parameter after the contract began requiring flow/revision/generation/transition headers.
- The first full unit run exposed migration assertions that still expected storage version 6 and a version-5 fixture carrying version-7 flow fields. The fixtures now represent their actual legacy shapes; the version-6 migration is covered directly, and the complete suite passes.

## #23 case trace

The mapping below follows the 29 event-order rows in the #23 resolution. “Mock covered” means a deterministic local-storage analogue passed; it does not prove a real browser cookie, server, database, or process guarantee.

| #23 row                                                                | Coverage in #39 | Evidence and boundary                                                                                                                                                                   |
| ---------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. First setup → anonymous → login                                     | Mock covered    | Flow create/recovery/anonymous-session preparation and subsequent login are covered by auth-service tests; no real recovery/session cookie is issued.                                   |
| 2. Two tabs begin transitions simultaneously                           | Partial, mock   | Playwright opens two same-origin tabs, gates the first login, and settles it in the other tab before release. This tests the shared mock sequence, not Web Locks or server reservation. |
| 3. Lock owner tab closes before/after admission or during hashing      | Not run         | No Web Lock, server permit, or password hashing implementation.                                                                                                                         |
| 4. Close before DB commit vs commit before response headers            | Not run         | No database transaction or HTTP response boundary.                                                                                                                                      |
| 5. Close/abort after headers while response body is arriving           | Not run         | No real response body or `Set-Cookie` delivery.                                                                                                                                         |
| 6. Old response arrives after a new login                              | Partial, mock   | The gate test settles the first transition before it can resume; delayed work after mock reset is rejected. Late cookie delivery is not modeled.                                        |
| 7. Old cookie-deletion response arrives after a new cookie             | Not run         | No real cookie creation/deletion response.                                                                                                                                              |
| 8. Successful password change but its session cookie is missing        | Mock covered    | Password-change result is unavailable to the caller, exact new session is explicitly discarded, and the changed password still signs in; service and Playwright tests cover this.       |
| 9. First recovery-cookie response loss races `ready`/`abandon`         | Partial, mock   | Issue/confirm and abandon-before-ready are exercised; loss/race of a real recovery-cookie response is not simulated.                                                                    |
| 10. Recovery-cookie rotation races auth finalization                   | Partial, mock   | Recovery proof rotates without changing the session, and rotation is rejected while an auth transition is pending. No real transaction race is exercised.                               |
| 11. Protected save while a transition is pending                       | Not run         | Protected writes are not implemented in this Phase 1 mock.                                                                                                                              |
| 12. Late ordinary request after a failed/cancelled transition          | Partial, mock   | Protected mock reads are denied while pending/unresolved; existing delayed private-detail tests cover stale reads after auth changes. No server revision rejection is proven.           |
| 13. Wrong password during reauthentication                             | Mock covered    | Reauthentication failure records a failed transition and retains the current principal/session; auth-service test asserts this.                                                         |
| 14. Reload/new tab/back/notification loss/focus return                 | Partial, mock   | Existing auth E2E covers refresh, navigation, visibility/focus, retry, and cross-tab state changes; #39 adds two-tab transition settlement. Notification loss is not modeled.           |
| 15. A → logout → A or A → B → A during an observation gap              | Partial, mock   | A → logout → A asserts identity-change revision. A → B → A and restoration of draft/admin work are not separately tested.                                                               |
| 16. Same member with revision-only change                              | Mock covered    | Auth-service test changes ordinary mock state and confirms identity metadata remains stable.                                                                                            |
| 17. Only flow ID remains and recovery proof is lost                    | Not run         | No proof-loss or protected-flow repair path.                                                                                                                                            |
| 18. Flow ID is lost but recovery cookie is valid                       | Partial, mock   | Recovery-context service returns the current flow proof metadata; there is no UI or real cookie discovery path.                                                                         |
| 19. Reset response is lost or only some targets reset                  | Not run         | Reset is deterministic and single-flow; no multi-flow partial reset or reset-response-loss simulation.                                                                                  |
| 20. Both flow ID and valid proof are lost                              | Not run         | No restricted new-visit recovery path.                                                                                                                                                  |
| 21. Transition result is unavailable                                   | Mock covered    | Result availability is distinct from terminal state; settle blocks execution but keeps the flow unresolved until explicit reset. Service and E2E tests cover the path.                  |
| 22. Permit/session/flow expiry boundary                                | Partial, mock   | Fake-clock tests cover permit expiry and existing session-expiry boundaries; no production cookie or server-flow expiry proof.                                                          |
| 23. Cookie budget, delayed arrival, or current-cookie eviction         | Not run         | Browser cookie budget and eviction are outside the local-storage mock.                                                                                                                  |
| 24. Feature blocked, storage failure, or missing secure context        | Partial, mock   | API auth remains `FEATURE_UNAVAILABLE` and existing mock-storage recovery remains available. Secure-context detection is not implemented.                                               |
| 25. Normal server restart                                              | Not run         | There is no server-side flow store.                                                                                                                                                     |
| 26. Backup restore                                                     | Not run         | No server/database backup path.                                                                                                                                                         |
| 27. Permission loss/account deletion races                             | Partial, mock   | Existing admin revocation and route-gating tests remain; an account-deletion race or server-wide session invalidation is not implemented.                                               |
| 28. No-session logout 204 while another transition result is uncertain | Partial, mock   | A no-session logout is rejected while a result remains unresolved and cannot clear it. No HTTP 204 endpoint is implemented.                                                             |
| 29. Delayed response before/after mock reset                           | Mock covered    | Existing delayed-login/reset tests and the #39 gated two-tab test reject stale work before it can change the selected state. Late cookie responses are not modeled.                     |

## Visual evidence

The complete pinned-Chromium visual run passed 72 tests with one worker. The auth visual file recorded 95 screenshots; the ten new recovery-state captures are product-only because the preserved source has no unresolved-auth screen. Existing source references, product baselines, and the zero-pixel threshold remain unchanged. The full transient run output was redirected to `/tmp/issue39-visual-results` after the worktree filesystem reached capacity; the issue-specific screenshots and filtered comparison record are saved here.

| Viewport  | Unresolved result                                       | Missing session cookie                                       |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| 1440×1000 | [PNG](visual/auth/auth-result-unresolved-1440x1000.png) | [PNG](visual/auth/auth-missing-session-cookie-1440x1000.png) |
| 1024×900  | [PNG](visual/auth/auth-result-unresolved-1024x900.png)  | [PNG](visual/auth/auth-missing-session-cookie-1024x900.png)  |
| 768×1024  | [PNG](visual/auth/auth-result-unresolved-768x1024.png)  | [PNG](visual/auth/auth-missing-session-cookie-768x1024.png)  |
| 390×844   | [PNG](visual/auth/auth-result-unresolved-390x844.png)   | [PNG](visual/auth/auth-missing-session-cookie-390x844.png)   |
| 360×844   | [PNG](visual/auth/auth-result-unresolved-360x844.png)   | [PNG](visual/auth/auth-missing-session-cookie-360x844.png)   |

The filtered per-capture metadata is in [visual-comparison.json](visual/auth/visual-comparison.json).

## Final verification

Commands ran from `frontend/` unless noted. Browser suites used one worker, matching CI.

| Command                                                                                                                                                                        | Result                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `npm run check`                                                                                                                                                                | Passed: OpenAPI lint/type parity, TypeScript, ESLint, and Prettier.                      |
| `npm test`                                                                                                                                                                     | Passed: 19 files, 245 tests.                                                             |
| `CI=true npm run test:e2e`                                                                                                                                                     | Passed: 48 tests, one worker.                                                            |
| `npm run build:mock`                                                                                                                                                           | Passed.                                                                                  |
| `npm run build`                                                                                                                                                                | Passed.                                                                                  |
| `npm run check:dist`                                                                                                                                                           | Passed: 96 API distribution files; no mock fixtures, Tweaks, references, or source maps. |
| `npm run check:reference`                                                                                                                                                      | Passed: all 11 original files match preserved SHA-256 values and byte counts.            |
| `CI=true FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" PLAYWRIGHT_CHROMIUM_EXECUTABLE=/tmp/chrome-151/chrome-headless-shell-linux64/chrome-headless-shell npm run test:visual` | Passed: 72 tests, one worker, Chromium `151.0.7922.34`, all five fixed viewports.        |

## Open and unverified

- Real API/backend, database transactions, Web Locks, real cookies/CSRF, server concurrency, response headers/body ordering, secure-context behavior, cookie eviction, restart/backup, and device-wide session invalidation were not implemented or verified.
- Hosted CI, independent code review, human UI-D/accessibility review, local handover, and release approval were not run or granted.
- No credentials, contact data, or secrets appear in screenshots or reports. The API auth adapter remains unavailable by design for Phase 1.
