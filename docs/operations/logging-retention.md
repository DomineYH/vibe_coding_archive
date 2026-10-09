# Safe logging and local retention

T06 implements #200 with the coordinator's decision-t06 amendments. It provides local boundaries and policy checks; it does not certify legal applicability, remote deletion, deployment, or host enforcement.

## Supported entrypoints and sinks

From `backend/`, use the configured environment with `HEALTH_CHECKS_ENABLED=false`:

```bash
uv run --frozen python -m app.api --host 127.0.0.1 --port 8000
uv run --frozen python -m app.health_worker
uv run --frozen python -m app.cli purge-expired --backup-dir /srv/eduvibe/backups
```

The API launcher installs the safe formatter before loading the application, disables Uvicorn access logging, and trusts proxy headers only from loopback. Deployments must use this launcher. The earlier raw Uvicorn example in static-serving.md does not install this boundary. Worker execution remains disabled without its independently verified activation; this handoff creates no activation record.

Application JSON events contain fixed codes, UTC time, server-generated UUIDs, registered route templates (or `unmatched`), numeric status, and duration. No request/client ID, path parameter, raw query, header, cookie, body, exception, SQL statement/parameters, remote response, contact, or credential is serialized. Third-party logging becomes `DIAGNOSTIC_SUPPRESSED`; the formatter never calls message/argument/traceback formatting. CLI retains only known constant operator guidance. Backup, restore and existing maintenance CLI commands retain their fixed status/error output without library diagnostics or an appended completion event; unexpected boundary failures still emit fixed error events. Failed API startup, CLI operations, and worker startup/runtime remain unsuccessful. Worker OS-exit 70 and existing signal/lock/socket behavior remain intact. A restored target emits only the fixed RESTORE_MAINTENANCE_REQUIRED event when the API or worker latches its block; blocked HTTP responses still produce safe completion events. Removing the marker does not re-enable a running process.

T05 API, worker and maintenance units must use `LogNamespace=eduvibe` with stdout/stderr directed to the journal. Install `deploy/journald/journald-eduvibe.conf` as `/etc/systemd/journald@eduvibe.conf.d/retention.conf`; it sets persistent storage, `MaxRetentionSec=7day`, daily file turnover, and a size cap in that dedicated namespace. Do not vacuum the shared host journal. Audit/legal records and deletion evidence stay in their existing databases, outside this namespace.

The Nginx template now requires **LOG_ROOT** in addition to the T01 render values. Set it to an absolute, private path outside RELEASE_ROOT, such as `/var/log/eduvibe/nginx`. Provision that owned directory as 0700 and `nginx-access.log` as 0600 for the actual Nginx unit UID. Add `"LOG_ROOT": "/var/log/eduvibe/nginx"` to deployment-values.json before rendering. The template's JSON access log uses only native `$request_id`, status, request duration and constant route classes. Native `error_log` remains `/dev/null` because its request diagnostics cannot be allowlisted. Supervisors must suppress raw Nginx startup diagnostics and report fixed failure codes.

Install `deploy/logrotate/eduvibe-nginx` under `/etc/logrotate.d/`. Its daily rotation, `rotate 7`, `maxage 7`, and rotation of empty files prevent a quiet log from retaining old archives indefinitely. USR1 reopens the log, without copytruncate; `create 0600` preserves the existing owner/group. T05 must bind the configured `eduvibe-nginx.service` and LOG_ROOT path to the actual proxy unit/UID. T12 must verify permissions, rotation/reopen, namespace enforcement, clock behavior and scheduling on the real host. **Real host enforcement is NOT RUN here.** Do not enable unsanitized duplicate sinks or upload private captures.

## Independent clocks

| Record class | Eligibility clock | Current enforcement |
|---|---|---|
| Request logs | Original event time + 7 days | Journald and Nginx host templates; pure boundary test |
| Health execution history | Existing finished-at + 7 days | Existing health maintenance; last connection result stays separate |
| Ordinary audit | occurred_at + 90 days, confirmed ordinary classification | Pure eligibility only; every production audit row retained |
| Legal access | At least one calendar anniversary, confirmed legal classification | Pure minimum only; every production audit row retained pending T11 |
| Backup pair | Original creation + 30 days; local cleanup at original expiry minus 1 day | Validated owned local pairs under the existing backup lock |
| Deletion ledger | Maximum original expiry of every relevant copy + 7 days | Pure eligibility only; every production ledger row retained pending T10 |

All boundary comparisons are inclusive. The calendar anniversary of February 29 clamps to February 28 in the following year. These functions are policy calculations, not classification, inventory verification, or permission to delete records. T11 must supply actual legal applicability, classification/fields and any longer minimum before audit deletion is implemented. Missing/empty copy inventory never makes ledger evidence eligible.

Copying files, changing mtime, repeating a run ID, or a logical dump/restore does not refresh creation, occurred-at or original expiry. `backup.validate_manifest` continues to reject expired restore inputs. Its separate structural validator permits expired inputs solely for local cleanup and still rejects future/inconsistent timestamps. Structural checks and ciphertext hashes do not authenticate a manifest or prove complete copy coverage. The logical round trip is tested; T04 provides the merged isolated restore CLI, while real-age restore and original-clock verification still require CI and T09 evidence.

## Purge and recovery

`purge-expired` validates the private backup root and database revision, then composes the existing auth sweep (including pending-member delivery), health cancellation/maintenance without invented stopped-worker IDs, and local backup cleanup. It never sets restored authentication, probes an external site, prunes permanent replay fences, deletes audit rows, or deletes ledger rows.

Output contains aggregate counts and fixed codes only. Sweep completion counts indicate completed phases; member/health row counts are observed nonnegative decreases and may include concurrent work. It always reports `AUDIT_CLASSIFICATION_BLOCKED` and `LEDGER_INVENTORY_BLOCKED` today. Exit 3 means local phases completed with those unresolved classes; exit 1 is runtime/partial failure; exit 2 is usage/configuration failure. Exit 0 is reserved for a future implementation with no blocked classes. A scheduler must not turn exit 3 into an all-retention-complete claim.

Backup cleanup uses the same persistent `.backup.lock` as backup creation. It never uses mtime or removes the lock. Only canonical run directories with owned 0700 directories, single-link 0600 files, exact pair names, valid original clocks and matching ciphertext size/hash are eligible. Symlinks, hardlinks, invalid manifests, extra files and uncertain ownership fail closed. Backup `.stage-*` publication directories are left alone.

Before unlinking an eligible pair, cleanup atomically renames it to reserved `.purge-<run UUID>` and fsyncs the parent. It keeps the manifest until ciphertext removal is durable. A retry can finish a validated manifest-only stage or remove an empty owned stage left by an interrupted final rmdir. Ineligible/malformed stages are rejected; arbitrary files are never recursively removed. Completed pairs are counted on partial failure. An uncertain fsync is a failure, not a successful durable deletion claim. Restore service only after operators resolve storage errors and T04's independent restore/reconciliation checks.

Unknown copy coverage is an unresolved operational prerequisite: retain independent deletion evidence and keep restore/reuse blocked until T10 supplies trusted inventory. Exit 3 is not a runtime readiness latch or approval to restore. No provider adapter, remote completion flag, record-policy file, copy-inventory format, or test-only trusted deletion bypass is implemented.

## Verification and remaining evidence

`test_safe_logging.py` captures real API HTTP output and CLI/worker process stderr in private test runs, scans synthetic sentinels without dumping them, and exercises normal/validation/busy/exception, unmatched/body-limit, startup and asynchronous failure paths. `test_purge_expired.py` checks fixed clocks, existing sweeps/replay fences, audit/ledger preservation, copy/logical round trip, local artifact validation, interruption, retry and host template values.

Native Nginx smoke captures safe access records and upstream stdout/stderr in a private directory with Playwright traces/screenshots/video disabled. It runs in CI with Nginx installed. Real age cryptography stays mandatory in CI; local controlled encryptors prove I/O and original-clock behavior only. No raw captures, database/dumps, identities, contacts, cookies, or test logs are published as evidence. T10/T11/T12 inputs and actual host/provider enforcement remain explicitly outstanding.

For service units, persistent locks and manual migration maintenance, see [explicit migration and service lifecycle](migrations.md).

운영 점검·명시 중지·reset HMAC 교체와 수동 재개는 [운영 점검 runbook](operational-checks.md)을 따른다.
