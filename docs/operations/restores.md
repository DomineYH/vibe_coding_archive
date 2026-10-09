# Isolated restore drills

`restore-db` and `verify-restore` are test-only local recovery drills (#198). They
never approve service resumption, replace a production database, or establish
remote durability. Real host loss, trusted current-authority inputs, ledger
continuity, operator acceptance and cutover belong to T10/T12 (#204) and the
existing #144 gate.

Use an explicitly configured `APP_ENV=test` database in a dedicated temporary
folder outside the repository, `PUBLIC_ORIGIN`, and
`HEALTH_CHECKS_ENABLED=false`. Development and production are refused. An operator
creates an owned **0700 empty target directory**. Supply the completed encrypted
backup directory, a native X25519 age identity file, and the separately observed
current independent deletion ledger. Input directories must be private 0700;
files must be owned single-link regular 0600 files with no symlink ancestry.
The backup's original 30-day expiry remains authoritative.

From `backend/`, with protected fixture paths already provisioned:

```bash
export APP_ENV=test HEALTH_CHECKS_ENABLED=false
export PUBLIC_ORIGIN=http://localhost:5174
export DATABASE_PATH=/tmp/private-drill/target/restored.sqlite3
uv run --frozen python -m app.cli restore-db \
  --backup-dir /tmp/private-drill/backups/00000000-0000-4000-8000-000000000001 \
  --identity-file /tmp/private-drill/keys/identity.txt \
  --ledger-file /tmp/private-current/database.deletions.sqlite3
uv run --frozen python -m app.cli verify-restore \
  --backup-dir /tmp/private-drill/backups/00000000-0000-4000-8000-000000000001 \
  --identity-file /tmp/private-drill/keys/identity.txt \
  --ledger-file /tmp/private-current/database.deletions.sqlite3
```

The paths and UUID above illustrate synthetic fixtures, not operating records.
Identity content never enters command arguments, logs or environment variables;
age reads it through a protected inherited file descriptor. Only native age
identities are supported; plugins, SSH identities and interactive passphrases are
refused. Encrypted/plain payloads are bounded at 128 MiB; manifest/key/metadata
inputs at 64 KiB. Plaintext archive and SQL remain in memory. The destination
SQLite database intentionally contains plaintext under private permissions.
No package installation or automatic seed occurs.

The sequence reserves `.restore-blocked` with exclusive creation **before any
plaintext destination**, checks the manifest and ciphertext, completes authenticated
age decryption, validates exactly two regular tar members and their bound metadata,
imports SQL with extension loading disabled and a restrictive SQLite authorizer,
checks revision/integrity/FKs, and explicitly migrates a known Alembic ancestor.
It makes an online SQLite replica of the supplied current ledger, validates both
existing deletion engines, calls `reconcile(restored=True)` once, runs the existing
retention sweep, and cancels/fences health execution. It preserves retained data
and original clocks; legitimate invalidation, cancellation and expired retention
cleanup use the existing policies. The source database, artifact and supplied
ledger are never repaired or overwritten.

A private `restore-receipt.json` binds the artifact core, target logical contents,
finished ledger replica, observed source ledger, revision and original expiry.
It flags legacy optional contact fields by count only; collection stays disabled.
`CURRENT_AUTHORITY_UNPROVEN` is always recorded: restored approval, password,
ownership and public status cannot establish their present authority. The receipt
is a local integrity record, not a signature, trusted inventory or approval.
`verify-restore` authenticates the artifact again and only reads existing state.
Any changed target, receipt, marker, original expiry or newly supplied ledger
contents fails verification and requires a fresh restore; verification never
repairs or releases the target.

| Exit | Meaning |
| --- | --- |
| 3 | `RESTORE_VERIFIED_LOCAL_ONLY_MAINTENANCE_REQUIRED`; local checks completed, service remains blocked |
| 1 | `RESTORE_FAILED`; crypto, integrity, migration, replay or verification failed |
| 2 | `RESTORE_USAGE_INVALID`; configuration, unsafe paths or nonempty target refused |
| 130 / 143 | `RESTORE_INTERRUPTED`; SIGINT / SIGTERM |

There is no successful exit 0 and no force/resume/unblock option. Failed,
interrupted and concurrent attempts retain the marker; reuse of that directory is
refused. After interruption, provision a different empty directory. Never move
only the database, remove the marker, reuse an old deletion ledger, or treat a
receipt as readiness permission. Keep the entire target directory together as a
quarantined unit pending later explicit operator handling. Receipt publication
failure still leaves the persistent service block.

On marked targets API startup bypasses database initialization and maintenance:
`/healthz` returns 200, `/readyz` returns 503, and all `/api/` requests return the
existing `SERVICE_UNAVAILABLE` envelope, including public data and login. The
block is latched for that process even if the marker disappears. Health worker
startup also refuses a marked target, including synthetic test probes. Normal
unmarked restart behavior remains covered by existing auth expiry controls.

Real age encryption/decryption and the two browser restore cases run in the
existing CI job after age version recording. Missing local age/age-keygen is
**NOT RUN**, not a passing crypto check. Missing tools in CI fail. Local controlled
pass-through fixtures establish CLI/I/O and isolation behavior only. No VM loss,
real operator activation or visual approval is inferred from those tests.

For service units, persistent locks and manual migration maintenance, see [explicit migration and service lifecycle](migrations.md).

운영 점검·명시 중지·reset HMAC 교체와 수동 재개는 [운영 점검 runbook](operational-checks.md)을 따른다.
