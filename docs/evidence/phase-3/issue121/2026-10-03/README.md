# Phase 3 / T07 — local integration checkpoint (2026-10-03)

This is an incomplete implementation checkpoint, not ticket completion. Authority:
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
C/P/M below describe inherited inventory (covered/partial/missing), not new PASS.
All complete local requirements below remain NOT RUN until their remaining integration work
is complete; PASS appears only in the independently executed subset table.

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
and propagates upstream abortion; default Vite transport is unchanged.

Commands use the prepared blocklist and Chromium executable from the brief. Node
24.21.0/npm 12.2.0 differ from pinned 22.23.2/12.0.2, as in E120. Chromium
151.0.7922.34, ko-KR, Asia/Seoul, DPR1, reduced motion/light/sRGB; no new visual
acceptance is claimed. UV_PROJECT_ENVIRONMENT points to the prepared Linux venv;
`python -m pytest` avoids its old pytest shebang pointing back to DrvFS. Original
backend/.venv remains a directory. A temporary frontend dependency symlink caused
font serving refusals and was removed; original node_modules is restored.

| ID | Applicability / expected | Command / actual HTTP, DB, cookie, screen observation | Result |
| --- | --- | --- | --- |
| H1 | Four transport stages / original bytes and independent cookie receipt | `node frontend/scripts/test-auth-fault-proxy.mjs`: 4 PASS, 0.22s; before-forward/header/header-body/mid-body holds; two raw cookie fields; second raw request sends no Cookie. Synthetic transport self-test, not authentication proof. | PASS |
| B1 | R23-03/04/25: settle beats actual verifier; pre/post commit process death | `cd backend; uv run --frozen python -m pytest tests/test_auth_races.py tests/test_auth_retention.py tests/contracts/test_auth_flow.py -q`: 51 PASS/164.26s before the three additional permit cases. Two real workers rejected after settle; three SIGKILL orders cancel/rollback or retain success respectively. No reply cookie received after kill, state and DB agree, no reinjection. | PASS for named subset |
| B2 | R9 Q18, old S/R removal without reviving/deleting newer authority | Initial `test_auth_retention.py`: 2 FAIL/79.53s, residual rows 1 instead of 0. Minimal fix adds exact issued-name fences and removes expired/revoked generations, clearing references atomically. Migration/restart/retention: 12 PASS/29.77s; B1 includes original flow contracts. Final races+retention checks: 10 PASS/78.62s, including ±1µs actual-verifier permit checks, unknown-name preservation and newer-pending preservation. | PASS targeted scope |
| E1 | R23-04/05/08: real login and own-change response loss before headers, after headers, mid-body | `npm --prefix frontend run test:e2e:api -- auth-races.spec.js auth-recovery.spec.js`: 9 PASS/1.6m. Six HTTP cases prove succeeded DB/version, genuine upstream Set-Cookie and next Cookie ingress. Missing S → unknown/exact discard/new explicit login; own-password mutation persists. Received S → hidden identity until actual result/CSRF/me recheck; full identity then restores, no replay. | PASS |
| E2 | R23-03: owner close before claim and at real verifier return | Same 9-case command: two tab cases; survivor settles stored original ID, late worker has zero full sessions, fresh explicit login succeeds. Stage state admitted/executing separately observed. | PASS |
| E3 | R23-17: simulated proof loss, ID-only restriction | Same command: clearCookies is explicitly simulated loss; eligibility false, reset 401, public-only product warning, no logout control. Not natural browser eviction. | PASS |
| B3 | R23-25/26: actual restart then SQLite snapshot restore | `cd backend; uv run --frozen python -m pytest tests/test_auth_restart.py -q`: 4 PASS/30.71s. Real process restart retains original expiry plus resolved/unresolved approval keys. SQLite backup API, deletion after snapshot in current independent ledger, stop/restore/actual `python -m app.cli invalidate-restored-auth`; restored authorities revoked and keys cleared; completed deletion replay despite newer snapshot creation time; old cookies 401, public read 200, auth capability ready only after successful drill. HTTP client; browser restore drill still NOT RUN. | PASS local HTTP drill |

## First failure → correction → retest

- Retention product defect: cleanup only removed credentials when retiring the entire
  flow. Live flow with expired full S and old rotated R violates R9 Q18. The migration
  stores only exact `(flow_id, kind, issued_seq)` fences, no token/hash/CSRF/member data;
  flow retirement cascades these fences into the existing permanent retired-flow fence.
  No maximum-sequence inference, TTL change or wildcard cookie deletion. Obsolete
  cleanup cannot cancel a newer admitted transition; unknown cookie names are retained.
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

## R23 §8 requirement inventory

Rows are in source order, R23-01…29 are local ledger identifiers. Partial subset PASS
does not mark an entire row complete. Remaining browser stage/death/delivery work uses
`npm --prefix frontend run test:e2e:api -- auth-races.spec.js auth-recovery.spec.js`;
B/ entries use `cd backend; uv run --frozen python -m pytest <listed-file>`.
| Case | Inherited evidence / applicability | Expected remaining verification | Current complete-row verdict / follow-up |
| --- | --- | --- | --- |
| R23-01 Preparation → anonymous → login | C: E115/E116; B/contracts/test_auth_flow.py `test_prepare_requires_recovery_receipt_before_admission`; F/auth-prepare.spec.js actual preparation; F/auth-login.spec.js login/refresh/logout | Reuse journey: ID persisted before R, actual R receipt before permit, one execution, next request proves new S before private display. Extend end to T06 detail, not duplicate primitives. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-02 Two tabs start transitions | P: E115; F/auth-prepare.spec.js `two real tabs serialize preparation`; B/contracts/test_auth_flow.py concurrent execution | Two member transitions in one browser context; first owns lock, second waits and reads server state; duplicate raw HTTP rejects atomically. Shared storage alone is insufficient. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-03 Lock-owning tab closes before admission / after admission / during hashing | M: no committed browser stage matrix; E116 B/contracts/test_auth_login.py settle-during-hashing supplies only a primitive | Real page close at each barrier, surviving tab settles/checks the original ID, late executor cannot commit after fencing. Lock release is not completion proof. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-04 Before DB commit termination versus committed/no headers | P: E116/E117/E119; F/auth-login.spec.js committed-login loss; F/auth-password.spec.js committed-change loss; F/admin-approval.spec.js lost approval | Add real process/transaction interruption before commit and explicit after-commit barrier; distinguish tab close from process death. Successful commit remains succeeded despite delivery loss. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-05 Headers received then body interrupted/abort | M: no streaming browser case in E115–119 | Deliver actual Set-Cookie headers, stall/chop body, close/abort; inspect subsequent cookie ingress and server result. Never infer rollback from body failure. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-06 Old response arrives after new login | P: E115 B/contracts/test_auth_flow.py `test_current_s_never_falls_back_to_old_cookie_or_string_maximum`, retired IDs; E116 response loss | Deliver old S and R response bytes after newer generation; duplicate delivery cannot replace current authority; absent current cookie must not fall back. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-07 Old deletion response arrives after new cookie | M: attribute/unit deletion checks in E115 are not this browser ordering | Delay genuine deletion Set-Cookie until new S/R installed; only exact old names deleted; new selected cookies still sent. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-08 Password-change success, result S not received | C: E117; F/auth-password.spec.js `committed change with no reply...`; B/contracts/test_auth_flow.py exact-result discard | Preserve existing full chain: committed password unchanged, only its missing result S discarded, new password login works. Extend delayed-old-generation interaction rather than reimplement. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-09 First R loss and ready/abandon race | P: E115; F/auth-prepare.spec.js R loss before ready; B/contracts/test_auth_flow.py `test_ready_receipt_and_never_ready_abandon_are_atomic` | Real browser and competing HTTP, both commit orders; late old R cannot activate new flow; abandon only never-ready. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-10 R rotate versus auth final commit | M: E115 tests rotation, E116/E117 test final checks separately | Both serialized outcomes with real hashing and delayed finalization: rotate first fences pending; auth first makes old rotate stale; successful password change never undone. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-11 General save during pending transition | P: E119 B/contracts/test_admin_approval.py authority checks; T06 inherited protected reads | Use actual Phase 3 approval/key operations, not out-of-scope app CUD: pending blocks start/final mutation; 409, no automatic replay; safe explicit recheck. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-12 Late general request after transition failure/cancel | P: E115 primitive fencing, T06 inherited access/late-response tests | Keep S same, increment revision by failed/cancelled transition, deliver old detail/approval request and response; reject stale context without adopting latest headers; eligible drafts need continuity proof. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-13 Bad administrator reauthentication password | N/A actual execution: E119 capability gate; Phase 5 administrator reauth owner | Keep capability false and existing mock regression; do not claim real 401 reauth behavior implemented. | NOT RUN — Phase 5 owner; execution excluded |
| R23-14 Refresh/new tab/back/missed notification/focus | P: E116 refresh, E115 abort-old-GET, existing mock auth; E120 (committed T06) adds private behavior | Integrate actual T06 detail into all restore paths incl. pageshow/BFCache where available, no protected prepaint; failed recheck stays concealed. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-15 Observation gap A→logout→A / A→B→A | P: E117 F/auth-password.spec.js own-password draft discard; E120 (committed T06) general draft/cache | Complete private-cache and admin-pending-work cases in actual same-context tabs; same final ID does not resurrect stale work when identity revision changed. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-16 Revision-only same-member failure/reauth | P: existing mock recovery/drafts via E115/E119; E120 (committed T06) continuity predicate | Actual failed/cancelled transition without identity change preserves eligible hidden memory draft after recheck. Reauth execution branch N/A Phase 5. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-17 ID only, proof lost | C local: E115; F/auth-prepare.spec.js `ID only keeps the active flow...`; B/contracts/test_auth_flow.py recovery separation | Preserve public-only/no destructive reset/no member discovery. Couple expiry/eligibility branch to boundary suite; no unsupported assertion that ID authorizes state. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-18 ID lost, recovery proof valid | C local: E115; F/auth-prepare.spec.js `lost ID discovers proof...` | Discovery → stored original targets → explicit reset, no auto member restoration. Retest with member-origin state in T07 recovery journey. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-19 Reset response lost / multiple targets partially done | C local: E115; F/auth-prepare.spec.js `partial reset keeps every original target after committed response loss` | Retain original target list and eligibility recheck; member-context extension must not include a newer flow or prepare before all original targets are eligible. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-20 ID and valid proof all lost | P: E115 describes anonymous full-loss contract; no complete previous-member private-state chain | Clear ID and all proof, leave delayed old response queued: restricted new-visitor behavior, old work outcome remains unknown, old protected state discarded, late old flow isolated. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-21 Result 30-minute unavailable / within-one-hour deletion then late request | P: E115 B/contracts/test_auth_flow.py `test_settle_before_admission_fences_unknown_and_unavailable_is_not_failure`, retired IDs | Advance controlled clock, query unavailable with execution_blocked both false/true as appropriate, sweep, replay old ID; current revision fence survives record deletion. Browser distinguishes unavailable from failed. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-22 60-second permit / departure S / flow expiry | P: E115/E116/E117 exact-time contracts and final-check races | Add actual delayed HTTP finalization at before/equal/after boundaries and assert DB/cookie/UI result; browser timer never grants authority. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-23 Cookie budget/late arrival/current eviction | P: E115 B/contracts/test_auth_flow.py budget/observed-reduction/late-cookie tests; E117 budget-before-hash | Browser 8-cookie/2KiB issuance budget, precise invalid-name deletion and re-observation, unknown names retained; current S removed and late S/R delivered. Deterministic clearCookies is simulated eviction, not proof of physical-browser eviction policy. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-24 Feature/storage/SecureContext failures | P: E115 F/auth-prepare.spec.js blocked storage/Web Locks; actual six-environment SecureContext not run | Add Fetch/AbortController/storage-event failure cases where absent, distinguish unsupported from network failure; public remains usable. Real devices remain public gates. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-25 Normal restart | P: E115/E116 B/test_auth_restart.py and B/contracts/test_auth_flow.py startup reconciliation | Existing TestClient restart/synthetic executing row is not process-crash browser proof. Kill actual server with pending and succeeded flows; same DB/browser cookies, no fixture reinjection; cancelled/fence, original valid S and clocks preserved. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-26 Backup restore | P: E115 CLI invalidation; E118 B/test_pending_retention.py replay/ledger/readiness; E119 restored business keys | One integrated real-process restore drill using SQLite backup, current independent deletion ledger, CLI, readiness and actual pre-backup browser cookies; host operating drill remains gate. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-27 Authority loss/revoke/delete/reset races | P: E116/E117 final checks; E119 B/test_approval_races.py revocation while hashing and F/auth-lifecycle.spec.js old-S rejection | Browser/HTTP revoke vs login/password/private read, both legal ordering outcomes; verify all old sessions rejected after reapproval. Account deletion/general-member reset execution N/A Phase 5. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-28 No-S logout 204 while other result unknown | P: E115 B/contracts/test_auth_flow.py `test_no_session_logout_is_origin_only_and_not_a_settlement` | Real browser with unknown original operation and S absent: 204 does not erase original transition evidence; explicit reconciliation still required. | NOT RUN — T07 implementer; inherited and named subset only |
| R23-29 Mock reset versus delayed response | C, mock only: E115/E119 mock regression; `frontend/e2e/auth-recovery.spec.js`, U/auth-service.test.ts | Retain reset coverage incl. late responses, mock-only storage cleared and API flow key preserved. Never count it as actual S/R cookie race evidence. | NOT RUN — T07 implementer; inherited and named subset only |

## I01–I24 (#113)

| Requirement / applicability | Inherited test, expectation and command locator | Current full-scope verdict / owner |
| --- | --- | --- |
| I01 identity/normalization | C: E115/E118; B/test_auth_migrations.py, B/contracts/test_auth_register.py normalization/unique-ID/duplicate-nickname. Preserve owner IDs and DTO privacy in T06 integration. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I02 new password policy | C: E117/E118; B/contracts/test_auth_password.py whole-blocklist policy, B/contracts/test_auth_register.py, F/auth-password.spec.js confirmation unsent. R15 rights are separate gate. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I03 unapproved signup/history | C: E118/E119; B/contracts/test_auth_register.py, B/contracts/test_admin_approval.py; F/auth-lifecycle.spec.js. No auto-login/old-session revival. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I04 full/anonymous lifetimes and devices | P: E115/E116 B/contracts/test_auth_login.py 8h/idle, B/test_auth_restart.py, F/auth-login.spec.js other-device logout. T06 activity plus real restart remains. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I05 temporary/change_only | C for existing local slice: E117 B/contracts/test_auth_password.py short expiry/final checks; F/auth-password.spec.js. Add streaming/death ordering only. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I06 activity/revoke/public preservation | P: E116/E119 contracts/old live-S revocation; T06 adds permitted screen activity. Re-run clocks, all devices, old-S reapproval, public ownership/content. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I07 Origin/CSRF | C local: E115 B/contracts/test_auth_flow.py origin/referrer/non-ASCII tests; E119 approval proof. Host origin/proxy gate separate. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I08 login/signup authenticated conflict; 401 semantics | C Phase 3: E116/E118 B/contracts/test_auth_login.py and test_auth_register.py; F/auth-login.spec.js. Actual administrator reauth is excluded. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I09 rate limits/dummy hashes | C local: E116 B/test_auth_limits.py and bad-hash tests; E118 registration last-slot test. Fast hasher in limit tests is explicitly limited to counters; actual Argon2 evidence is separate. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I10 16KiB/hash pool/controlled saturation | P: E115–E119 size tests, B/test_auth_limits.py gate and five-second DB_BUSY. Local bounds covered; operating-host measurement NOT RUN. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I11 administrator CLI | C local: E117 B/test_admin_bootstrap.py actual PTY/atomic audit; F/auth-password.spec.js real bootstrap/recovery journey. Operating-account execution not authorized. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I12 recent-auth/Phase 5 scope | C Phase 3 gate only: E117 recent_auth start; E119 approval without recent-auth and false capabilities. Reset/delete/reauth execution N/A Phase 5, not PASS. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I13 changing S/R cookie names | P: E115 cookie attributes/current-only selection; B/contracts/test_auth_flow.py, F/auth-prepare.spec.js. Late delivery/deletion/eviction integrated proof missing. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I14 first preparation order | C: E115 B/contracts/test_auth_flow.py preparation; F/auth-prepare.spec.js actual storage-before-R/receipt. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I15 shared lock/permit/first execution | P: E115 concurrent anonymous preparation; E116/E117 final checks. Member multi-tab owner termination/stage matrix needed. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I16 unknown/settle/exact missing S | P overall: E116/E117 real committed loss covered; R23 stage matrix and header/body interruption incomplete. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I17 proof loss/recovery | P overall: E115 ID-only, R-only, lost ID, partial reset browser tests. Add prior full-member state/full loss/eviction and current-cookie races. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I18 protected context/atomic check/no replay | P: E119 approval context plus E120 (committed T06) detail work. Verify committed T06 tests then add adversarial delayed delivery. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I19 hide/recheck/identity revision drafts | P: E117 password draft and mock coverage; E120 (committed T06). Same-member history discontinuity and ordinary-revision continuity both required. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I20 invalid-cookie cleanup/8 names/2KiB | P: E115 B/contracts/test_auth_flow.py budget tests. Need browser re-observation, late duplicate names and eviction chain. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I21 flow/R/results retention | P: E115 contracts and `auth_maintenance.sweep`; no exhaustive live-flow obsolete-S/R cleanup evidence. New retention suite must prove all required bounds. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I22 restart/backup restore | P: E115/E116/E118/E119 contracts/CLI; real subprocess + browser + restored SQLite + independent ledger chain missing. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I23 runtime prerequisites/six environments | P local feature tests E115; all real environment public gates NOT RUN/BLOCKED. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| I24 services/mappers/mock separation/visual | P integration: E115–E119 U/mappers.test.ts, U/openapi-contract.test.js, builds and visual; new T06/T07 bundle and full visual-state coverage pending. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |

## Q01–Q12 (#113)

| Requirement / applicability | Inherited test, expectation and command locator | Current full-scope verdict / owner |
| --- | --- | --- |
| Q01 full signup/approval/session slice | C: E118/E119 F/auth-lifecycle.spec.js and B/contracts/test_admin_approval.py; integrate private endpoint without replacing prior proof. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q02 administrator scope | C local: E119 reads/approval/basic stats B/contracts/test_admin_approval.py; F/auth-lifecycle.spec.js false future capabilities. No admin app-list or Phase 5 activation. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q03 first admin change_only→full | C: E117 B/test_admin_bootstrap.py + F/auth-password.spec.js. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q04 initial wait vs revoked 90 days | C: E118 B/test_pending_retention.py and login deadline tests; E119 actual approval/deletion ordering. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q05 contact collection disabled | C: E118 B/contracts/test_auth_register.py and F/auth-register.spec.js, field errors/nontransmission; no invented support address. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q06 retain members/FK | C: E115 B/test_auth_migrations.py; E117 recent-auth migration preserves ID/ownership. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q07 no auto seed credential/history/approval | C: E115/E117 B/test_dev_seed.py and B/test_auth_migrations.py; repeat shared impact regression. Never run development seed against shared storage. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q08 integrated prerequisites before release | P: E115–E119 slice evidence exists; T06 inherited, T07 races and gates pending. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q09 existing authService/mapper/app seams | P: E115–E119 U/api-auth*.test.ts, app observation; T06 removes remaining mock-only private behavior, must inspect landed implementation. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q10 public list/private authorized detail only | P: E119 future capability gate; B/contracts/test_public_apps.py; E120 (committed T06) private matrix. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q11 reuse transport/no new framework | C baseline: E115 extraction + U/api-auth.test.ts/U/mappers.test.ts; evaluate any T07 defect diff for scope. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q12 evidence each slice, final integration only | P: E115–E119 have ledgers; T06 handoff and complete T07 traceability not yet available. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |

## T01–T07 and acceptance criteria

| Requirement / applicability | Inherited test, expectation and command locator | Current full-scope verdict / owner |
| --- | --- | --- |
| T01 | C slice, E115; B/contracts/test_auth_flow.py and F/auth-prepare.spec.js. Cookie-delivery combinations remain P in table above. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| T02 | C slice, E116; B/contracts/test_auth_login.py, B/test_auth_limits.py, F/auth-login.spec.js. Full-stage loss/restart combinations P. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| T03 | C local implementation with recorded failures/retests, E117; B/test_admin_bootstrap.py, B/contracts/test_auth_password.py, F/auth-password.spec.js. Do not relabel ASGI races as browser races. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| T04 | C slice, E118; B/contracts/test_auth_register.py, B/test_pending_retention.py, F/auth-register.spec.js. Integrated restore with browser still P. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| T05 | C slice, E119; B/contracts/test_admin_approval.py, B/test_approval_races.py, F/admin-approval.spec.js/F/auth-lifecycle.spec.js. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| T06 | C inherited at dabd663: E120; B/contracts/test_auth_access.py and F/auth-access.spec.js cover current private permissions/context/activity, hide/recheck and identity history. Browser streaming integration remains incomplete. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| T07 | P inherited primitives; new local integration M; all public gates NOT RUN/BLOCKED. This plan is not completion. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |

## R7 Phase 3 clauses and boundary examples

| Requirement / applicability | Inherited test, expectation and command locator | Current full-scope verdict / owner |
| --- | --- | --- |
| Q1/Q2/Q16/Q17 identity, NFC/codepoints/nickname | C: E115/E118 migrations and B/contracts/test_auth_register.py; public nickname separation E116/F/auth-login.spec.js. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q3/Q19 password/blocklist | C local: E117 B/contracts/test_auth_password.py and startup refusal; redistribution permission BLOCKED U02. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q4/Q18 optional contact format | C Phase 3 refusal/null/empty scope E118; actual nonempty collection/validation acceptance N/A until collection approved. Do not implement it here. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q5 approval state and history | C: E118/E119 registration/approval/lifecycle contracts. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q6 member reset | N/A Phase 5 execution; change_only consumers already C in E117, but do not count reset workflow PASS. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q7/Q8 full lifetimes/nonpersistent cookie | P integrated: E116 expiry and E115/E117 cookie attributes C; actual browser restore/device semantics remain gate. No promise that browser exit logs out. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q9 device-local logout/all-session revocation | C Phase 3 E116/E119 tests; cross-process/private interaction P; reset/delete execution N/A. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q10 recent-auth | C no-extra-reauth approval E119; reset/delete enforcement N/A Phase 5. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q11 anonymous lifetime/token rotation | C primitives E115; R23 replaces old fixed-name/implicit-issuance wording. Late deliveries P. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q12/Q29/Q31/Q37 counters and exclusions | C local E115 preparation/anonymous; E116 B/test_auth_limits.py and approval/expiry precedence; E118 registration. Preserve 10/200 per 15min, registration 100/hour; error-specific counter assertions. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q13/Q30 bounded body/hash/DB resources | P: E115/E116/E119 body/pool/DB_BUSY C; operating measurements NOT RUN. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q14 trusted proxy/client IP | P local forged forwarded-header rejection E115/B/contracts/test_auth_flow.py; real proxy chain/spoof-resistance BLOCKED operating evidence. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q15/Q32/Q33 CLI/atomic audit | C local E117 B/test_admin_bootstrap.py and F/auth-password.spec.js; operating execution NOT RUN. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q20/Q21/Q22/Q34/Q35/Q36 temporary/full transitions | C T03 B/contracts/test_auth_password.py exact/final boundaries and F/auth-password.spec.js. Private 404 part Q22 awaits E120; integrated interrupted-body change remains M. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q23 screen activity vs polling | P: E116 GET nonextension; T06 expected permitted activity. Reverify latest code against boundary matrix. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q24/Q25 administrator reauth/draft-resume execution | N/A Phase 5; generic identity-history draft protection belongs to T06 and remains P until evidence arrives. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q26 login/signup conflict | C E116/E118 full and change_only conflict tests. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q27 Origin/CSRF/no-S logout | C primitive E115/E116; no-S unknown browser chain P. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q28/Q39 stale state, no replay, transition serialization | P E115–E119, T06 expected; new T07 delivery matrix required. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| Q38 errors/state distinctions | C local per-slice contracts/mapper tests E115–E119; reauth-specific errors N/A; verify T06 detail 404 exception and unknown after body loss. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| §9 example: 08:59 login before 09:00 temporary expiry | C E117 `test_short_expiry_uses_the_earlier_temporary_deadline_and_full_clocks_start_at_change`; add real delayed finalization at 09:00 without waiting wall-clock hours. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| §9 example: change entered before but commits at expiry | C ASGI E117 final-check parametrization; P actual-process/browser stage chain. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| §9 example: unapproved+expired precedence / no failure count / already limited | C E116/E117 approval-precedence and B/test_auth_limits.py; retain table-driven cases. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| §9 example: own-change T+8h/T+30m/T+15m | C E117; reauth extension clause N/A Phase 5, normal restart integration P. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| §9 example: wrong admin reauth does not log out | N/A Phase 5, same as R23-13. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |
| §9 example: late anonymous/logout cannot undo new login | P E115 server selection and two-tab preparation; M/P actual delivery ordering in R23-03/06/07. | NOT RUN — T07 remaining integration; future execution portions excluded to Phase 4–6 owners |

## AC1–AC12 traceability

Applicability is local verification for AC1–8 and separate public/human gates for
AC9–12. Commands and HTTP/DB/cookie/DOM seams are H1/B1–B3/E1–E3 above; final integration
commands are listed in the remaining-work section. A NOT RUN row may have named PASS
subsets without complete-row acceptance. Follow-up for local work is T07 implementer;
public owners are in the separate gate table.

| AC | Inherited evidence / expected | Current evidence and limitation | Verdict |
| --- | --- | --- | --- |
| AC1 | E117–E120; all four replayable demo journeys including private detail | Existing journeys inherited; new loss/recovery E1/E2. Fresh combined lifecycle/private/CLI/reapproval linkage NOT RUN. | NOT RUN |
| AC2 | E115–E120 / all applicable R23 §8 stage/outcome rows | H1, B1 and E1/E2 real observations pass named cases. Before-admission/late delivery/rotate and missing password-death cases remain. | NOT RUN |
| AC3 | E115–E117 / all proof-loss/current-cookie/budget branches | E1 missing/received real S; E3 ID-only simulated proof loss. Full-member and late budget branches incomplete. | NOT RUN |
| AC4 | E115–E120 / all time and cleanup boundaries, restart/restore/readiness | B1 process death, B2 cleanup, B3 actual CLI/backup/redelete. Browser/negative drills and exhaustive boundaries incomplete. | NOT RUN |
| AC5 | E115–E120 / I/Q/T/R7/R23/US per-case evidence | This inventory checkpoint covers I/Q/T/R7/R23/AC applicability and expected work; finalized US map and complete-row verdicts pending. | NOT RUN |
| AC6 | E120 impact analysis / full backend once and affected frontend/CI | Targeted tests only; product cleanup and migration affect startup/readiness and all auth consumers. Full backend, pending/approval/public/seed impact and frontend integration remain. | NOT RUN |
| AC7 | E120 runner / unavailable and active isolated boundary, no external egress | E1 real prepared fault mode runs 9/9 with zero skips. Default unavailable+active+capture integration has not run. Original temp DB ownership/bootstrap/teardown retained. | NOT RUN |
| AC8 | E115–E120 captures / all required states at five exact viewports | No new T07 PNGs/manifests/checker or two independent reproductions. Source and product-only remain distinct. | NOT RUN |
| AC9 | R23 operating runtime contract / six actual environments, contemporaneous stable versions | No real device/browser/HTTPS/HTTP2 acceptance; local Chromium is not a replacement. Device tester/U01. | NOT RUN |
| AC10 | R9/R15 / real host, proxy, cleanup/restore, U01/U02 | B3 is supporting local restore evidence only; operating owner/U01/U02 evidence absent. | BLOCKED |
| AC11 | R23/#113 / actual product visual, operator readiness and human public acceptance | No actual acceptance supplied; DomineYH/operator/human owners. | BLOCKED |
| AC12 | #121 / four separate verdicts, public authorization withheld, parent left open | Four verdicts recorded below; no issue/PR mutation or release authorization. This record does not complete missing gates. | NOT RUN |

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
| Windows Chrome | NOT RUN | Actual supported Windows/current stable Chrome versions and complete required auth/cookie/restore cases; device tester/U01 coordination. |
| Windows Edge | NOT RUN | Independent actual Edge run, not Chromium branding assumption; same requirements. |
| Windows Firefox | NOT RUN | Actual Gecko run; same requirements. |
| macOS Safari on real Mac | BLOCKED (needs human/U01/U02) | Real machine availability and exact stable OS/Safari versions, actual cookies/locks/restore; U01/device tester (U01 dependency). |
| Android Chrome on real device | BLOCKED (needs human/U01/U02) | Actual device/OS/stable Chrome and background/restore/tab behavior; U01/device tester (U01 dependency). |
| iOS Safari on real device | BLOCKED (needs human/U01/U02) | Actual iPhone/iPad context as approved, OS/stable Safari, background/history/cookie behavior; U01/device tester (U01 dependency). |
| Same-origin HTTPS/proxy and applicable HTTP/2 | NOT RUN | Production-equivalent route/TLS/ALPN and independent cookie response ordering, attributes and next-request ingress. Explicitly document applicability; do not waive HTTP/2 because localhost uses HTTP/1.1. Operating owner. |
| Runtime primitives in each of six environments | NOT RUN | SecureContext, real Web Lock exclusivity, localStorage read/write/cross-tab events, Fetch, AbortController and actual cookie receipt; unsupported path public-only. Feature-presence probes alone insufficient. |
| Cookie storage/eviction/session restore across environments | NOT RUN | Actual receipt/late Set-Cookie/old deletion/current-missing behavior, distinguish manually cleared and naturally evicted cookies; browser-close behavior not promised logout. |
| Host hashing/pool/DB-lock measurements | NOT RUN | Actual deployment host Argon2 profile/cost, concurrent2/queue4/wait1s candidate load behavior, controlled AUTH_BUSY/Retry-After and DB lock bound. Local five-second test is not host capacity. Operating owner. |
| Trusted proxy/client-IP/spoof-resistance | NOT RUN | Actual trusted hop configuration/direct access restriction/client IP derivation, forged Forwarded/XFF tests and rate bucket behavior. Operating owner. |
| Cleanup and backup/restore operations | NOT RUN | Actual scheduler, failed-sweep response, backup inventory/max retention, current independent ledger, stop/restore/invalidate/redelete/readiness drill and failure recovery. Local temp-DB drill is supporting evidence only. Operating owner/R9/#16. |
| Authentication readiness/operating configuration | NOT RUN | Correct migration, fixed blocklist integrity, secret/path permissions, valid current references, missing-list refusal, health/auth readiness distinction, maintenance failure recovery on actual host. |
| U01 support addresses, devices, staffing/schedule | BLOCKED (needs human/U01/U02) | Real service operator-supplied contact/configuration and responsible schedule; U01 owner. Keep support null until supplied. |
| U02 blocklist redistribution rights | BLOCKED (needs human/U01/U02) | Documented right to include fixed source in image/package; U02 owner. Local explicit provisioning neither resolves rights nor authorizes redistribution. |
| DomineYH actual product visual acceptance | BLOCKED (needs human/U01/U02) | Explicit acceptance linked to exact screenshots/build and unresolved differences; DomineYH. Design auto-approval is not visual approval. |
| Operator readiness acceptance | BLOCKED (needs human/U01/U02) | Named operator's actual preparation evidence and acknowledgment; do not infer from developer tests. |
| Human public-release acceptance | BLOCKED (needs human/U01/U02) | Explicit human acceptance after all applicable gates and U01/U02 resolved; no automatic release from ready-for-agent/green CI. |


## Checkpoint commits and static verification

`f2bf54e` fault harness; `b5a588e` real-cookie/process races and runner selection;
`af41348` separately proven retention defect + migration; `552cb0c` HTTP restart/restore.
The final named tests exercised the same product/test source content before these commits;
subsequent changes are this read-only checkpoint ledger. `ruff check .` and
`ruff format --check .` PASS (57 files); targeted ESLint and Prettier PASS on all nine
changed/new JS/MJS/config files. No full frontend check or full regression is implied.
First targeted ESLint invocation from repository root failed to locate the config;
rerun from frontend succeeded without configuration edits.

**BLOCKED checkpoint: implementer usage budget**, per the brief's explicit handoff rule.
This blocks continuation of local work in this run; U01/U02 only block public gates.
Do not close #121/#113 or claim final integration completeness from these partial results.
The coordinator owns continuation and later CI; API CI is functional-only unless it
provisions the same pinned capture renderer. No local capture hash/visual acceptance
can be inferred from bundled CI Chromium.

## Four separate verdicts and remaining work

| Verdict | Current result |
| --- | --- |
| Local integration completeness | INCOMPLETE — remaining stage/outcome, browser recovery, boundaries and visual work below |
| Automated verification | Targeted subsets PASS; final integrated suite NOT RUN; CI NOT RUN (coordinator owns push/PR/CI) |
| Human actual product visual acceptance | BLOCKED — DomineYH acceptance not supplied |
| Operating authentication public-release authorization | WITHHELD — all required public gates remain NOT RUN/BLOCKED |

Full AC1–12 completion is NOT RUN. AC1 inherits existing journeys but needs T07 end-to-end
integration linkage. AC2/3 only named E1–E3/B1 subsets passed: pre-admission tab close,
worker-win/rotate order, late/duplicate old S/R and late exact deletion, full-member
R-only/ID-loss/total-loss/partial reset, execution_blocked branches and cookie-budget
re-observation remain NOT RUN. AC4 lacks exhaustive ±1µs process/browser boundaries,
password death/finalization, transient maintenance-lock cases, browser normal-restart/
restore and negative ledger/readiness drills. AC5 has this inventory checkpoint but
requires finalized per-row HTTP/DB/cookie/screen evidence and complete US-01–55 mapping.
AC6/7 final default unavailable+active/capture runner, backend full pytest once, ruff,
frontend test/check, affected mock, visual auth/admin, both builds, dist/reference and
coordinator CI remain NOT RUN. Do not repeat full pytest before implementation stabilizes.
AC8 missing five-viewport captures, two independent functional-to-fixed-clock runs,
captures/reproducibility manifests and read-only check-auth-integration-evidence.mjs
remain NOT RUN. AC9–12 public gates/acceptances remain as above, never automatic PASS.

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
