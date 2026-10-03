# Phase 3 / T07 — local integration evidence (2026-10-03)

This ledger separates feasible local verification, unexecuted cases, and public acceptance. It does not close #121 or #113. Authority:
[#121](https://github.com/DomineYH/vibe_coding_archive/issues/121),
[#113](https://github.com/DomineYH/vibe_coding_archive/issues/113),
[R23](https://github.com/DomineYH/vibe_coding_archive/issues/23#issuecomment-5806449465),
[R7](https://github.com/DomineYH/vibe_coding_archive/issues/7#issuecomment-5775997962),
[R24](https://github.com/DomineYH/vibe_coding_archive/issues/24#issuecomment-5806786959),
[R9](https://github.com/DomineYH/vibe_coding_archive/issues/9#issuecomment-5778334008),
[R15](https://github.com/DomineYH/vibe_coding_archive/issues/15#issuecomment-5808935379).

Source checkout: `dabd663`, finished T06; branch `feat/issue-121-auth-integration-gate`.
T06's approved-plan inventory is refreshed against its committed
[ledger](../../issue120/2026-10-02/README.md),
[backend access contracts](../../../../../backend/tests/contracts/test_auth_access.py),
[browser access tests](../../../../../frontend/e2e-api/auth-access.spec.js).
It proves local private permission/context/activity, conceal/recheck, identity-history
isolation and recovery-rotation continuity; it does not supply missing streaming races.
T06's last targeted r2 verification was 889 unit / 23 API / 74 mock; these are
inherited results, never T07 execution counts. Its 35 capture images remain inherited.

Inherited evidence: E115=[T01](../../issue115/2026-10-01/README.md),
E116=[T02](../../issue116/2026-10-01/README.md),
E117=[T03](../../issue117/2026-10-02/README.md),
E118=[T04](../../issue118/2026-10-02/README.md),
E119=[T05](../../issue119/2026-10-02/README.md),
E120=[T06](../../issue120/2026-10-02/README.md).
B/ means `backend/tests/`, F/ means `frontend/e2e-api/`, U/ means `frontend/tests/`.
C/P/M in the inherited columns preserve the original checkpoint inventory (covered/partial/missing), not fresh PASS. Final columns and K/V command tables identify post-reboot executions. A local PASS never completes excluded execution or public/human gates.

## Execution seams and verified subset

APP_ENV=test; absolute runner-owned `/tmp` file SQLite, independent deletion ledger,
explicit migration and synthetic Argon2 fixtures. API runner performs real hidden-input
PTY bootstrap before inserting synthetic members. Ordinary restart and process drills
never reinject fixtures, rerun bootstrap or migrate. A new independent runner invocation
starts a new DB. Browser origin localhost:5174; streaming Node proxy on owned 8000,
real uvicorn on an ephemeral loopback port. Public production auth remains unavailable.
External browser egress is blocked. No cookie jar in Node forwarding; raw separate
Set-Cookie headers and original body bytes are preserved. Private Unix sockets are 0600.
No public fault routes/headers, password verifier stubs or product fault flags.
`hash_return` pauses the real worker after native Argon2 verification but before the
verifier callable returns; this is not a claim of pausing inside native Argon2 itself.
Current process tests use real HTTP client cookies; browser tests additionally assert
actual Chromium receipt, next-request Cookie names, server state and product DOM.
A test-only Vite configuration flushes copied upstream headers independently of body
and propagates upstream abortion. The checkpoint default batch incorrectly routed T01–T06 through this fault transport. Repair M2 splits ordinary, prepared T01–T06 (tests.auth_server + normal Vite), and prepared races/recovery (API_E2E_FAULTS=1) into independent runs. Each run starts with its own copy of the verified, test-owned prepared database; restart/restore drills within a run never reinsert fixtures.

Commands use the prepared blocklist and Chromium executable from the brief. Node
24.21.0/npm 12.2.0 differ from pinned 22.23.2/12.0.2, as in E120. Chromium
151.0.7922.34, ko-KR, Asia/Seoul, DPR1, reduced motion/light/sRGB; no new visual
acceptance is claimed. UV_PROJECT_ENVIRONMENT points to the prepared Linux venv;
Historical targeted runs used `python -m pytest` to avoid the copied pytest shebang pointing back to DrvFS. For the final exact `uv run --frozen pytest -q` command, only that cached console entrypoint was corrected to the prepared Linux interpreter; backend/.venv was untouched. Original
backend/.venv remains a directory. A temporary frontend dependency symlink caused
font serving refusals and was removed; original node_modules is restored.

WSL stopped twice on 2026-10-03 (11:27 and 13:51) under memory exhaustion.
The coordinator diagnosed Node 24 `assert.deepEqual(Buffer, Buffer)` on a PNG
mismatch: diff construction grows quadratically (5KB random buffers used 743MB),
exhausting 7.5GB anonymous memory and swap. Commit da53ff2 uses `Buffer.equals`
in all four evidence checkers; the same mismatch fails in 3s/157MB. Historical
logs are preserved privately in `issue121-resume-logs-crash2`. Every heavy command
in this continuation runs under `systemd-run --user --scope -q -p MemoryMax=6G
-p MemorySwapMax=512M`; browser suites remain serialized. Memory caps are never
raised to hide a failure.

| ID | Applicability / expected | Command / actual HTTP, DB, cookie, screen observation | Result |
| --- | --- | --- | --- |
| H1 | Four transport stages / original bytes and independent cookie receipt | `node frontend/scripts/test-auth-fault-proxy.mjs`: 4 PASS, 0.22s; before-forward/header/header-body/mid-body holds; two raw cookie fields; second raw request sends no Cookie. Synthetic transport self-test, not authentication proof. | PASS |
| B1 | R23-03/04/25: settle beats actual verifier; pre/post commit process death | `cd backend; uv run --frozen python -m pytest tests/test_auth_races.py tests/test_auth_retention.py tests/contracts/test_auth_flow.py -q`: 51 PASS/164.26s before the three additional permit cases. Two real workers rejected after settle; three SIGKILL orders cancel/rollback or retain success respectively. No reply cookie received after kill, state and DB agree, no reinjection. | PASS for named subset |
| B2 | R9 Q18, old S/R removal without reviving/deleting newer authority | Initial `test_auth_retention.py`: 2 FAIL/79.53s, residual rows 1 instead of 0. Minimal fix adds exact issued-name fences and removes expired/revoked generations, clearing references atomically. Migration/restart/retention: 12 PASS/29.77s; B1 includes original flow contracts. Final races+retention checks: 10 PASS/78.62s, including ±1µs actual-verifier permit checks, unknown-name preservation. The claimed newer-pending preservation did not enter the cleared-current-reference branch; independent review found H1 FAIL there. See H1 repair below. | Historical subset PASS; newer-pending claim corrected |
| E1 | R23-04/05/08: real login and own-change response loss before headers, after headers, mid-body | `npm --prefix frontend run test:e2e:api -- auth-races.spec.js auth-recovery.spec.js`: 9 PASS/1.6m. Six HTTP cases prove succeeded DB/version, genuine upstream Set-Cookie and next Cookie ingress. Missing S → unknown/exact discard/new explicit login; own-password mutation persists. Received S → hidden identity until actual result/CSRF/me recheck; full identity then restores, no replay. | PASS |
| E2 | R23-03: owner close before claim and at real verifier return | Same 9-case command: two tab cases; survivor settles stored original ID, late worker has zero full sessions, fresh explicit login succeeds. Stage state admitted/executing separately observed. | PASS |
| E3 | R23-17: simulated proof loss, ID-only restriction | Same command: clearCookies is explicitly simulated loss; eligibility false, reset 401, public-only product warning, no logout control. Not natural browser eviction. | PASS |
| B3 | R23-25/26: actual restart then SQLite snapshot restore | `cd backend; uv run --frozen python -m pytest tests/test_auth_restart.py -q`: 4 PASS/30.71s. Real process restart retains original expiry plus resolved/unresolved approval keys. SQLite backup API, deletion after snapshot in current independent ledger, stop/restore/actual `python -m app.cli invalidate-restored-auth`; restored authorities revoked and keys cleared; completed deletion replay despite newer snapshot creation time; old cookies 401, public read 200, auth capability ready only after successful drill. HTTP client; the drill directly ages the pending member with `UPDATE members SET created_at` before the real sweep-pending CLI (test clock shortcut, no member reinsertion). Browser restore evidence is historical C3 and fresh V1/V2/K5. | PASS local HTTP drill |

## First failure → correction → retest

- PR #128 CI found a pre-existing T06 POP defect (verdict 1), also present on
  main run [37091199172](https://github.com/DomineYH/vibe_coding_archive/actions/runs/37091199172);
  PR run 37107699734 failed while the same SHA passed run 37107702134.
  Unchanged local `auth-access.spec.js --grep 'focus without notification'
  --repeat-each=40` passed 40/40, wall252.57s; this did not disprove the flake.
  A deterministic browser render-task barrier reproduced the exact visible old
  private heading / zero flow-state requests. Releasing the barrier still issued
  no proof: deferred gallery PUSH and POP collapsed into the original detail
  entry before App's layout effect observed the intermediate entry. A separate
  committed-gallery / held-real-POP-response probe kept protected DOM absent.
  The retained adjacent regression holds rendering across PUSH/back, requires
  the old heading absent immediately after POP, then holds the genuine server
  proof response and checks absent heading/link/body text plus exactly one proof
  before and after release. Memory-guarded `npm --prefix frontend run
  test:e2e:api -- auth-access.spec.js --grep 'POP during deferred'
  --repeat-each=40`: RED 40 FAIL/189.74s → GREEN 40 PASS/213.08s (wall times).
  Frontend source at RED matched main `3db0f4d`. Test commit `03a13a0` precedes
  separate product commit `38b8710`: `RouterProvider useTransitions={false}`
  makes each history entry commit so App observes and rechecks it. No sleeps,
  retries, raised deadlines, relaxed counts, baseline changes or push.
  Required checks ran serially under MemoryMax=6G/MemorySwapMax=512M:
  original case with `taskset -c 0` / `--repeat-each=40` 40 PASS/286.68s;
  `npm --prefix frontend test` 894 PASS/126.98s; `npm --prefix frontend run
  check` PASS/50.81s; full no-arg `test:e2e:api` 189 PASS/29 existing SKIP,
  wall745.91s (53 unavailable + 53 prepared functional + 20 normal captures +
  43 fault functional + 20 recovery captures). Full mock `test:e2e` with the
  temporary pinned-browser config: 124 PASS/318.23s; config removed.
  Full default `test:visual`: 32 PASS/16 FAIL/83 NOT RUN, wall563.13s,
  **environment-BLOCKED**. Liberation Mono is absent; the existing font guard
  observed DejaVu Sans Mono instead, preventing 83 gallery cases. The other
  15 failures are historical app-create/edit/private-detail 0px comparisons.
  Auth/admin subset passed 10/10 within that same full invocation. CI supplies
  the required font through Playwright's dependency installation; **CI full
  visual is pending and remains the authoritative gate**, not a local PASS.
  Detached pre-fix `03a13a0` ran `test:visual -- visual/app-create.spec.js
  --grep 'app registration form|app edit form|private app detail after owner
  update'`: identical 15 FAIL/wall103.47s. All 15 actual PNGs were byte- and
  SHA256-identical to fixed `38b8710`; no regression candidate. The table shows
  the common baseline differing-pixel count on both sides; each cell's actual
  PNG matched byte-for-byte. Classify all 15 as missing-Liberation / DejaVu
  fallback environment failures, not caused by the POP repair. No fonts were
  installed/downloaded. The detached worktree was removed; all 77 API and two
  visual generated tracked PNGs were restored by explicit path.

  | Viewport | Registration: pre-fix = fix | Edit: pre-fix = fix | Private detail: pre-fix = fix |
  | --- | ---: | ---: | ---: |
  | 1440×1000 | 2544 | 13457 | 12596 |
  | 1024×900 | 2544 | 13880 | 12222 |
  | 768×1024 | 2544 | 16190 | 12838 |
  | 390×844 | 2543 | 8592 | 11886 |
  | 360×844 | 2424 | 7457 | 11773 |

- WSL memory failures at 2026-10-03 11:27 and 13:51 interrupted the earlier
  attempts. The coordinator's verified diagnosis was Node24 deep Buffer diff
  construction on PNG mismatch (quadratic allocation; 7.5GB anonymous memory,
  no free swap). Repair da53ff2 uses Buffer.equals in all four checkers; the
  same mismatch fails safely in 3s/157MB. The reset screenshot mismatch was
  then diagnosed/fixed test-first below. This continuation kept every heavy
  command inside MemoryMax=6G/MemorySwapMax=512M and serialized browser suites;
  no scope was killed or cap raised. Earlier crash logs remain historical.
- Final one-pass API regression: unavailable fixture 52 PASS/29 pre-existing
  SKIP/1 FAIL, wall164.70s. The gallery-zero-result fixture guard still required
  `temp-root/api.sqlite3`, while independent runner phases use `run-N/api.sqlite3`.
  Failure occurred before opening/mutating SQLite; later prepared phases were
  NOT RUN in this failed invocation. A minimal actual inline-CLI guard probe was
  also RED on the runner's valid nested path. The runner now passes its mandatory
  actual mkdtemp root. The guard requires APP_ENV=test and absolute root/database,
  resolves both realpaths, validates the temporary-root location/prefix, and
  requires exact root-relative `run-<ASCII digits>/api.sqlite3`. Missing root,
  outside-root paths, symlink escapes, relative paths, wrong names and extra
  depth are rejected before mutation; ten boundary probes PASS and rejected
  databases remain unchanged. Browser retest: `npm --prefix frontend run
  test:e2e:api -- --auth-unavailable gallery-zero-result.spec.js --grep 'default
  zero result keeps reset available'`: 1 PASS/39.3s, wall47.01s/maxRSS199888KB.
  All commands memory-capped. No environment opt-out or product change.
- Final one-pass full mock: 122 PASS/2 FAIL, wall356.10s. One initial admin
  navigation hit the unchanged 30s deadline; the combined journey's user list
  remained loading after cross-tab activity with its clock paused. Focused retests and the clock fix are recorded below; final K6 passed
  124/124, wall323.04s. The historical 122-case subset remains a failed run.
  Final auth/admin visual: 9 PASS/1 FAIL (1024×900 cumulative 60s deadline),
  wall343.96s. The unchanged focused 1024×900 case then passed (44.8s,
  wall54.47s/maxRSS438812KB); final unchanged full K7 passed 10/10, wall297.56s,
  including 1024×900/42.2s. No deadline extension or comparison change.
  The original deadline event is recorded without claiming a measured cause.
  The full backend passed 347/612.94s (wall614.82s), unit passed 889/144.05s
  (wall153.61s), static check passed/wall74.06s, both builds/dist/reference
  passed. These do not override the browser failures. Generated PNGs outside
  issue121 were restored by explicit paths after API and visual commands
  (77 then 2); repeat cleanup is required after subsequent runs.
- Frozen-clock mock regression: unchanged focused admin/combined-journey command
  reproduced 1 PASS/1 FAIL, 39.9s (wall41.66s). The admin navigation passed
  unchanged; its earlier deadline failure was not reproduced. The combined
  journey's original member-count assertion failed again while the list stayed
  loading. A clock-turn wait restored that row, exposing the same queued refresh
  at the final statistics assertion (1 PASS/1 FAIL, wall34.06s). Both points now
  use the existing `waitForVisibleAfterClockTurn` helper to advance the paused
  test clock until the actual row/statistic is visible; original count/value
  assertions remain. Focused retest 2/2 PASS, 25.5s (wall27.24s/maxRSS295244KB):
  `npm --prefix frontend run test:e2e -- --config=playwright.resume-121.config.js
  e2e/admin-apps.spec.js e2e/issue-49.spec.js --grep 'admin can edit and delete|signup
  through approval'`. This is existing mock-only regression, not implementation
  of Phase 4–5 API features. No product, deadline, retry, tolerance or baseline
  change. Final full K5/K6/K7 passed with these harness corrections.

- Default API second attempt exposed the cookie-budget setup race:
  unavailable 53 PASS/29 existing SKIP → normal prepared 52 PASS → normal
  captures 20 PASS → fault functional 42 PASS/1 FAIL (409 expected, 201 received),
  wall697.65s; final fault captures NOT RUN. Exposing log:
  `issue121-resume-logs/api-cookie-budget-red.log` (private durable coordinator
  cache). Six unchanged focused diagnostic repetitions passed (35.6s,
  wall44.11s); these do not negate that failure or configure retries.
  T07 #113 I20 / #121 / R23-23 requires counting observed names plus the new
  credential: eight existing names forbid issuance (409), seven permit an eighth
  (201), with only observed permanently invalid names deleted.
  An observable barrier on the actual gallery route-entry `/auth/csrf` read
  forced its original request to reach the server after the first rotation,
  then delivered its genuine 200/deletion reply after test-side reinsertion.
  Exact eight-name browser jar became seven; proxy ingress independently
  observed those same seven names. The unchanged 409 assertion failed with 201
  deterministically (7.0s, wall23.21s/maxRSS203064KB;
  `budget-ordering-red-6.log`). This directly demonstrates a cleanup/reinsertion
  fixture race, and 201 in that observed state satisfies the contract.
  Earlier diagnostic barriers stopped at member-header readiness or selected
  recovery-only reads returning 401 with no cleanup; those unsuccessful setup
  probes are preserved as `budget-ordering-red.log` and `-2` through `-5`, and
  are not product failures. The original full run did not record its exact jar
  or ingress: attribution of that historical request remains unverified; it is
  not labelled a flake or evidence of an eight-name product-budget violation.
  Fix is local to the budget test: observe the gallery URL, rendered link and
  restored member header before fixture setup; assert the exact cookie names
  immediately before every rotation and independently at proxy ingress. Both
  eight-name requests still require 409/AUTH_COOKIE_BUDGET_EXCEEDED, exact old-R
  deletion and unknown-name retention; only the observed seven-name request
  requires 201. Focused GREEN 1 PASS/16.8s, wall24.08s/maxRSS233328KB
  (`budget-precondition-green.log`); configured lint/format PASS. No product,
  budget, status set, retry, sleep or deadline changes. Final no-argument K5
  passed 188 cases/29 existing unavailable-boundary skips across five phases
  53→52→20→43→20 (wall763.71s), with this budget case PASS/2.9s and exact
  pre-request/ingress names. Its checker independently matched all forty
  committed captures and the complete capture-reproducibility.json.

- Retention product defect: cleanup only removed credentials when retiring the entire
  flow. Live flow with expired full S and old rotated R violates R9 Q18. The migration
  stores only exact `(flow_id, kind, issued_seq)` fences, no token/hash/CSRF/member data;
  flow retirement cascades these fences into the existing permanent retired-flow fence.
  No maximum-sequence inference, TTL change or wildcard cookie deletion. Obsolete
  cleanup initially canceled a newer admitted transition in the cleared-current-reference branch (af41348 regression, H1); the checkpoint assertion failed to exercise that branch. Repair uses save_flow only, without terminalizing or revision changes. Unknown cookie names remain retained.
- Process assertion initially expected 409 after a committed/no-cookie restart, but
  the revoked departing S correctly returns 401 before stale-transition validation.
  Corrected stage-specific expectation; B1 retest PASS.
- Initial API 3 PASS/6 FAIL (1.6m): Vite buffered header-only responses; first ingress
  selected a preflight request; password discard remained on the restricted route;
  ID-only warning text was different. Test transport flush, last actual ingress and
  real route/warning corrected. No product UI changes, timeout/retry changes or skips.
- Diagnostic 3 PASS/6 FAIL (3.6m) included a schema edit during live runs: old DB/new
  CLI head mismatch and process startup mismatch make those diagnostic runs invalid.
- Temporary frontend symlink diagnostic 4 PASS/5 FAIL (2.8m): fonts outside Vite's
  allowed roots, cold-page deadlines, and received-cookie UI expectation too strict.
  Original dependency directory restored. Received-cookie success is accepted only
  after actual server recheck, not by treating aborted bodies as success. Focused
  old-expectation run also failed 1/19s; final E1 all 9 pass, no relaxed assertions.

## Continuation evidence (2026-10-03)

C1–C6 are pre-reboot historical T07 observations; fresh final commands/results are K1–K11 and V1/V2 below. Commands use the prepared environment above. Published observations include only
states, counts, revision/generation relationships and cookie names/attributes;
values, passwords, CSRF, contact fields, raw DB/HAR/traces are excluded.

| ID | Scope / command | HTTP / DB / cookie / product-screen observations | Result |
| --- | --- | --- | --- |
| C1 | `node frontend/scripts/test-auth-fault-proxy.mjs` | Four stream barriers; original separate Set-Cookie; exact retained-response duplicate sent without another upstream request; no proxy jar; dropped before_forward has zero upstream ingress | PASS 5/5, 0.15s |
| C2 | `cd backend; uv run --frozen python -m pytest tests/test_auth_races.py tests/test_auth_boundaries.py tests/test_auth_restore_negative.py tests/test_auth_retention.py -q` | Real Argon2; login/password process death at hash-return/precommit/committed; both R-rotation worker orders; permit/temp final recheck; anonymous/full/change_only/flow and 8h activity/result ±1µs; live-flow sweep fences; missing/corrupt/stale ledger/current-reference/audit failures; real DB-lock readiness loss and reconciliation | PASS 45/45, 281.13s; no skips |
| C3 | `npm --prefix frontend run test:e2e:api -- auth-races.spec.js auth-races-orders.spec.js auth-recovery.spec.js auth-recovery-members.spec.js auth-recovery-process.spec.js auth-recovery-boundaries.spec.js auth-recovery-captures.spec.js` | Streaming real upstream cookies + next ingress; pre-admission/page close; exact discard; late and duplicated old S/R; exact logout deletion; member proof loss/partial reset; cookie budget; two tabs; no-S logout; CLI/admin and signup/private journeys; real browser restart/restore. Normal T01–T06 transport is separate from fault specs; each Playwright phase uses its own prepared DB copy. Restart/restore within a phase never reinjects fixtures. Historical latest fault functional batch 43 PASS/3.0m; capture stabilization 20 PASS/59.5s. Fresh complete V1/V2 results below | Historical named subsets PASS; fresh final default K5 below |
| C4 | `npm --prefix frontend run test:e2e:api -- auth-recovery-boundaries.spec.js` (also selected by default final run) | Browser server-authoritative anonymous 15m, full idle 30m and flow/R 30m at −1µs/equal/+1µs; no expired member display | PASS 12/12 within the current 43-case fault batch (3.0m). The spec is committed with this entry; earlier uncommitted 9-case evidence was not reproducible from 1f3d603. Browser change_only setup is explicitly synthetic member-row fixture; HTTP login and expiry observation are real. |
| C5 | `node frontend/scripts/check-auth-integration-evidence.mjs` | Forty new product-only frames, eight states × five viewports; byte comparison, SHA256 and dimensions; inherited source/UI comparisons retained; no baseline or tolerance mutation | 40 preliminary frames committed with their capture spec/helpers/checker; 20 capture cases PASS/59.5s. Historical preliminary capture state; fresh V1/V2 checker comparisons below |
| C6 | Final integration command table below | Full backend once; frontend unit/static; default unavailable + prepared + captures; affected mock; auth/admin visual; mock/API builds, dist/reference | Backend full once 346 PASS/1060.45s (no skips); ruff check/format PASS (59 files); frontend unit 889 PASS/195.78s; full check PASS, targeted changed JS lint/format PASS. Historical checkpoint; fresh final K1–K11 below |

Browser cookie deletion/profile merging/late replenishment via browser APIs is
**simulated loss/eviction/arrival**, never proof of natural browser eviction.
Proxy duplicate delivery uses the genuine saved upstream header/body bytes,
not fabricated cookies or another execution. Network/reset capture faults using
route.abort are **UI-only**; actual committed-loss tests are C3. In fault-server processes, asyncio.sleep is replaced process-wide: the periodic
maintenance loop runs only when a test explicitly ticks the private event. It does
not run automatically every 60s in those processes. Normal tests.auth_server/product
processes retain the unchanged periodic loop; fault-process tests are not scheduler
wall-clock evidence. Ticks advance the private event, not the product interval.
Real restart/restore: same SQLite and independent ledger/browser jar; no fixture,
bootstrap or migration reinjection. Snapshot uses SQLite backup API; restore is
stop → operational DB only → actual invalidate-restored-auth CLI → start/readiness.

First failures → corrections → verification (test/harness, no new product fix):

- First expanded backend: 14 PASS/4 FAIL, 232.60s. Old CSRF is rejected 403
  before revision validation; assert that exact code. Fixture expiry now uses
  canonical microseconds. Retest 7 PASS/83.39s; complete C2 PASS.
- First boundary/negative: 16 PASS/1 FAIL, 137.78s. R rotation advanced revision;
  update the HTTP client context before me. Full-boundary retest 3/18.23s.
- Absolute cutoff first run: 4 PASS/2 FAIL, 41.68s. T06 private expiry is the
  same concealed 404 as no authority; me independently asserts 401. C2 PASS.
- Early browser attempts: first 0/4 (navigation/header shape), then 7/10,
  then 11/12, then 21/23. Recovery endpoints forbid an extraneous S generation;
  use recovery-only headers. A delayed UI request owns the Web Lock: late reply
  tests now retain a real raw browser request, allowing a newer explicit journey.
- Full R-loss reload of a private screen legitimately extended idle activity;
  observe rotation from auth screen before subsequent protected activity instead.
- Profile reset must start on auth, since successful login returns to public gallery.
  A POSIX SIGKILL sets signalCode, not exitCode: lifecycle checks both. Split stopped
  restore and subsequent start into separate private commands; preserve timeout.
- Temporary dependency symlink caused unsupported Vite font paths/stuck auth;
  restored original frontend/node_modules immediately. No symlink retained.
- All initial failure artifacts are transient and excluded; final counts below
  supersede diagnostic runs without deleting this failure history.

## R23 §8 requirement inventory

Rows are in source order; R23-01…29 are local ledger identifiers. The inherited/expected columns preserve checkpoint requirements; current verdicts below cite fresh K1/K5/K6 and V1/V2. K1 runs every B/ file listed here; K5 runs ordinary unavailable, normal prepared and fault prepared browser seams separately. PARTIAL/NOT RUN cases are not converted to PASS.
| Case | Inherited checkpoint inventory / applicability | Expected verification | Final local verdict / current evidence / remaining owner |
| --- | --- | --- | --- |
| R23-01 Preparation → anonymous → login | C: E115/E116; B/contracts/test_auth_flow.py `test_prepare_requires_recovery_receipt_before_admission`; F/auth-prepare.spec.js actual preparation; F/auth-login.spec.js login/refresh/logout | Reuse journey: ID persisted before R, actual R receipt before permit, one execution, next request proves new S before private display. Extend end to T06 detail, not duplicate primitives. | LOCAL PASS — K1 flow contracts; K5 auth-prepare/login/lifecycle/access: actual R receipt, signup/approval/private refresh/focus/logout. |
| R23-02 Two tabs start transitions | P: E115; F/auth-prepare.spec.js `two real tabs serialize preparation`; B/contracts/test_auth_flow.py concurrent execution | Two member transitions in one browser context; first owns lock, second waits and reads server state; duplicate raw HTTP rejects atomically. Shared storage alone is insufficient. | LOCAL PASS — K5 auth-races-orders two-tab lock and duplicate admission; K1 flow concurrent execution. |
| R23-03 Lock-owning tab closes before admission / after admission / during hashing | M: no committed browser stage matrix; E116 B/contracts/test_auth_login.py settle-during-hashing supplies only a primitive | Real page close at each barrier, surviving tab settles/checks the original ID, late executor cannot commit after fencing. Lock release is not completion proof. | LOCAL PASS — V1/V2/K5 auth-races/orders: pre-forward, admitted and hash_return owner close, survivor fence and worker-win orders for login/password. hash_return is after native Argon2, not an in-native pause. |
| R23-04 Before DB commit termination versus committed/no headers | P: E116/E117/E119; F/auth-login.spec.js committed-login loss; F/auth-password.spec.js committed-change loss; F/admin-approval.spec.js lost approval | Add real process/transaction interruption before commit and explicit after-commit barrier; distinguish tab close from process death. Successful commit remains succeeded despite delivery loss. | LOCAL PASS — K1 test_auth_races real SIGKILL at hash_return/before_commit/committed for login/password; V1/V2/K5 genuine committed no-header delivery. |
| R23-05 Headers received then body interrupted/abort | M: no streaming browser case in E115–119 | Deliver actual Set-Cookie headers, stall/chop body, close/abort; inspect subsequent cookie ingress and server result. Never infer rollback from body failure. | LOCAL PASS — V1/V2/K5 auth-races login/password before_headers/after_headers/mid_body: DB success, real Set-Cookie, next Cookie ingress and concealed/rechecked product. |
| R23-06 Old response arrives after new login | P: E115 B/contracts/test_auth_flow.py `test_current_s_never_falls_back_to_old_cookie_or_string_maximum`, retired IDs; E116 response loss | Deliver old S and R response bytes after newer generation; duplicate delivery cannot replace current authority; absent current cookie must not fall back. | LOCAL PASS — V1/V2/K5 auth-races-orders delayed/duplicated original login S and rotated R; current selection preserved, absent-current branch in K1 flow contracts. |
| R23-07 Old deletion response arrives after new cookie | M: attribute/unit deletion checks in E115 are not this browser ordering | Delay genuine deletion Set-Cookie until new S/R installed; only exact old names deleted; new selected cookies still sent. | LOCAL PASS — V1/V2/K5 auth-races-orders genuine old logout deletion after newer cookies, exact names only. |
| R23-08 Password-change success, result S not received | C: E117; F/auth-password.spec.js `committed change with no reply...`; B/contracts/test_auth_flow.py exact-result discard | Preserve existing full chain: committed password unchanged, only its missing result S discarded, new password login works. Extend delayed-old-generation interaction rather than reimplement. | LOCAL PASS — V1/V2/K5 auth-races/password: committed password persists, exact missing result discarded, explicit new login; K1 final-check/death orders. |
| R23-09 First R loss and ready/abandon race | P: E115; F/auth-prepare.spec.js R loss before ready; B/contracts/test_auth_flow.py `test_ready_receipt_and_never_ready_abandon_are_atomic` | Real browser and competing HTTP, both commit orders; late old R cannot activate new flow; abandon only never-ready. | LOCAL PASS — V1/V2/K5 auth-races-orders ready/abandon both orders; K5 auth-prepare R-before-ready loss, no transition; late R does not replace selected flow. |
| R23-10 R rotate versus auth final commit | M: E115 tests rotation, E116/E117 test final checks separately | Both serialized outcomes with real hashing and delayed finalization: rotate first fences pending; auth first makes old rotate stale; successful password change never undone. | LOCAL PASS — K1 test_auth_races worker/rotate × login/password both orders; V1/V2/K5 actual late old R delivery. |
| R23-11 General save during pending transition | P: E119 B/contracts/test_admin_approval.py authority checks; T06 inherited protected reads | Use actual Phase 3 approval/key operations, not out-of-scope app CUD: pending blocks start/final mutation; 409, no automatic replay; safe explicit recheck. | LOCAL PASS at HTTP/DB seam — K1 test_auth_write_fence: pending blocks key admission and original approval execution; no mutation/replay. K5 protected concealment/explicit admin confirmation; archive-app CUD N/A Phase 4–5. |
| R23-12 Late general request after transition failure/cancel | P: E115 primitive fencing, T06 inherited access/late-response tests | Keep S same, increment revision by failed/cancelled transition, deliver old detail/approval request and response; reject stale context without adopting latest headers; eligible drafts need continuity proof. | LOCAL PASS at HTTP/DB + observation seams — K1 test_auth_write_fence cancelled same-S old approval revision rejected, key preserved until explicit fresh request; auth_access failed/cancelled old read 409. K5 delayed real detail response excluded. |
| R23-13 Bad administrator reauthentication password | N/A actual execution: E119 capability gate; Phase 5 administrator reauth owner | Keep capability false and existing mock regression; do not claim real 401 reauth behavior implemented. | N/A execution — Phase 5 reauth owner; K5/K6 false-capability/mock guards are regression evidence only, never actual reauth PASS. |
| R23-14 Refresh/new tab/back/missed notification/focus | P: E116 refresh, E115 abort-old-GET, existing mock auth; E120 (committed T06) adds private behavior | Integrate actual T06 detail into all restore paths incl. pageshow/BFCache where available, no protected prepaint; failed recheck stays concealed. | LOCAL PASS for K5 refresh/history/focus/missed-notification and synthetic pageshow conceal/recheck; real BFCache NOT RUN (default Playwright disables cache; existing harness does not prove admission). G09/device owner. |
| R23-15 Observation gap A→logout→A / A→B→A | P: E117 F/auth-password.spec.js own-password draft discard; E120 (committed T06) general draft/cache | Complete private-cache and admin-pending-work cases in actual same-context tabs; same final ID does not resurrect stale work when identity revision changed. | LOCAL PASS — K5 auth-access actual admin pending intent: recovery rotation preserves identity continuity, logout/same-admin discards it; shared-cookie A→B excludes delayed material. K3 isolation/continuity covers A→logout→A/A→B→A drafts. |
| R23-16 Revision-only same-member failure/reauth | P: existing mock recovery/drafts via E115/E119; E120 (committed T06) continuity predicate | Actual failed/cancelled transition without identity change preserves eligible hidden memory draft after recheck. Reauth execution branch N/A Phase 5. | LOCAL PASS for generic continuity — K1 failed/cancelled same-S stale read fenced; K5 real rotation keeps eligible admin intent; K3 hidden drafts. Actual reauth execution N/A Phase 5. |
| R23-17 ID only, proof lost | C local: E115; F/auth-prepare.spec.js `ID only keeps the active flow...`; B/contracts/test_auth_flow.py recovery separation | Preserve public-only/no destructive reset/no member discovery. Couple expiry/eligibility branch to boundary suite; no unsupported assertion that ID authorizes state. | LOCAL PASS — V1/V2/K5 recovery ID-only reset401/eligibility false/public-only; K1 flow expiry/eligibility. Proof loss is simulated. |
| R23-18 ID lost, recovery proof valid | C local: E115; F/auth-prepare.spec.js `lost ID discovers proof...` | Discovery → stored original targets → explicit reset, no auto member restoration. Retest with member-origin state in T07 recovery journey. | LOCAL PASS — V1/V2/K5 full-member ID-loss discovers exact original targets, explicit reset only; no implicit member restoration. |
| R23-19 Reset response lost / multiple targets partially done | C local: E115; F/auth-prepare.spec.js `partial reset keeps every original target after committed response loss` | Retain original target list and eligibility recheck; member-context extension must not include a newer flow or prepare before all original targets are eligible. | LOCAL PASS — V1/V2/K5 member-origin original-target partial reset after genuine committed response loss; K5 auth-prepare anonymous branch. |
| R23-20 ID and valid proof all lost | P: E115 describes anonymous full-loss contract; no complete previous-member private-state chain | Clear ID and all proof, leave delayed old response queued: restricted new-visitor behavior, old work outcome remains unknown, old protected state discarded, late old flow isolated. | LOCAL PASS — V1/V2/K5 full-member total simulated loss discards private state, selects new visitor flow, real delayed old S remains isolated; no inference about lost old result. |
| R23-21 Result 30-minute unavailable / within-one-hour deletion then late request | P: E115 B/contracts/test_auth_flow.py `test_settle_before_admission_fences_unknown_and_unavailable_is_not_failure`, retired IDs | Advance controlled clock, query unavailable with execution_blocked both false/true as appropriate, sweep, replay old ID; current revision fence survives record deletion. Browser distinguishes unavailable from failed. | LOCAL PASS — K1 result −1µs/equal/+1µs and one-hour sweep retain revision fence; V1/V2/K5 unavailable execution_blocked false/true requires explicit settlement and never means failure. |
| R23-22 60-second permit / departure S / flow expiry | P: E115/E116/E117 exact-time contracts and final-check races | Add actual delayed HTTP finalization at before/equal/after boundaries and assert DB/cookie/UI result; browser timer never grants authority. | LOCAL PASS at named seams — K1 actual verifier permit/temp finalization and anonymous/full/change_only/flow/activity/results boundaries; V1/V2/K5 twelve browser server-time expiry cases. No browser timer grants authority. |
| R23-23 Cookie budget/late arrival/current eviction | P: E115 B/contracts/test_auth_flow.py budget/observed-reduction/late-cookie tests; E117 budget-before-hash | Browser 8-cookie/2KiB issuance budget, precise invalid-name deletion and re-observation, unknown names retained; current S removed and late S/R delivered. Deterministic clearCookies is simulated eviction, not proof of physical-browser eviction policy. | LOCAL PASS for deterministic 8-name/2KiB contract, exact cleanup/re-observation/late genuine cookies and simulated S loss — K1 flow/password/retention, V1/V2/K5 recovery-members/orders. Natural browser eviction NOT RUN; G09 owner. |
| R23-24 Feature/storage/SecureContext failures | P: E115 F/auth-prepare.spec.js blocked storage/Web Locks; actual six-environment SecureContext not run | Add Fetch/AbortController/storage-event failure cases where absent, distinguish unsupported from network failure; public remains usable. Real devices remain public gates. | PARTIAL — K5 blocked Web Locks/storage and StorageEvent/ineffective AbortController paths keep public reads; K3 runtime guard regression. Missing-Fetch browser execution NOT RUN: removing Fetch also disables public API transport, no alternative transport in existing harness. Actual SecureContext/primitives G01–G09 NOT RUN. |
| R23-25 Normal restart | P: E115/E116 B/test_auth_restart.py and B/contracts/test_auth_flow.py startup reconciliation | Existing TestClient restart/synthetic executing row is not process-crash browser proof. Kill actual server with pending and succeeded flows; same DB/browser cookies, no fixture reinjection; cancelled/fence, original valid S and clocks preserved. | LOCAL PASS — K1 process pending→cancelled and success/S/original clock/key preservation; V1/V2/K5 browser same jar after SIGKILL. Fixture/bootstrap/migration reinjection false. |
| R23-26 Backup restore | P: E115 CLI invalidation; E118 B/test_pending_retention.py replay/ledger/readiness; E119 restored business keys | One integrated real-process restore drill using SQLite backup, current independent deletion ledger, CLI, readiness and actual pre-backup browser cookies; host operating drill remains gate. | LOCAL PASS — K1 restart/negative restore and V1/V2/K5 browser snapshot→current independent ledger→stop/restore/invalidate CLI→readiness/old-cookie rejection/redeletion. Pending created_at directly aged; host operation G12 NOT RUN. |
| R23-27 Authority loss/revoke/delete/reset races | P: E116/E117 final checks; E119 B/test_approval_races.py revocation while hashing and F/auth-lifecycle.spec.js old-S rejection | Browser/HTTP revoke vs login/password/private read, both legal ordering outcomes; verify all old sessions rejected after reapproval. Account deletion/general-member reset execution N/A Phase 5. | LOCAL PASS for Phase 3 authority checks — K1 auth_login/password final snapshot guards, approval_races revoke during real hash, auth_access private read/revoke both orders; K5 two-device revoke/reapprove rejects all old S. Account deletion/member reset/admin reauth N/A Phase 5. |
| R23-28 No-S logout 204 while other result unknown | P: E115 B/contracts/test_auth_flow.py `test_no_session_logout_is_origin_only_and_not_a_settlement` | Real browser with unknown original operation and S absent: 204 does not erase original transition evidence; explicit reconciliation still required. | LOCAL PASS — V1/V2/K5 recovery-members real no-S logout204 retains unknown original operation; K1 flow contract verifies it is not settlement. |
| R23-29 Mock reset versus delayed response | C, mock only: E115/E119 mock regression; `frontend/e2e/auth-recovery.spec.js`, U/auth-service.test.ts | Retain reset coverage incl. late responses, mock-only storage cleared and API flow key preserved. Never count it as actual S/R cookie race evidence. | MOCK REGRESSION PASS only — K3 auth-service delayed-login/registration-after-reset tests and K6 full auth-recovery suite; API flow key retained. Never actual cookie race evidence. |

## I01–I24 (#113)

| Requirement / applicability | Inherited test, expectation and command locator | Final Phase 3 local verdict / remaining scope / owner |
| --- | --- | --- |
| I01 identity/normalization | C: E115/E118; B/test_auth_migrations.py, B/contracts/test_auth_register.py normalization/unique-ID/duplicate-nickname. Preserve owner IDs and DTO privacy in T06 integration. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I02 new password policy | C: E117/E118; B/contracts/test_auth_password.py whole-blocklist policy, B/contracts/test_auth_register.py, F/auth-password.spec.js confirmation unsent. R15 rights are separate gate. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I03 unapproved signup/history | C: E118/E119; B/contracts/test_auth_register.py, B/contracts/test_admin_approval.py; F/auth-lifecycle.spec.js. No auto-login/old-session revival. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I04 full/anonymous lifetimes and devices | P: E115/E116 B/contracts/test_auth_login.py 8h/idle, B/test_auth_restart.py, F/auth-login.spec.js other-device logout. T06 activity plus real restart remains. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I05 temporary/change_only | C for existing local slice: E117 B/contracts/test_auth_password.py short expiry/final checks; F/auth-password.spec.js. Add streaming/death ordering only. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I06 activity/revoke/public preservation | P: E116/E119 contracts/old live-S revocation; T06 adds permitted screen activity. Re-run clocks, all devices, old-S reapproval, public ownership/content. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I07 Origin/CSRF | C local: E115 B/contracts/test_auth_flow.py origin/referrer/non-ASCII tests; E119 approval proof. Host origin/proxy gate separate. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I08 login/signup authenticated conflict; 401 semantics | C Phase 3: E116/E118 B/contracts/test_auth_login.py and test_auth_register.py; F/auth-login.spec.js. Actual administrator reauth is excluded. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I09 rate limits/dummy hashes | C local: E116 B/test_auth_limits.py and bad-hash tests; E118 registration last-slot test. Fast hasher in limit tests is explicitly limited to counters; actual Argon2 evidence is separate. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I10 16KiB/hash pool/controlled saturation | P: E115–E119 size tests, B/test_auth_limits.py gate and five-second DB_BUSY. Local bounds covered; operating-host measurement NOT RUN. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I11 administrator CLI | C local: E117 B/test_admin_bootstrap.py actual PTY/atomic audit; F/auth-password.spec.js real bootstrap/recovery journey. Operating-account execution not authorized. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I12 recent-auth/Phase 5 scope | C Phase 3 gate only: E117 recent_auth start; E119 approval without recent-auth and false capabilities. Reset/delete/reauth execution N/A Phase 5, not PASS. | Phase 3 capability/approval guard PASS (K1/K5); recent-auth reset/delete/reauth execution N/A Phase 5, not PASS. |
| I13 changing S/R cookie names | P: E115 cookie attributes/current-only selection; B/contracts/test_auth_flow.py, F/auth-prepare.spec.js. Late delivery/deletion/eviction integrated proof missing. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I14 first preparation order | C: E115 B/contracts/test_auth_flow.py preparation; F/auth-prepare.spec.js actual storage-before-R/receipt. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I15 shared lock/permit/first execution | P: E115 concurrent anonymous preparation; E116/E117 final checks. Member multi-tab owner termination/stage matrix needed. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I16 unknown/settle/exact missing S | P overall: E116/E117 real committed loss covered; R23 stage matrix and header/body interruption incomplete. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I17 proof loss/recovery | P overall: E115 ID-only, R-only, lost ID, partial reset browser tests. Add prior full-member state/full loss/eviction and current-cookie races. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I18 protected context/atomic check/no replay | P: E119 approval context plus E120 (committed T06) detail work. Verify committed T06 tests then add adversarial delayed delivery. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I19 hide/recheck/identity revision drafts | P: E117 password draft and mock coverage; E120 (committed T06). Same-member history discontinuity and ordinary-revision continuity both required. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I20 invalid-cookie cleanup/8 names/2KiB | P: E115 B/contracts/test_auth_flow.py budget tests. Need browser re-observation, late duplicate names and eviction chain. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I21 flow/R/results retention | P: E115 contracts and `auth_maintenance.sweep`; no exhaustive live-flow obsolete-S/R cleanup evidence. New retention suite must prove all required bounds. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I22 restart/backup restore | P: E115/E116/E118/E119 contracts/CLI; real subprocess + browser + restored SQLite + independent ledger chain missing. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| I23 runtime prerequisites/six environments | P local feature tests E115; all real environment public gates NOT RUN/BLOCKED. | PARTIAL local runtime coverage K3/K5; missing Fetch and real BFCache NOT RUN as R23-14/24; six-environment G01–G09 NOT RUN/BLOCKED. |
| I24 services/mappers/mock separation/visual | P integration: E115–E119 U/mappers.test.ts, U/openapi-contract.test.js, builds and visual; new T06/T07 bundle and full visual-state coverage pending. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |

## Q01–Q12 (#113)

| Requirement / applicability | Inherited test, expectation and command locator | Final Phase 3 local verdict / remaining scope / owner |
| --- | --- | --- |
| Q01 full signup/approval/session slice | C: E118/E119 F/auth-lifecycle.spec.js and B/contracts/test_admin_approval.py; integrate private endpoint without replacing prior proof. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q02 administrator scope | C local: E119 reads/approval/basic stats B/contracts/test_admin_approval.py; F/auth-lifecycle.spec.js false future capabilities. No admin app-list or Phase 5 activation. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q03 first admin change_only→full | C: E117 B/test_admin_bootstrap.py + F/auth-password.spec.js. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q04 initial wait vs revoked 90 days | C: E118 B/test_pending_retention.py and login deadline tests; E119 actual approval/deletion ordering. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q05 contact collection disabled | C: E118 B/contracts/test_auth_register.py and F/auth-register.spec.js, field errors/nontransmission; no invented support address. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q06 retain members/FK | C: E115 B/test_auth_migrations.py; E117 recent-auth migration preserves ID/ownership. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q07 no auto seed credential/history/approval | C: E115/E117 B/test_dev_seed.py and B/test_auth_migrations.py; repeat shared impact regression. Never run development seed against shared storage. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q08 integrated prerequisites before release | P: E115–E119 slice evidence exists; T06 inherited, T07 races and gates pending. | LOCAL integration commands PASS (K1–K11); integrated public prerequisites NOT RUN/BLOCKED G01–G18, release WITHHELD. |
| Q09 existing authService/mapper/app seams | P: E115–E119 U/api-auth*.test.ts, app observation; T06 removes remaining mock-only private behavior, must inspect landed implementation. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q10 public list/private authorized detail only | P: E119 future capability gate; B/contracts/test_public_apps.py; E120 (committed T06) private matrix. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q11 reuse transport/no new framework | C baseline: E115 extraction + U/api-auth.test.ts/U/mappers.test.ts; evaluate any T07 defect diff for scope. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q12 evidence each slice, final integration only | P: E115–E119 have ledgers; T06 handoff and complete T07 traceability not yet available. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |

## T01–T07 and acceptance criteria

| Requirement / applicability | Inherited test, expectation and command locator | Final Phase 3 local verdict / remaining scope / owner |
| --- | --- | --- |
| T01 | C slice, E115; B/contracts/test_auth_flow.py and F/auth-prepare.spec.js. Cookie-delivery combinations remain P in table above. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| T02 | C slice, E116; B/contracts/test_auth_login.py, B/test_auth_limits.py, F/auth-login.spec.js. Full-stage loss/restart combinations P. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| T03 | C local implementation with recorded failures/retests, E117; B/test_admin_bootstrap.py, B/contracts/test_auth_password.py, F/auth-password.spec.js. Do not relabel ASGI races as browser races. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| T04 | C slice, E118; B/contracts/test_auth_register.py, B/test_pending_retention.py, F/auth-register.spec.js. Integrated restore with browser still P. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| T05 | C slice, E119; B/contracts/test_admin_approval.py, B/test_approval_races.py, F/admin-approval.spec.js/F/auth-lifecycle.spec.js. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| T06 | C inherited at dabd663: E120; B/contracts/test_auth_access.py and F/auth-access.spec.js cover current private permissions/context/activity, hide/recheck and identity history. Browser streaming integration remains incomplete. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| T07 | P inherited primitives; new local integration M; all public gates NOT RUN/BLOCKED. This plan is not completion. | Feasible local commands and V1/V2 complete; real BFCache/missing Fetch explicitly NOT RUN, overall full local acceptance PARTIAL; all public gates NOT RUN/BLOCKED. |

## R7 Phase 3 clauses and boundary examples

| Requirement / applicability | Inherited test, expectation and command locator | Final Phase 3 local verdict / remaining scope / owner |
| --- | --- | --- |
| Q1/Q2/Q16/Q17 identity, NFC/codepoints/nickname | C: E115/E118 migrations and B/contracts/test_auth_register.py; public nickname separation E116/F/auth-login.spec.js. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q3/Q19 password/blocklist | C local: E117 B/contracts/test_auth_password.py and startup refusal; redistribution permission BLOCKED U02. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q4/Q18 optional contact format | C Phase 3 refusal/null/empty scope E118; actual nonempty collection/validation acceptance N/A until collection approved. Do not implement it here. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q5 approval state and history | C: E118/E119 registration/approval/lifecycle contracts. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q6 member reset | N/A Phase 5 execution; change_only consumers already C in E117, but do not count reset workflow PASS. | N/A member-reset execution, Phase 5 owner; shared change_only consumer regression PASS K1/K5, not reset workflow PASS. |
| Q7/Q8 full lifetimes/nonpersistent cookie | P integrated: E116 expiry and E115/E117 cookie attributes C; actual browser restore/device semantics remain gate. No promise that browser exit logs out. | LOCAL lifetime/cookie attribute contracts PASS K1/K5; natural device/browser-close/session restore NOT RUN G09. |
| Q9 device-local logout/all-session revocation | C Phase 3 E116/E119 tests; cross-process/private interaction P; reset/delete execution N/A. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q10 recent-auth | C no-extra-reauth approval E119; reset/delete enforcement N/A Phase 5. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q11 anonymous lifetime/token rotation | C primitives E115; R23 replaces old fixed-name/implicit-issuance wording. Late deliveries P. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q12/Q29/Q31/Q37 counters and exclusions | C local E115 preparation/anonymous; E116 B/test_auth_limits.py and approval/expiry precedence; E118 registration. Preserve 10/200 per 15min, registration 100/hour; error-specific counter assertions. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q13/Q30 bounded body/hash/DB resources | P: E115/E116/E119 body/pool/DB_BUSY C; operating measurements NOT RUN. | LOCAL body/hash-pool/DB_BUSY contracts PASS K1; actual host measurements NOT RUN G10. |
| Q14 trusted proxy/client IP | P local forged forwarded-header rejection E115/B/contracts/test_auth_flow.py; real proxy chain/spoof-resistance BLOCKED operating evidence. | LOCAL forged-forwarded-header guard PASS K1; actual trusted proxy/client-IP/spoof-resistance NOT RUN G11 operating owner. |
| Q15/Q32/Q33 CLI/atomic audit | C local E117 B/test_admin_bootstrap.py and F/auth-password.spec.js; operating execution NOT RUN. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q20/Q21/Q22/Q34/Q35/Q36 temporary/full transitions | C T03 B/contracts/test_auth_password.py exact/final boundaries and F/auth-password.spec.js. Private 404 part Q22 awaits E120; integrated interrupted-body change remains M. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q23 screen activity vs polling | P: E116 GET nonextension; T06 expected permitted activity. Reverify latest code against boundary matrix. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q24/Q25 administrator reauth/draft-resume execution | N/A Phase 5; generic identity-history draft protection belongs to T06 and remains P until evidence arrives. | N/A administrator reauth/draft-resume execution, Phase 5 owner; generic identity-history draft protection PASS K3/K5. |
| Q26 login/signup conflict | C E116/E118 full and change_only conflict tests. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q27 Origin/CSRF/no-S logout | C primitive E115/E116; no-S unknown browser chain P. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q28/Q39 stale state, no replay, transition serialization | P E115–E119, T06 expected; new T07 delivery matrix required. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| Q38 errors/state distinctions | C local per-slice contracts/mapper tests E115–E119; reauth-specific errors N/A; verify T06 detail 404 exception and unknown after body loss. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| §9 example: 08:59 login before 09:00 temporary expiry | C E117 `test_short_expiry_uses_the_earlier_temporary_deadline_and_full_clocks_start_at_change`; add real delayed finalization at 09:00 without waiting wall-clock hours. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| §9 example: change entered before but commits at expiry | C ASGI E117 final-check parametrization; P actual-process/browser stage chain. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| §9 example: unapproved+expired precedence / no failure count / already limited | C E116/E117 approval-precedence and B/test_auth_limits.py; retain table-driven cases. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| §9 example: own-change T+8h/T+30m/T+15m | C E117; reauth extension clause N/A Phase 5, normal restart integration P. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |
| §9 example: wrong admin reauth does not log out | N/A Phase 5, same as R23-13. | N/A execution, Phase 5 owner; no actual reauth result claimed. |
| §9 example: late anonymous/logout cannot undo new login | P E115 server selection and two-tab preparation; M/P actual delivery ordering in R23-03/06/07. | LOCAL PASS for applicable Phase 3 portions — K1 backend + K3/K5 frontend + K6 mock + K7–K11 static/visual/build preservation; public G01–G18 NOT RUN/BLOCKED; future execution N/A to Phase 4–6 owners |

## AC1–AC12 traceability

AC1–8 distinguish local seam evidence from remaining limits; AC9–11 are public/human gates, AC12 records the separation. Historical H/B/E/C rows stay historical; final K/V rows provide fresh commands/counts. A PARTIAL/NOT RUN row is not complete because subsets passed. Public owners are in G01–G18.

| AC | Inherited evidence / expected | Current evidence and limitation | Verdict |
| --- | --- | --- | --- |
| AC1 | E117–E120; all four replayable demo journeys including private detail | K5 normal T01–T06: actual CLI bootstrap/recovery→own-change; signup→pending→approval→member private refresh/focus→logout; two-device revoke/reapprove. E115–E120 remain inherited links. | LOCAL PASS |
| AC2 | E115–E120 / all applicable R23 §8 stage/outcome rows | K1 socket process/DB and V1/V2/K5 streaming-cookie cases map R23-01–29. Named local stages/orders PASS; R23-14 real BFCache and R23-24 missing Fetch NOT RUN with harness reasons. No exhaustive cross-product or natural eviction claim. | PARTIAL — explicit local limits |
| AC3 | E115–E117 / all proof-loss/current-cookie/budget branches | V1/V2/K5 late/duplicate S/R, exact deletion/discard, member proof-loss/partial reset/unavailable/budget branches; simulated loss identified, actual natural eviction G09. | LOCAL PASS at listed seams |
| AC4 | E115–E120 / all time and cleanup boundaries, restart/restore/readiness | K1 full backend: expiry/cleanup/key/pending boundaries, real password death/finalization, restart and negative ledger/readiness/lock drills; K5 browser restart/restore and twelve clock cases. Fault maintenance uses explicit ticks; operating scheduler G12. | LOCAL PASS at listed seams |
| AC5 | E115–E120 / I/Q/T/R7/R23/US per-case evidence | Final I01–24/Q01–12/T01–07/R7/R23/US01–55 maps cite K/V commands and expected HTTP/DB/cookie/DOM behavior. Future execution marked N/A; public/device/human owners unchanged. | PASS traceability; NOT RUN cases retained |
| AC6 | E120 impact analysis / full backend once and affected frontend/CI | K1 one post-reboot full backend run; K2–K11 full frontend unit/static/default API/full mock/affected visual/build/dist/reference. Shared maintenance/migration affects all auth/startup/readiness plus public/seed/pending/admin consumers. Remote CI NOT RUN, coordinator. | LOCAL automated PASS; CI NOT RUN |
| AC7 | E120 runner / unavailable and active isolated boundary, no external egress | K5 default no-argument unavailable + normal prepared + fault prepared + fixed captures. Runner owns fresh migrated temporary SQLite/ledger/bootstrap/fixtures/ports/teardown, external egress blocked, no API→mock fallback. Existing unavailable-boundary skips disclosed. | PASS |
| AC8 | E115–E120 captures / all required states at five exact viewports | V1/V2 two complete 43-functional→20-fixed-capture runs and forty exact-byte/hash/dimension comparisons; K5 normal five-viewport login/password/register/access/admin cards; K7 source/product-only auth/admin comparisons, inherited source frames kept. Human visual acceptance G16 BLOCKED. | AUTOMATED PASS at recorded frames; HUMAN BLOCKED |
| AC9 | R23 operating runtime contract / six actual environments, contemporaneous stable versions | Six actual OS/browser/device environments and contemporaneous stable versions, HTTPS/proxy/HTTP2/primitives/real cookies not supplied; local Chromium does not substitute. | NOT RUN |
| AC10 | R9/R15 / real host, proxy, cleanup/restore, U01/U02 | Supporting K1/K5 local restore/readiness is not host operation; actual host/proxy/cleanup/restore/support schedule and U01/U02 evidence absent. | BLOCKED |
| AC11 | R23/#113 / actual product visual, operator readiness and human public acceptance | DomineYH visual acceptance, operator readiness acceptance and human public-release acceptance not supplied; G16–G18. | BLOCKED |
| AC12 | #121 / four separate verdicts, public authorization withheld, parent left open | Four separate verdicts finalized; local NOT RUN limitations disclosed and public WITHHELD regardless of green automation. No GitHub mutation, parent remains open; U01/U02 do not stop local work. | PASS separation; public acceptance withheld |

## US-01–US-55 (#113) evidence links

B/ paths are under backend/tests; F/ paths under frontend/e2e-api.
Inherited aliases link to the committed ledgers at the top. Historical C2/C3/C6 and fresh K1–K11/V1/V2 supply command/seam observations; final verdicts distinguish inherited inventory from current reruns. Each statement below is the source story's
expected behavior, not an added feature. Human/device/operating execution remains
G01–G18; future reset/delete/reauth/CUD are excluded to their Phase 4–6 owners.

| Story / expected behavior | Applicability / inherited evidence | Named current test / evidence | Local verdict / remaining owner |
| --- | --- | --- | --- |
| US-01 방문자로서, 인증 준비와 무관하게 공개 아카이브 앱을 탐색하여 로그인 장애 중에도 자료를 읽고 싶다. | Phase 3 local; E115/E120 | `F/auth-prepare.spec.js; F/auth-access.spec.js; C3 runtime failures` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-02 방문자로서, 지원하지 않거나 차단된 브라우저 환경에서는 공개 열람과 지원 안내를 받아 보호 기능의 이용 가능 여부를 알고 싶다. | Phase 3 local; E115/E120 | `F/auth-prepare.spec.js; F/auth-access.spec.js; C3 runtime failures` | PARTIAL runtime coverage K3/K5; missing Fetch NOT RUN (R23-24); public/human portions NOT RUN/BLOCKED G01–G18 |
| US-03 가입자로서, 로그인 아이디·비밀번호·확인·별명을 구분해 입력하여 나를 식별하는 계정과 공개 이름을 따로 정하고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-04 가입자로서, 정규화·길이·허용 문자·흔한 비밀번호의 필드 오류를 확인하여 유효한 자격증명을 만들고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-05 가입자로서, 다른 회원과 같은 별명을 사용해도 가입하여 공개 이름의 중복 때문에 배제되지 않고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-06 가입자로서, 중복 로그인 아이디를 안내받아 다른 로그인 아이디로 가입하고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-07 가입자로서, 비밀번호 확인값은 브라우저에서만 검사하여 불필요한 전송을 피하고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-08 가입자로서, 선택 이메일·연락처 수집 비활성 안내와 값 거절을 확인하여 수집하지 않는 개인정보를 제출하지 않고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-09 가입자로서, 통신 실패와 필드 오류를 구별하고 중복 클릭을 막아 가입 결과를 오해하지 않고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-10 미승인 회원으로서, 가입 후 자동 로그인 대신 최초 승인 대기와 만료 안내를 받아 다음 절차를 알고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-11 미승인 회원으로서, 정확한 비밀번호로 로그인했을 때 승인 대기 안내를 받아 이용 제한 이유를 알고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-12 최초 승인 대기 회원으로서, 가입일부터 90일의 기한을 안내받아 계정 보관 기간을 알고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-13 승인 해제된 회원으로서, 승인 이력이 보존되어 최초 승인 대기의 자동 삭제 대상으로 오인되지 않고 싶다. | Phase 3 local; E118/E119 | `B/contracts/test_auth_register.py; B/test_pending_retention.py; F/auth-register.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-14 승인 회원으로서, 실제 비밀번호 검증과 서버 세션으로 로그인하여 내 권한으로 이용하고 싶다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-15 회원으로서, 별명으로 헤더와 작성자 표시를 보아 로그인 아이디가 공개 이름으로 노출되지 않고 싶다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-16 회원으로서, 새로고침 뒤 서버에서 현재 세션을 확인하여 유효한 로그인 상태를 이어가고 싶다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-17 회원으로서, 절대·비활동 만료를 정확히 적용받아 만료된 권한이 남지 않기를 원한다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-18 회원으로서, 여러 기기에서 이용하되 현재 기기의 로그아웃이 다른 기기의 세션까지 종료하지 않기를 원한다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-19 회원으로서, 계정을 전환할 때 먼저 로그아웃하여 이전 회원의 자료나 작업이 다음 회원에게 넘어가지 않기를 원한다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-20 회원으로서, 로그인 입력 오류·요청 제한·서버 과부하를 구별해 안내받아 적절히 다시 시도하고 싶다. | Phase 3 local; E116/E120 | `B/contracts/test_auth_login.py; B/test_auth_limits.py; F/auth-login.spec.js; F/auth-access.spec.js; C2/C4` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-21 운영자로서, 관리자 계정이 없을 때만 대화형 CLI로 최초 관리자를 생성하여 임의 승격 없이 운영을 시작하고 싶다. | Phase 3 local; E117 | `B/test_admin_bootstrap.py; B/contracts/test_auth_password.py; F/auth-password.spec.js; C2/C3` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-22 운영자로서, 기존 관리자 계정만 복구하고 기존 세션을 폐기하여 관리자 계정 복구의 대상을 명확히 하고 싶다. | Phase 3 local; E117 | `B/test_admin_bootstrap.py; B/contracts/test_auth_password.py; F/auth-password.spec.js; C2/C3` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-23 관리자로서, 임시 비밀번호로 변경 전용 세션을 받아 본인 비밀번호 변경 전에는 관리자 기능에 접근하지 않고 싶다. | Phase 3 local; E117 | `B/test_admin_bootstrap.py; B/contracts/test_auth_password.py; F/auth-password.spec.js; C2/C3` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-24 관리자로서, 임시 비밀번호의 24시간 만료와 변경 전용 세션의 짧은 만료를 안내받아 유효한 기간에 변경하고 싶다. | Phase 3 local; E117 | `B/test_admin_bootstrap.py; B/contracts/test_auth_password.py; F/auth-password.spec.js; C2/C3` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-25 관리자로서, 본인 비밀번호 변경을 완료한 브라우저에서만 새 full 세션을 받아 임시 자격증명의 사용을 끝내고 싶다. | Phase 3 local; E117 | `B/test_admin_bootstrap.py; B/contracts/test_auth_password.py; F/auth-password.spec.js; C2/C3` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-26 관리자로서, 기존 사용자 탭의 실제 목록·상세·통계를 조회하여 회원의 현재 승인 상태를 확인하고 싶다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-27 관리자로서, 대상 회원의 최신 상태를 확인하고 승인하여 가입자가 실제 로그인할 수 있게 하고 싶다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-28 관리자로서, 승인 해제 시 대상의 모든 세션을 폐기하여 철회된 권한으로 계속 이용하지 못하게 하고 싶다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-29 회원으로서, 승인 해제 이후에도 공개 아카이브 앱은 유지되고 재승인이 과거 세션을 되살리지 않기를 원한다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-30 관리자로서, 동시 승인·중복 제출을 작업 키와 회원 버전으로 처리하여 한 작업을 중복 반영하지 않고 싶다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-31 관리자로서, 승인 응답을 잃으면 원래 작업의 결과를 조회하거나 명시적으로 취소하여 불확실한 결과를 성공·실패로 추측하지 않고 싶다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-32 관리자로서, 관리자 계정에 대한 승인 해제 등 금지 작업이 직접 API에서도 거절되어 운영 계정을 보호하고 싶다. | Phase 3 local; E119/E120 | `B/contracts/test_admin_approval.py; B/test_approval_races.py; F/admin-approval.spec.js; F/auth-lifecycle.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-33 승인 회원으로서, 내 비공개 아카이브 앱 상세만 읽어 다른 회원의 비공개 자료를 침범하지 않고 싶다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-34 관리자로서, 현재 권한으로 비공개 아카이브 앱 상세를 읽되 이번 단계에 없는 관리·쓰기 기능은 열리지 않기를 원한다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-35 방문자로서, 없는 상세와 무권한 비공개 상세에 같은 404를 받아 비공개 자료의 존재가 드러나지 않기를 원한다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-36 회원으로서, 다른 탭의 인증 변경과 탭 복귀 시 보호 화면을 가리고 재확인하여 이전 권한의 자료가 남지 않기를 원한다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL listed hide/recheck paths PASS K3/K5; real BFCache NOT RUN (R23-14); public/human portions NOT RUN/BLOCKED G01–G18 |
| US-37 회원으로서, 인증 확인에 실패하면 공개 열람과 명시적 다시 확인을 이용하여 확인되지 않은 보호 화면을 보지 않기를 원한다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-38 회원으로서, 이전 요청의 늦은 응답이 현재 회원의 화면이나 캐시를 바꾸지 않기를 원한다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-39 회원으로서, 같은 회원으로 돌아왔더라도 중간 로그아웃·계정 전환이 있었다면 이전 초안과 관리자 대기 작업을 폐기하고 싶다. | Phase 3 local; E120 | `B/contracts/test_auth_access.py; F/auth-access.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-40 회원으로서, 인증 전환 결과가 불명확하면 서버 종결 확인까지 보호 작업을 보류하여 늦은 요청과 충돌하지 않고 싶다. | Phase 3 local; E116/E117 | `C2/C3; F/auth-races.spec.js; F/auth-races-orders.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-41 회원으로서, 성공한 로그인 뒤 새 세션 쿠키를 받지 못하면 그 결과 세션만 폐기하고 다시 로그인하고 싶다. | Phase 3 local; E116/E117 | `C2/C3; F/auth-races.spec.js; F/auth-races-orders.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-42 회원으로서, 본인 비밀번호 변경 응답을 잃더라도 완료된 비밀번호 변경을 유지하고 결과를 확인하고 싶다. | Phase 3 local; E116/E117 | `C2/C3; F/auth-races.spec.js; F/auth-races-orders.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-43 회원으로서, 복구 자격증명을 잃었지만 현재 세션이 유효하면 제한된 교체 절차로 복구 준비를 다시 마치고 싶다. | Phase 3 local; E115/E117 | `C3/C4; F/auth-recovery-members.spec.js; F/auth-recovery-boundaries.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-44 방문자로서, 흐름 ID만 남았을 때 서버가 재시작 가능하다고 확인할 때까지 공개 열람을 계속하고 싶다. | Phase 3 local; E115/E117 | `C3/C4; F/auth-recovery-members.spec.js; F/auth-recovery-boundaries.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-45 회원으로서, 흐름 ID를 잃었지만 증명이 남았을 때 명시적 브라우저 인증 초기화로 증명 가능한 흐름을 종료하고 싶다. | Phase 3 local; E115/E117 | `C3/C4; F/auth-recovery-members.spec.js; F/auth-recovery-boundaries.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-46 회원으로서, 여러 흐름 초기화가 일부만 완료되면 원래 대상 모두의 종료를 확인한 뒤 새 로그인을 준비하고 싶다. | Phase 3 local; E115/E117 | `C3/C4; F/auth-recovery-members.spec.js; F/auth-recovery-boundaries.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-47 회원으로서, 과거 전환 결과를 더 이상 조회할 수 없으면 확인 불가 안내와 현재 상태 확인을 받아 과거 성공·실패를 오인하지 않고 싶다. | Phase 3 local; E115/E117 | `C3/C4; F/auth-recovery-members.spec.js; F/auth-recovery-boundaries.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-48 회원으로서, 늦게 도착한 옛 쿠키가 현재 인증을 덮지 않고 쿠키 예산 부족이 명시적으로 안내되기를 원한다. | Phase 3 local; E115/E117 | `C3/C4; F/auth-recovery-members.spec.js; F/auth-recovery-boundaries.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-49 회원으로서, 정상 서버 재시작 뒤 유효한 세션은 유지되고 미종결 요청은 자동 재실행되지 않기를 원한다. | Phase 3 local; E118/E119 | `C2/C3; B/test_auth_restart.py; F/auth-recovery-process.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-50 운영자로서, 백업 복원 뒤 과거 세션·흐름·복구 권한·허가를 무효화하여 오래된 인증이 되살아나지 않기를 원한다. | Phase 3 local; E118/E119 | `C2/C3; B/test_auth_restart.py; F/auth-recovery-process.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-51 운영자로서, 기존 회원 식별자와 아카이브 앱 소유권을 보존하고 불명확한 이관 자료는 중단하여 계정 이력을 꾸미지 않고 싶다. | Phase 3 local; E115/E118/E119 | `B/test_auth_migrations.py; B/test_pending_retention.py; B/contracts/test_admin_approval.py; C2` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-52 운영자로서, 승인·CLI 자격증명 변경·감사를 원자적으로 기록하고 만료 자료를 정리하여 업무와 기록이 어긋나지 않기를 원한다. | Phase 3 local; E115/E118/E119 | `B/test_auth_migrations.py; B/test_pending_retention.py; B/contracts/test_admin_approval.py; C2` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-53 키보드 및 보조기술 사용자로서, 기존 입력 순서·focus·label·오류 연결을 유지하고 가린 자료에는 접근하지 않기를 원한다. | Phase 3 local; E115–E120 | `C1–C5; F/auth-access.spec.js; F/auth-recovery-captures.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-54 검수자로서, 합성 자료를 실제 HTTP·파일 SQLite·브라우저 쿠키로 검증하여 mock 성공과 실제 인증 증거를 구별하고 싶다. | Phase 3 local; E115–E120 | `C1–C5; F/auth-access.spec.js; F/auth-recovery-captures.spec.js` | LOCAL automated PASS via K1/K3/K5/K6/K7; public/human portions NOT RUN/BLOCKED G01–G18 |
| US-55 인계 검토자로서, 요구별 실행 증거와 필수 실기기·운영·사람 수락을 확인하여 로컬 합격과 인증 공개 승인을 구별하고 싶다. | Phase 3 local; E115–E120 | `C1–C6; G01–G18/four separate verdicts; CI coordinator` | PASS traceability/separate-verdict record; CI NOT RUN coordinator; public/human portions NOT RUN/BLOCKED G01–G18 |

## Public gate — authorization WITHHELD

Actual OS/browser/device/host/proxy/ALPN/build versions, executed-at, evidence URI,
reviewer and explicit human acceptance are **not supplied/not recorded** for every
row. Required procedure: in each actual environment run the R23 §8 current-cookie,
recovery and interruption cases; verify SecureContext, exclusive Web Locks, storage
read/write/cross-tab events, Fetch/AbortController and actual cookie receipt. Use
production-equivalent HTTPS/proxy and HTTP/2 when applicable. Feature probes and
local Chromium are supporting evidence only. Every gate below is NOT RUN or BLOCKED;
none passed. Required operating procedures and responsible roles are in each row.

| Gate | Initial status | Required evidence / owner |
| --- | --- | --- |
| G01 Windows Chrome | NOT RUN | Actual supported Windows/current stable Chrome versions and complete required auth/cookie/restore cases; device tester/U01 coordination. |
| G02 Windows Edge | NOT RUN | Independent actual Edge run, not Chromium branding assumption; same requirements. |
| G03 Windows Firefox | NOT RUN | Actual Gecko run; same requirements. |
| G04 macOS Safari on real Mac | BLOCKED (needs human/U01/U02) | Real machine availability and exact stable OS/Safari versions, actual cookies/locks/restore; U01/device tester (U01 dependency). |
| G05 Android Chrome on real device | BLOCKED (needs human/U01/U02) | Actual device/OS/stable Chrome and background/restore/tab behavior; U01/device tester (U01 dependency). |
| G06 iOS Safari on real device | BLOCKED (needs human/U01/U02) | Actual iPhone/iPad context as approved, OS/stable Safari, background/history/cookie behavior; U01/device tester (U01 dependency). |
| G07 Same-origin HTTPS/proxy and applicable HTTP/2 | NOT RUN | Production-equivalent route/TLS/ALPN and independent cookie response ordering, attributes and next-request ingress. Explicitly document applicability; do not waive HTTP/2 because localhost uses HTTP/1.1. Operating owner. |
| G08 Runtime primitives in each of six environments | NOT RUN | SecureContext, real Web Lock exclusivity, localStorage read/write/cross-tab events, Fetch, AbortController and actual cookie receipt; unsupported path public-only. Feature-presence probes alone insufficient. |
| G09 Cookie storage/eviction/session restore across environments | NOT RUN | Actual receipt/late Set-Cookie/old deletion/current-missing behavior, distinguish manually cleared and naturally evicted cookies; browser-close behavior not promised logout. |
| G10 Host hashing/pool/DB-lock measurements | NOT RUN | Actual deployment host Argon2 profile/cost, concurrent2/queue4/wait1s candidate load behavior, controlled AUTH_BUSY/Retry-After and DB lock bound. Local five-second test is not host capacity. Operating owner. |
| G11 Trusted proxy/client-IP/spoof-resistance | NOT RUN | Actual trusted hop configuration/direct access restriction/client IP derivation, forged Forwarded/XFF tests and rate bucket behavior. Operating owner. |
| G12 Cleanup and backup/restore operations | NOT RUN | Actual scheduler, failed-sweep response, backup inventory/max retention, current independent ledger, stop/restore/invalidate/redelete/readiness drill and failure recovery. Local temp-DB drill is supporting evidence only. Operating owner/R9/#16. |
| G13 Authentication readiness/operating configuration | NOT RUN | Correct migration, fixed blocklist integrity, secret/path permissions, valid current references, missing-list refusal, health/auth readiness distinction, maintenance failure recovery on actual host. |
| G14 U01 support addresses, devices, staffing/schedule | BLOCKED (needs human/U01/U02) | Real service operator-supplied contact/configuration and responsible schedule; U01 owner. Keep support null until supplied. |
| G15 U02 blocklist redistribution rights | BLOCKED (needs human/U01/U02) | Documented right to include fixed source in image/package; U02 owner. Local explicit provisioning neither resolves rights nor authorizes redistribution. |
| G16 DomineYH actual product visual acceptance | BLOCKED (needs human/U01/U02) | Explicit acceptance linked to exact screenshots/build and unresolved differences; DomineYH. Design auto-approval is not visual approval. |
| G17 Operator readiness acceptance | BLOCKED (needs human/U01/U02) | Named operator's actual preparation evidence and acknowledgment; do not infer from developer tests. |
| G18 Human public-release acceptance | BLOCKED (needs human/U01/U02) | Explicit human acceptance after all applicable gates and U01/U02 resolved; no automatic release from ready-for-agent/green CI. |


## Checkpoint commits and static verification

`f2bf54e` fault harness; `b5a588e` real-cookie/process races and runner selection;
`af41348` separately proven retention defect + migration; `552cb0c` HTTP restart/restore.
At the original checkpoint, the named tests exercised the same source content before those commits;
subsequent changes are this read-only checkpoint ledger. `ruff check .` and
`ruff format --check .` PASS (57 files); targeted ESLint and Prettier PASS on all nine
changed/new JS/MJS/config files. No full frontend check or full regression is implied.
First targeted ESLint invocation from repository root failed to locate the config;
rerun from frontend succeeded without configuration edits.

Continuation resumed with service available; the earlier usage-budget checkpoint
is historical. Public U01/U02 dependencies do not block local verification.

## Four separate verdicts and remaining work

| Verdict | Current result |
| --- | --- |
| Local integration completeness | Feasible local work COMPLETE; full local acceptance PARTIAL for real BFCache/missing-Fetch cases explicitly NOT RUN below. No blanket AC2/ticket completion. |
| Automated verification | Final local K1–K11 and V1/V2 PASS; existing unavailable-boundary skips disclosed. CI NOT RUN (coordinator owns push/PR/CI). |
| Human actual product visual acceptance | BLOCKED — DomineYH acceptance not supplied |
| Operating authentication public-release authorization | WITHHELD — all required public gates remain NOT RUN/BLOCKED |

Reboot-resume audit (2026-10-03): the former remaining-work paragraph described
370b8a1's checkpoint and was stale against e7f4510/f458f5d. The inventory below
reconciles committed coverage before fresh reproductions. Prior C2/C3 counts are
historical T07 runs, not fresh post-reboot PASS. Final fresh commands/results are recorded in K1–K11 and V1/V2 below. Machine reboot at 11:40 lost the prior processes and /tmp;
no prior temporary DB or capture-only run is reused.

| Former NOT RUN item | Committed coverage / precise observation | Resume disposition |
| --- | --- | --- |
| Pre-admission close | F/auth-races-orders.spec.js pre-admission owner close: before_forward drop, saved ID settled, replay fenced | Fresh PASS V1/V2/K5 |
| Worker-win and rotate orders | B/test_auth_races.py rotation/real-worker winner × login/password; F/auth-races-orders.spec.js worker-wins-before-settle | Fresh PASS K1/V1/V2/K5 |
| Late/duplicate old S/R | F/auth-races-orders.spec.js delayed login S and R rotation, repeat original response bytes; selected new authority survives | Fresh PASS V1/V2/K5 |
| Late exact deletion | F/auth-races-orders.spec.js late logout deletion preserves newer anonymous/member cookie names | Fresh PASS V1/V2/K5 |
| R-only, ID-loss, total-loss, partial reset | F/auth-recovery-members.spec.js four full-member loss branches and original-target reset; F/auth-recovery.spec.js ID-only | Fresh PASS V1/V2/K5; explicitly simulated loss |
| execution_blocked | F/auth-recovery-members.spec.js unavailable false/true explicit settlement; B/test_auth_boundaries.py aged result and retained fence after sweep | Fresh PASS K1/V1/V2/K5 |
| Cookie-budget re-observation | F/auth-recovery-members.spec.js exact cleanup, observed reduction, simulated late replenishment; unknown names retained | Covered locally; natural eviction/2KiB browser storage policy remains G09; backend byte-budget contracts fresh PASS K1 |
| ±1µs boundaries | B/test_auth_boundaries.py anonymous/full/change_only/flow, absolute8h/activity/results; B/test_auth_races.py permit/temp finalization; F/auth-recovery-boundaries.spec.js 12 server-clock cases | Covered at listed seams; no browser wall-clock authority claim; fresh PASS K1/V1/V2/K5 |
| Password death/finalization | B/test_auth_races.py real SIGKILL hash_return/precommit/committed and temp finalization; F/auth-races.spec.js close/lost-body own-change | Fresh PASS K1/V1/V2/K5 |
| Transient maintenance lock | B/test_auth_restore_negative.py lock/readiness/public/reconcile next explicit maintenance tick | Covered; automatic 60s scheduling in fault process NOT RUN (private tick seam); actual scheduler G12 |
| Browser restart/restore | F/auth-recovery-process.spec.js same jar/S/absolute deadline after real restart; backup→current-ledger deletion replay→actual CLI→readiness/old-cookie rejection | Covered locally; fixture/bootstrap/migration reinjection false; host/device restore remains G09/G12 |
| Negative ledger/readiness | B/test_auth_restore_negative.py missing/corrupt/stale/current-reference/audit failure; failed CLI keeps stopped, deliberate startup probes reject auth | Fresh PASS K1 |
| Pending/stale approval request | B/test_auth_write_fence.py actual socket HTTP: pending admission/key write 409, cancelled same S rejects old revision, unresolved key preserved until explicit current request | New targeted PASS 1/1, 6.79s (wall 10.78s); fresh full backend PASS K1 |
| AC1 journeys | F/auth-lifecycle.spec.js signup→pending→approve→login→private refresh/focus→logout; F/auth-password.spec.js real CLI bootstrap/recovery→own-change; F/auth-access.spec.js revoke/reapprove two devices | Covered in normal transport; fresh default PASS K5 |
| US-01–55 map | Complete 55-row source-story table already committed in e7f4510, with B/F/C/G locators | Finalized current row verdicts above; never infer public acceptance |
| Visual matrix | F/auth-recovery-captures.spec.js eight × five frames; F/auth-login/password/register/access/admin-approval captures plus inherited source comparisons and auth/admin visual | Forty preliminary frames independently reproduced V1/V2; exact read-only comparisons PASS; final five-viewport visual PASS K7 |

Additional limits: real BFCache restoration is NOT RUN (pageshow is explicitly synthetic, default Playwright disables BFCache, and history/focus tests do not prove admission); missing
Fetch browser execution is NOT RUN (removing Fetch also disables the public API
transport; no alternate transport exists in this harness). Supported runtime
primitives in actual six environments remain G01–G09. These limits are not PASS.
Final backend once, frontend unit/check, default unavailable/normal/fault/captures, full mock e2e, auth/admin visual, both builds/dist/reference PASS K1–K11. Coordinator CI NOT RUN (no push/PR authorized). Public/human gates remain NOT RUN/BLOCKED.

Out-of-scope execution: admin reauth/member reset/account deletion → Phase 5 feature
owner; archive-app CUD/my-app/admin app list → Phase 4–5 owner; external worker/link
fetching → Phase 6 owner. Keep capability guards; no future feature is counted PASS.
Host/proxy/operating backup inventory/scheduler → operating owner/#16; devices/contact/
schedule → U01 owner; redistribution rights → U02 owner; visual acceptance → DomineYH.
No invented person, address, schedule, browser version or approval. Local blocklist
provisioning does not authorize redistribution. No push/PR/comment/merge/issue closure.

Unrelated user README/CLAUDE/routing/storage/.env are excluded from staging. No raw DB,
HAR/traces, cookie/CSRF/password/contact artifacts are evidence. Failed browser error
contexts are transient local outputs and must be discarded before handoff. No visual
baseline, tolerance, policy, TTL, dependency lock or production capability was changed.

## Checkpoint review repairs

- H1/M1: af41348's commit message overstated newer-pending preservation; this entry corrects the history without rewriting it. `B/test_auth_retention.py::test_clearing_expired_current_session_preserves_newer_admission` uses the reviewer scenario through real monotonic HTTP: RED (pending cleared), then PASS after save_flow-only cleanup; the old admitted revision completes successfully. `test_obsolete_older_session_preserves_real_executing_login` pauses the actual verifier at hash_return with a newer valid anonymous S and obsolete older S; real HTTP PASS. `test_synthetic_state_cleared_reference_never_touches_executing_ledger`: RED (executing became expired), then PASS; **synthetic state, unreachable via monotonic real HTTP; guards the branch only**, direct row setup in an isolated file DB, no clock rewind. Retention 6 PASS/24.93s; affected retention/races/restart/flow/login/password/admin-approval/access rerun: 178 PASS/400.12s. Expired/revoked-flow terminalization remains in its existing loop.
- M2: normal T01–T06 and races/recovery use separate transports and fresh run-owned DBs. Default no-argument runner still selects unavailable + all prepared specs + captures. No mutation in a fault run can affect later runs. Mixed-argument verification: normal auth-prepare 18 PASS/1.5m, then fault auth-recovery 1 PASS/29.3s; separate launcher commands and DB paths observed.
- L1: before_forward drop regression RED (forwarded event present); guard destroys incoming and returns before upstream creation. Proxy self-tests 5 PASS/0.15s, including zero upstream ingress on drop.
- L2: migration 0006 downgrade message and backend operator notes require restoring a separately verified backup; explicit upgrade head and live-flow expired/revoked S/R sweep documented.
- L3/L4: B3 discloses direct created_at aging; ID-only reset now sends the revision actually observed before proof loss.

## Continuation commit consistency and capture corrections

- Second-crash capture diagnosis (test first): the old checker mismatch at
  reset-recheck 768×1024 was an intended reset-error toast racing capture.
  `resetAuth` catches the deliberately aborted reset, displays the network error,
  and rechecks original targets. The button and alert already exist before the
  click; their visibility did not prove the failure or its recheck had completed.
  A capture-boundary regression requiring no transient toast was RED: reset-only
  browser command 4 FAIL/1 PASS, 47.5s (wall60.45s, maxRSS302072KB). The capture
  now observes the actual error toast visible → removed, then the restored reset
  button/alert, retaining the boundary assertion. Same command GREEN 5/5, 46.2s
  (wall57.50s, maxRSS318564KB): `npm --prefix frontend run test:e2e:api --
  auth-recovery-captures.spec.js --grep 'captures reset'`, memory-guarded.
  The per-viewport `/auth/login` socket-hang-up occurs in the separate results
  scenario's intentional before_headers drop, not after successful reset/login.
  No product defect/change, sleep, retry, tolerance, masking or baseline update.
  Settled reset/recheck evidence was then regenerated from complete lifecycles
  below; independent V1/V2 and final K5/K7 comparisons subsequently passed.

- Capture regeneration after the reset fix: first complete fresh lifecycle
  43 functional PASS/2.5m → 20 fixed-clock capture PASS/1.4m, wall245.94s.
  Read-only comparison against historical captures failed safely at reset-recheck
  1440×1000, as expected from the changed readiness. All forty artifacts were
  copied directly from that completed run; only four reset-recheck PNGs changed
  (1440×1000, 1024×900, 390×844, 360×844). The settled 768×1024 PNG already matched.
  The manifest records the actual toast/recheck readiness and fresh hashes.
  Second complete fresh lifecycle 43 functional PASS/2.7m → 20 capture PASS/1.3m,
  wall254.52s; read-only byte/SHA256/dimension comparison 40/40 PASS. Its JSON is
  `capture-reproducibility.json`. These are reproduced product-only artifacts,
  not screenshot baselines or human acceptance. Two further independent complete
  matching lifecycles V1/V2 were subsequently executed after f69d826; final
  K5 also reproduced all forty images exactly.

- N1: this commit includes all runner-referenced new specs, helpers, backend boundaries/negative drills, checker and preliminary 40-frame manifest together. C4 is attached to its actual committed spec. The earlier 1f3d603 runner/ledger snapshot depended on untracked files; it cannot reproduce that inventory alone and is not rewritten.
- N2: the real-executing retention test comment now describes new anonymous S issuances. Fault-server periodic maintenance only runs on explicit private ticks, as disclosed above; no automatic 60s scheduler evidence is claimed.
- Capture-only selection initially produced an empty functional batch; the runner now omits that empty batch. Per-run socket paths also remove the reused process-control address conflict.
- Capture diagnostics: 17 PASS/3 FAIL (2.4m) exposed navigation before logout completion; added actual ready-header observation. Subsequent complete fault functional batch 43 PASS/3.0m and capture phase 16 PASS/4 FAIL (1.8m) exposed synthetic repeated submit events calling a stale removed form. The final test uses a real native user double-click and asserts exactly one admission/execution; capture-only stabilization 20 PASS/59.5s. No assertion, timeout, retry or tolerance was relaxed.
- Exploratory login error-message unit case: RED (10 PASS/1 FAIL), minimal mapping 11 PASS/32.45s, then browser evidence showed that member execution failure correctly conceals the form and retains unresolved authority. Both exploratory product/test changes were reverted; no frontend product change remains. Budget guidance is captured on real preparation refusal.
- Past-result capture originally expected an unknown card. Real HTTP proves availability=unavailable with execution_blocked=true after 31m, so the product safely prepares anonymous reentry. The capture shows that actual ready form, without inferring the unavailable past outcome. Unknown execution_blocked=false remains the separate network-unknown card. Five targeted aged-result/missing-S cases PASS/49.1s.
- Cold diagnostic API navigation exceeded the unchanged 30s limit while full unit imports competed for filesystem resources; interrupted diagnostics are not complete reproduction evidence. A SIGTERM probe exposed orphaned separately grouped web servers; forwarding interruption as Playwright's handled SIGINT now performs teardown. An actual interrupted run returned 143 and independent binds proved 8000/5174 free.
- Combined normal-transport journeys: public visitor + two independent member sessions revoked/reapproved + signup/approval/private refresh/focus/logout: 3 PASS/1.3m. Pre-admission drop/fence case PASS/15.7s in the separate fault run; stale replay uses the captured S proof, not R-CSRF.
- First complete reproduction attempt: functional 43 PASS/3.6m, captures 15 PASS/5 FAIL/2.0m. The member label precedes login's final gallery navigation, which could replace the logout button during the test click. The capture test now awaits that actual navigation before clicking logout. Capture-only retest 20 PASS/53.4s; this is stabilization, not a complete functional-to-capture reproduction. No product code, timeout, retry or screenshot baseline changed.

- Resume coverage addition: `B/test_auth_write_fence.py` covers R23-11/12 through actual socket HTTP/file DB: admission and original approval writes fail 409 while pending, cancelled logout preserves S but fences old revision, business key stays unresolved, explicit current-revision execution succeeds once. Targeted 1 PASS/6.79s (wall 10.78s); no product defect/change. Initial file command used the wrong working directory and collected no tests; path corrected. Ruff identified formatting in the new file; configured formatter applied, lint/format retest PASS.

- Post-reboot complete reproduction attempt: functional 43 PASS/3.5m, captures 19 PASS/1 FAIL/1.5m (login 390×844 never observed ready logout). The run is not reproduction evidence. A ten-case diagnostic passed (45.8s, wall53.35s) but did not disprove the intermittent failure. Focused repeat loop reproduced it with zero logout proxy ingress and an unchanged member header; deliberately interrupted after the signal (exit130, wall86.44s; unfinished repetitions are NOT RUN). URL arrival precedes the gallery route-entry auth recheck, so URL-only readiness could click a transient header. The test now awaits rendered gallery + restored header and asserts the actual logout HTTP204; original final-ready assertion remains. Focused retest 10/10 PASS (1.2m, wall81.84s). Debug instrumentation removed; no product, deadline, retry, baseline or tolerance change. Subsequent complete independent reproductions V1/V2 below follow this correction.

## Final post-reboot reproduction and integration results

All commands below use the brief's prepared blocklist, pinned Chromium and committed
fontconfig; UV_OFFLINE=1 and UV_PYTHON_DOWNLOADS=never. No dependency/browser/list
was downloaded. Node24.21.0/npm12.2.0 differ from pins22.23.2/12.0.2. WSL reboot
interruption and prior failed attempts above are historical, not fresh PASS.
8000/5173/5174 were free before restart and all browser batches were serialized.
Only the copied Linux pytest entrypoint was corrected; backend/.venv remains a
directory. K1 is the one post-reboot full backend integration run, including the
new write-fence case; previous full346 counts above are historical, not this run.
K6 inherits the full default e2e/ inventory without filtering, changing only pinned
browser launch and isolated outputDir via a temporary config deleted after execution.
No deadline extension, configured retry, added skip, weakened assertion, inherited baseline,
tolerance, policy, TTL or production activation change. Harness assertions were strengthened
as documented in the failure history.

| ID | Exact command | Fresh result / evidence |
| --- | --- | --- |
| V1 | `npm --prefix frontend run test:e2e:api -- auth-races.spec.js auth-races-orders.spec.js auth-recovery.spec.js auth-recovery-members.spec.js auth-recovery-process.spec.js auth-recovery-boundaries.spec.js auth-recovery-captures.spec.js` then `node frontend/scripts/check-auth-integration-evidence.mjs` after runner exit0 | 43 passed (2.6m); 20 passed (1.3m); wall 246.40s; forty PNGs exact-byte/SHA256/dimensions PASS. Fresh runner-owned DB/template and fresh DB per functional/capture phase; no prior run reused. |
| V2 | `npm --prefix frontend run test:e2e:api -- auth-races.spec.js auth-races-orders.spec.js auth-recovery.spec.js auth-recovery-members.spec.js auth-recovery-process.spec.js auth-recovery-boundaries.spec.js auth-recovery-captures.spec.js` then `node frontend/scripts/check-auth-integration-evidence.mjs` after runner exit0 | 43 passed (2.7m); 20 passed (1.3m); wall 255.77s; forty PNGs exact-byte/SHA256/dimensions PASS. Fresh runner-owned DB/template and fresh DB per functional/capture phase; no prior run reused. |
| K1 | `APP_ENV=test uv run --frozen pytest -q` (backend cwd) | PASS — 347 passed, 1 warning in 612.94s (0:10:12); wall 614.82s |
| K2 | `uv run --frozen ruff check .` (backend cwd) | PASS — all Ruff checks passed; wall 0.14s |
| K2-format | `uv run --frozen ruff format --check .` (backend cwd) | PASS — 60 files already formatted; wall 0.11s |
| K3 | `npm --prefix frontend test` | PASS — Test Files  38 passed (38); Tests  889 passed (889); wall 153.61s |
| K4 | `npm --prefix frontend run check` | PASS — OpenAPI lint/generated contract, types, ESLint and Prettier; wall 52.69s |
| K5 | `npm --prefix frontend run test:e2e:api` | PASS — 29 skipped; 53 passed (2.5m); 52 passed (3.6m); 20 passed (2.0m); 43 passed (2.9m); 20 passed (1.4m); wall 763.71s |
| K6 | `npm --prefix frontend run test:e2e -- --config=playwright.resume-121.config.js` | PASS — 124 passed (5.3m); wall 323.04s |
| K7 | `npm --prefix frontend run test:visual -- visual/auth.spec.js visual/admin.spec.js` | PASS — 10 passed (4.9m); wall 297.56s |
| K8 | `npm --prefix frontend run build:mock` | PASS — mock bundle built (Vite 37.50s); wall 52.14s |
| K9 | `npm --prefix frontend run build` | PASS — API bundle built (Vite 42.19s); wall 56.27s |
| K10 | `npm --prefix frontend run check:dist` | PASS — 96 API distribution files, no mock fixtures/Tweaks/references/source maps; wall 0.62s |
| K11 | `npm --prefix frontend run check:reference` | PASS — PASS: 11 original files and preserved copies match their SHA-256 and byte counts.; wall 0.80s |

V1/V2 are complete functional→fixed-clock lifecycles, not capture-only stabilization.
V1/V2 ran after capture commit f69d826. Later isolated gallery guard, mock-clock and
budget-fixture corrections are covered by final K4/K5/K6; capture source and pixels
were unchanged by those corrections. The final K5 checker also independently matches
all forty committed images. The checked images remain the reproduced artifacts in captures.json; the
capture-reproducibility.json records independently matched results. Normal T01–T06
and fault functional/capture phases each use separate run-owned copies of the verified
prepared DB. Only within explicit restart/restore drills is the same DB retained;
fixtures/bootstrap/migrations are never reinjected there. Actual R/S proofs remain
process memory only. route.abort cards are UI-only and genuine proxy-byte cases
supply the cookie race evidence. Natural physical-browser eviction stays NOT RUN G09.

Public G01–G18 are unchanged NOT RUN/BLOCKED; AC9–11 remain unaccepted. Actual six
runtime environments, host scheduling/capacity/proxy, U01 real staffing/contact/schedule,
U02 redistribution rights, DomineYH visual/operator/human release acceptances and remote
CI are NOT RUN/BLOCKED for their stated owners. Existing harness cannot demonstrate
real BFCache admission or missing Fetch while preserving fresh public Fetch transport;
R23-14/24 and related rows retain these limits explicitly. No push/PR/comment/merge/
issue closure or parent closure occurred. Future admin reauth/reset/deletion/archive
CUD/admin list/external-worker execution remains N/A, never implementation PASS.

Final hygiene: all generated tracked PNGs outside issue121 were restored using
explicit git paths after API/visual batches and before every commit. The API
batches rewrote 77 older evidence PNGs and the visual batch two; none were staged.
Final cleanup finds zero outstanding generated PNGs. User root README/.env/
CLAUDE.md/routing/storage work remains untouched. Temporary pinned mock config
was removed; runner-owned DBs/servers were torn down. Historical budget ingress
in the exposing failed run remains unrecorded/unverified as explicitly stated
above; the deterministic cleanup ordering and current exact-state test are verified.
