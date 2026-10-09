# Operational checks and explicit recovery

This runbook connects #201 to the existing [migration](migrations.md),
[backup](backups.md), [restore](restores.md), [logging/retention](logging-retention.md),
and [health](health-checks.md) procedures. It supplies local evidence for
[#144](https://github.com/DomineYH/vibe_coding_archive/issues/144) G10/G12/G13/G17;
it does not reproduce G01–G18 or grant release/activation approval.

Run commands as the nonprivileged `eduvibe` account from the installed backend,
with the existing private runtime environment. Keep `HEALTH_CHECKS_ENABLED=false`
in `/etc/eduvibe/runtime.env`. Examples below are operator procedures, not actions
performed by the implementation agent. Do not put HMAC values, credentials,
cookies, contact information, SQL, or raw exception messages in evidence/logs.

## Observational checks

```sh
.venv/bin/python -m app.cli ops-check --backup-dir /srv/eduvibe/backups \
  --required-free-bytes <operator-reviewed-headroom> \
  --observations-file /srv/eduvibe/operations/observations.json
```

The headroom argument is an integer byte count covering the reviewed peak growth
and backup/restore requirement. There is no invented universal reserve. Omitting
it produces `headroom=UNCONFIRMED`. The observations argument is optional.
The installed `eduvibe-ops-check.service` uses the existing `BACKUP_ROOT` in
`backup.env`; its persistent timer runs every five minutes (`OnCalendar=*:0/5`).
It deliberately preserves exit 3 as a service failure. Receipt/response needs
external operator confirmation: there is no mailer or alarm sender in this unit.

Output is one JSON object containing a generated evidence UUID, fixed category
codes, and aggregate queue/backup counts. No input evidence ID, supplied number,
path, database row, secret, fingerprint or provider payload is echoed.
Exit codes: 3 = completed with unresolved/restricted checks; 1 = inspection
failure (other inspectable categories still reported); 2 = invalid usage/config;
130/143 = interrupted. Current inputs cannot establish every required category,
so there is no all-clear exit 0. A timer result never authorizes resume.

The DB and independent deletion ledger are opened with SQLite `mode=ro`,
`query_only=ON`, the existing five-second busy timeout, and a SELECT-only
authorizer. No startup, gate constructor, reconciliation, sweep, migration,
checkpoint or retention maintenance runs. Committed live WAL rows remain visible;
`immutable=1` is never used. Business rows, schema, DB and WAL bytes remain
unchanged when writers are quiescent. SQLite readers may update shared-memory
read metadata; filesystem sidecar metadata is not the business-data guarantee.

| Category | Interpretation and action |
| --- | --- |
| database | `OK` requires the installed Alembic head; mismatch restricts. A real exclusive read lock reports `DB_BUSY`; a readable WAL writer does not. |
| db_busy | Supplied count >=5 in five minutes restricts; lower valid count is `OBSERVED`; absent count is unconfirmed. |
| worker | Same boot, ready, heartbeat age strictly below 15 seconds, and no stale running lease are required. At 15 seconds it restricts. Missing worker is unconfirmed. Existing worker heartbeat/lease timing remains 5/15/30 seconds. |
| queue | Executable queued work waiting at least five minutes restricts. Future cooldown, old URL versions, exhausted attempts, terminal jobs and jobs aged 24 hours are excluded. Wait begins after the later of creation/cooldown eligibility. |
| disk/headroom | >=80% used warns; >=90% or fewer available bytes than reviewed headroom restricts. Both DB and backup filesystem space are checked. |
| backup/rpo | A structurally valid private manifest/ciphertext pair with matching digest is `LOCAL_ONLY`, not age-authenticated or remote-confirmed. A malformed/tampered pair or incomplete staging evidence reports failure even with an older valid pair. Latest valid recovery point older than 24 hours restricts; exactly 24 hours meets RPO. |
| retention | Original manifest expiry controls cleanup: creation+29 days is `CLEANUP_DUE`, +30 days `EXPIRED`. Copying/mtime/checking cannot refresh expiry. The checker deletes nothing; explicit purge remains separate. |
| ledger/remote/backup_attempt | Local consistency is `LOCAL_ONLY`; missing ledger is unconfirmed and mismatches/failure restrict. Latest independent ledger continuity, complete copy inventory, remote durability and last scheduled backup attempt cannot be established here and remain unconfirmed. A valid older pair does not prove the last scheduled attempt succeeded. |
| runtime/auth_configuration/reset_supply | Runtime API/TLS readiness is unconfirmed: config eligibility and a verified supplied reset file are observations, not running capability. Missing/unsafe supply is unconfirmed. No `/meta` or URL is probed. |
| maintenance/health_configuration | Existing maintenance markers report restriction; absence is only `ABSENT`. The required health configuration is `DISABLED`. Neither markers nor revoked records are edited by checks. |
| alarm | Valid receipt input is `OBSERVED`; `FAILED` is failure, missing/unacknowledged input unconfirmed. This code delivered no alarm. |
| cost/prepaid | Monthly cost >=40,000 warns, >=45,000 restricts, >=50,000 reaches the cap; prepaid spend >=100,000 reaches the cap. Missing input is unconfirmed. |
| contract | Renewal within 30 days warns; within seven days without confirmed renewal restricts, including expired contracts. This schema has no renewal-approval field; updated expiry needs separate operator evidence. |

The #16 one-minute liveness/three-failure rule remains an external operational
check; this five-minute local timer does not implement a liveness probe. Abuse
counts and CPU/memory categories are outside #201's approved scope.

### Protected observations

The optional JSON is owned by `eduvibe`, mode 0600 in an owned 0700 parent,
without symlinks/hardlinks/untrusted writable ancestors, and at most 64 KiB.
Use exactly these fields (placeholder strings below are documentation only):

```json
{
  "version": 1,
  "checked_at": "<UTC ISO-8601>",
  "evidence_id": "<UUID>",
  "db_busy_5min": 0,
  "alarm_delivery": "CONFIRMED",
  "cost_month": 0,
  "prepaid_spent": 0,
  "contract_expires_at": "<UTC ISO-8601>"
}
```

Only version/checked_at/evidence_id are required. Numbers must be nonnegative
integers (booleans are rejected); alarm_delivery is CONFIRMED or FAILED.
Times must have UTC offset zero. Unknown/duplicate keys, wrong types,
unreadability, invalid protection, malformed JSON, more than 15 minutes of age,
or a future checked_at invalidate the entire file: every observation-backed
category becomes UNCONFIRMED. Missing optional fields are individually
unconfirmed. Protected input is still an operator observation, not a provider
adapter, authoritative copy inventory, receipt test, or independent proof.

## Restrictions and manual resume

Keep a private operator evidence record for **each** cause: disk/headroom,
DB_BUSY/worker/queue, backup/RPO/expiry/ledger/copies, alarm fallback,
cost/prepaid and contract. The checker applies and clears no restrictions.
If a fine-grained growth restriction cannot be enforced by existing controls,
use the T05 whole-service maintenance + stop procedure. Do not add an implicit
registration gate or raise a limit to conceal a cause.

For alarm transport failure, an independent manual VM/backup/cost check fallback
is allowed for at most 24 hours only with evidence that safety restrictions and
these checks are actually maintained. Otherwise restrict immediately. Actual
alarm receipt, response and host performance belong to T12 #204 / #144 G10.

Clearing disk pressure does not clear cost restrictions; month rollover does not
clear backup or contract restrictions. Timer success, process restart, or marker
removal alone cannot reopen an already latched API. Before manual resume verify
all causes resolved, head/current release, auth/authority state, original
expiry clocks, recent backup/RPO and independent ledger/copy evidence,
reviewed headroom, costs/contract and required existing approvals. Follow the
migration runbook for `.migration-blocked`; `.restore-blocked` remains permanent
quarantine. Never remove a revoked health record or fabricate activation to resume.

## Explicit health disable

1. Keep ingress closed/restricted as required by the service runbook.
2. Run `.venv/bin/python -m app.cli disable-health`. It validates and atomically
   renames an existing protected activation record to a UUID-suffixed private
   `.revoked-…` evidence sibling, without overwriting evidence, and fsyncs its
   parent. Missing activation is already disabled; no record is created.
   It cancels queued/running jobs through the existing `FEATURE_DISABLED`
   transition and preserves terminal jobs/results/original timestamps.
3. Exit 3 `HEALTH_STOP_REQUIRED` means the lifetime lock is held. The CLI does
   **not** claim OS termination. An operator must run:
   `systemctl stop eduvibe-health-worker.service`, then verify inactive state,
   MainPID=0, empty cgroup and actual process/socket termination.
4. Rerun `disable-health` to complete cancellation and observe a free unchanged
   lock inode (exit 0 `HEALTH_DISABLED`). Never unlink/replace the worker lock.
   Finish with `HEALTH_CHECKS_ENABLED=false` in persistent runtime config.
5. Failure/interruption means no completed-stop claim. Revocation is never
   rolled back after cancellation/fsync failure. Stop the worker, inspect actual
   protected files and job state, then rerun; do not restore an old activation.

A future independently authorized reactivation requires new operator evidence,
not an agent-generated record. Cancelled jobs cannot resurrect on restart.

## Reset HMAC rotation or loss

Close ingress, stop the health worker and API using the fixed T05 units, and
verify actual termination/empty cgroups with no concurrent maintenance/rotation.
The production command independently performs read-only `systemctl show -p
ActiveState,MainPID` for `eduvibe-api.service` and
`eduvibe-health-worker.service`. Missing/unavailable/active state or nonzero PID
refuses with exit 3 `RESET_STOP_REQUIRED`. There is no production bypass;
APP_ENV=test accepts only a test-injected process-state reader.

```sh
.venv/bin/python -m app.cli rotate-reset-key --invalidate-only
# Only after explicit authorization to generate/replace the configured supply:
.venv/bin/python -m app.cli rotate-reset-key --generate
```

The two flags are mutually exclusive. Secret bytes never come from argv/env or
output. An owned exclusive 0600 `.rotation` temp sibling serializes rotations;
no `.migration.lock` or maintenance marker is touched. Existing unsafe leaf,
parent, symlink, hardlink or mode refuses publication. No directories are
created. All outstanding reset operations are durably invalidated through the
existing reset transaction, including checked audit persistence, before new
32-byte secret/SHA256-key-id JSON is fsynced, atomically replaced, parent-fsynced
and verified. No duplicated reset SQL or gate initialization is used.

`--invalidate-only` does not generate supply: a lost key remains missing and
issue/execute stay unavailable; lookup/cancel and prior successes remain.
Rotation preserves success history and original created_at/expires_at.
A late hashing request cannot commit the invalidated operation. Existing API
processes stay latched; CLI completion never starts a service or grants resume.
After failure/interruption, inspect actual state before rerunning; committed
invalidations are not undone, and uncertain publication is not reported as
success. A stale temp after abrupt process death requires operator proof that
no rotation is alive before removing it. Never restore outstanding old work.

## Synthetic load measurement (deferred long profile)

The stdlib `tests.ops_load` harness creates a dedicated temporary migrated
APP_ENV=test DB, uses the existing public/private fixture helper, distributes
synthetic apps across synthetic members, starts the existing prepared API
process, and makes real HTTP list/detail GETs to a literal loopback address.
It refuses nonisolated paths, production mode, remote hosts and redirects;
proxies are disabled. Test member hashes are placeholders for public-read load,
not usable login credentials. No production seed or production data is used.

The tiny test runs six requests at concurrency two. Its pass criteria are actual
HTTP responses/request counts and percentile calculation, never a latency target.
For the separately authorized T12 host measurement, from backend with an explicitly
prepared PASSWORD_BLOCKLIST_PATH:

```sh
APP_ENV=test HEALTH_CHECKS_ENABLED=false uv run --frozen python -m tests.ops_load \
  --members 1000 --apps 5000 --concurrency 50 --warmup 300 --seconds 600 --repeat 3
```

Warm up 300 seconds, then measure three 600-second samples, alternating public
`GET /api/v1/apps` and `GET /api/v1/apps/{id}`. Save request count, error count
and measured nearest-rank p95_ms in private evidence with host resources/release,
not secret payloads. Compare to the 500ms planning target on the actual 2vCPU/4GB
host; no target is encoded as PASS. Password hashing/serialized-write scenarios
are separate: use the existing prepared-auth process seams and real login,
reauth, password reset and simultaneous writer-contention tests, with synthetic
passwords supplied through stdin/HTTP, never argv. Record hash-gate admission,
DB_BUSY, failures and actual durations separately from public reads. The long
profile, supervisor behavior and alarm receipt were NOT RUN locally or in CI.
