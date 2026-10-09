# Explicit migration and service lifecycle (T05 / #199)

This is an operator procedure and local implementation handoff. It authorizes no
production deployment, service activation, or #144/#192 release. Actual accounts,
mounts, ingress/firewall, cgroup supervision, reboot and suspend evidence belong
to T12 #204. HEALTH_CHECKS_ENABLED=false remains required; create no activation
record. T07 consumes the names, paths and maintenance predicate below.

## Installation contract

Install the five templates in `deploy/systemd/` only after host review:
`eduvibe-api.service`, `eduvibe-health-worker.service`, `eduvibe-nginx.service`,
`eduvibe-backup.service`, `eduvibe-backup.timer`. There is no target, migration
service, startup install/seed/bootstrap, or purge service/timer. The worker has no
install section and is never enabled by this handoff. Requires/After on worker
and Nginx bind them to the API; stopping the API stops dependent services first.
Explicitly stop ingress, worker, then API during maintenance. Ordering does not
prove application readiness.

Use one nonprivileged `eduvibe` UID and primary group for API, worker and backup.
No additional group members or group-writable database storage: existing owned
0700 directories and owned regular 0600 DB/WAL/SHM, ledger and private-file checks
remain authoritative. Use a separate `eduvibe-nginx` UID/group with read/traverse
access to immutable static files and its TLS/config files, and no DB, ledger,
backup, HMAC or operator-record access. T12 verifies those host permissions.

| Resource | Example canonical path / ownership |
|---|---|
| Immutable release | `/opt/eduvibe/releases/<id>/backend` with a prebuilt `.venv`; root-owned, service cannot modify |
| Release selection | `/opt/eduvibe/current`, atomic symlink to a complete release |
| Live DB / independent ledger | `/srv/eduvibe/database/database.sqlite3` / `database.deletions.sqlite3`, eduvibe, 0600; parent 0700 |
| Migration / restore marker | `/srv/eduvibe/database/.migration-blocked` / `.restore-blocked` |
| Persistent migration lock | `/srv/eduvibe/database/.migration.lock`, eduvibe, regular single-link 0600 |
| Persistent worker lock | `/srv/eduvibe/worker/health-worker.lock`, eduvibe, regular single-link 0600; parent 0700 |
| Backup namespace / lock | `/srv/eduvibe/backups` / `.backup.lock`, eduvibe, 0700 / 0600 |
| Protected operator evidence | `/srv/eduvibe/operator`, eduvibe, 0700; files 0600, governed by local retention |
| Nginx runtime / safe access log | `/srv/eduvibe/nginx` / `/var/log/eduvibe/nginx`, eduvibe-nginx, 0700; log 0600 |
| Rendered Nginx configuration | `/etc/eduvibe/nginx.conf`, fixed physical config; root-owned, readable only by approved Nginx UID/group |

Keep DB, ledger, locks, secrets and operator evidence outside every release and
web-served tree. Never unlink either lifetime lock during stop, restart, upgrade
or release selection. Preprovision locks and private parents; do not use
RuntimeDirectory cleanup to replace the worker inode. API and worker must agree
on `HEALTH_WORKER_LOCK_PATH=/srv/eduvibe/worker/health-worker.lock`.

Required root-owned 0600 EnvironmentFiles are `/etc/eduvibe/runtime.env` for API,
worker and backup; `/etc/eduvibe/backup.env` adds BACKUP_ROOT,
BACKUP_RECIPIENT_FILE and APP_RELEASE_ID; `/etc/eduvibe/nginx.env` contains only
approved nonsecret ingress settings. Missing files fail startup. EnvironmentFile
syntax is systemd syntax, not a shell script. These files must also explicitly
set APP_ENV=production and HEALTH_CHECKS_ENABLED=false; EnvironmentFile values
can override unit Environment values. Set DATABASE_PATH and PUBLIC_ORIGIN to the
approved canonical DB and exact external HTTPS origin. Use protected-file paths
for HMAC/blocklist/approval configuration; never put secret values in env, argv,
unit files, VITE_* settings or logs. Apply legitimate changes by stop/restart.

Nginx runs foreground with only CAP_NET_BIND_SERVICE for reviewed 80/443 binding.
Render its config using the [static-serving procedure](static-serving.md), with a
physical immutable RELEASE_ROOT, RUNTIME_ROOT=/srv/eduvibe/nginx and
LOG_ROOT=/var/log/eduvibe/nginx. Switch that reviewed physical config together with
the release while stopped; the config must not point at the `current` symlink as
its static root. Validate privately with `nginx -t`. Stdout/stderr and native
error_log remain suppressed; only the sanitized access log is retained. Use the
same UID/path in `deploy/logrotate/eduvibe-nginx` (USR1 targets this exact unit).
Install `deploy/journald/journald-eduvibe.conf` as the namespace drop-in described
in [logging-retention](logging-retention.md); all app/backup/maintenance output
uses LogNamespace=eduvibe, without duplicate raw sinks.

API/worker use SIGTERM, KillMode=control-group, TimeoutStopSec=15s, SendSIGKILL=yes
and Restart=on-failure with bounded retries. Exit 70 remains a failure: systemd
must confirm the entire previous cgroup is dead before replacement. Explicit
`systemctl stop` does not trigger automatic restart. Ordinary worker stop drains
original deadlines and preserves queued work; feature disable cancels queued and
running IDs permanently and retains the last result. Durable disable/rotation is
T07, using the existing feature controls, not deletion of locks or markers.

The backup timer runs 07:00 and 19:00 Asia/Seoul, Persistent=true and no random
delay. One oneshot cannot overlap itself; manual backup/purge use T03's shared
`.backup.lock`. No second wrapper flock on that inode. Every nonzero backup exit,
including 3 LOCAL_ONLY_REMOTE_NOT_CONFIRMED, leaves the unit failed; no
SuccessExitStatus=3 or ignored ExecStart failure. Catchup is not an RPO guarantee.
Retention scheduling is an open T12 prerequisite; manual purge remains the T06
command and does not become scheduled merely because backup/logrotate exists.

## Numbered operator procedure

These are commands for a reviewed host, not commands executed by this handoff.
Use one preconfigured `eduvibe` operator shell with the approved environment
exported explicitly (not by sourcing systemd EnvironmentFiles), `set -eu` and
`umask 0077`. Privileged service control is performed by the authorized operator.
Resolve OLD_RELEASE and NEW_RELEASE to trusted physical immutable paths before
beginning, with their built interpreters and matching release-root `contracts/catalog.json`
already present. Set the nonsecret
BACKUP_ROOT, BACKUP_RECIPIENT_FILE, APP_RELEASE_ID and a fresh MIGRATION_RUN_ID;
keep the release selection fixed until every old child exits. Environment and
working directory apply to every command, including offline checks.

1. Close ingress independently of release selection and keep it closed across
   reboot. Record the old physical selection privately. Create the separate
   durable latch, then stop all services even if latch creation fails:

   ```sh
   cd "$OLD_RELEASE/backend"
   maintenance_rc=0
   "$OLD_RELEASE/backend/.venv/bin/python" -m app.cli maintenance-block || maintenance_rc=$?
   sudo systemctl stop eduvibe-backup.timer eduvibe-backup.service
   sudo systemctl stop eduvibe-nginx.service
   sudo systemctl stop eduvibe-health-worker.service
   sudo systemctl stop eduvibe-api.service
   test "$maintenance_rc" -eq 0
   test -f /srv/eduvibe/database/.migration-blocked
   ```

   Nonzero creation means STOP after the service stops: investigate privately.
   A pre-existing/malformed marker is never overwritten, and fsync failure never
   clears a reserved marker. A missing durable marker cannot fence reboot;
   maintain independent ingress closure and persistent host service stops until
   the operator establishes that fence. There is no unblock/resume CLI.
   `app.restore_guard.maintenance_blocked(database)` composes both markers,
   including stat errors. API startup checks it before DB access and exposes only
   healthz=200, readyz/API=503. Worker startup refuses before DB access. This is a
   startup latch: creating/removing a marker does not change a running process.
   Always stop/restart; there is no per-request stat or worker polling.

2. Confirm inactive units, MainPID=0 and empty old cgroups/children, no API/ingress
   listener and completed backup processes. Inspect privately:

   ```sh
   sudo systemctl show eduvibe-api.service eduvibe-health-worker.service eduvibe-nginx.service eduvibe-backup.service -p ActiveState -p SubState -p MainPID -p ControlGroup
   sudo ss -ltnp
   exec 8<>/srv/eduvibe/worker/health-worker.lock
   flock --exclusive --nonblock 8
   flock --unlock 8
   exec 8>&-
   ```

   A PID=0 alone is insufficient: inspect the reported cgroups and wait for all
   children to exit. Uncertain exit or an unavailable worker lock means STOP.
   Do not kill unrelated processes or unlink locks to bypass exclusion.

3. Verify the preprovisioned migration lock is owned, private, regular and not a
   symlink/hardlink. Hold its descriptor in this same shell through backup,
   upgrade, checks, selection and smoke:

   ```sh
   exec 9<>/srv/eduvibe/database/.migration.lock
   flock --exclusive --nonblock 9
   ```

   All migration operators share this persistent inode. It does not fence an
   unrelated privileged writer; quiescence is required. Alembic additionally
   uses SQLite BEGIN IMMEDIATE and transactional DDL.

4. Run T03 backup immediately before changing the DB, using the OLD release that
   understands its current schema, never the new-head code against an ancestor:

   ```sh
   backup_rc=0
   "$OLD_RELEASE/backend/.venv/bin/python" -m app.cli backup-db \
     --output-dir "$BACKUP_ROOT" --recipient-file "$BACKUP_RECIPIENT_FILE" \
     --release-id "$APP_RELEASE_ID" \
     >"/srv/eduvibe/operator/$MIGRATION_RUN_ID-backup.log" 2>&1 || backup_rc=$?
   test "$backup_rc" -eq 0
   ```

   **STOP on every nonzero status**, including 3, 1, 2, 130 and 143. Preserve the
   marker and closed ingress; do not run upgrade or switch the release. T03
   currently never returns 0: **production migration is blocked until T10
   supplies independent remote confirmation under a later authorized procedure**.
   There is no success override. The remaining steps describe the required
   boundary after that prerequisite; local synthetic drills do not satisfy it.
   Empty-DB initialization has no backup or independent ledger and requires a
   separate explicit provisioning decision, not a skip-backup flag.

5. With prerequisites established, run the NEW physical release's explicit
   migration. Capture raw Alembic SQL/exception diagnostics only in private
   operator files under the T06 retention policy, never in journal/shared output:

   ```sh
   cd "$NEW_RELEASE/backend"
   "$NEW_RELEASE/backend/.venv/bin/python" -m alembic upgrade head \
     >"/srv/eduvibe/operator/$MIGRATION_RUN_ID-alembic.log" 2>&1
   ```

   Nonzero/interrupted execution means STOP with maintenance intact. Preserve
   DB/WAL/SHM and the independent ledger together; diagnose the old-or-new
   transaction state under the lock before any authorized retry.

6. Require exact new-release revision, integrity and foreign-key results:

   ```sh
   "$NEW_RELEASE/backend/.venv/bin/python" - <<'PY'
   import sqlite3
   from app.database import current_head
   from app.settings import Settings
   settings = Settings.from_environment()
   with sqlite3.connect(f"file:{settings.database_path}?mode=ro", uri=True) as db:
       assert db.execute("SELECT version_num FROM alembic_version").fetchall() == [(current_head(),)]
       assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
       assert db.execute("PRAGMA foreign_key_check").fetchall() == []
   print("MIGRATION_INTEGRITY_VERIFIED")
   PY
   ```

   Privately compare retained member IDs/approval/hash/ownership, complete app
   text/grades/version and every independent ledger table against the established
   pre-migration snapshot. Do not print rows. No seed/fixture reinjection, ledger
   synthesis, live-main-file cp, downgrade or automatic restore. 0012 downgrade
   refuses; old code whose head is 0011 also refuses a 0012 DB. A code fallback
   requires verified schema compatibility; data loss/unknown state requires the
   separately authorized T04/T10/T12 recovery process.

7. After config validation, select the complete release with same-filesystem
   symlink plus atomic rename and directory fsync, performed by the authorized
   owner of `/opt/eduvibe`. Keep DB/ledger/locks unchanged:

   ```sh
   # In the privileged operator shell, with the reviewed NEW_RELEASE exported:
   python3 - <<'PY'
   import os
   from pathlib import Path
   parent = Path('/opt/eduvibe')
   candidate = parent / 'current.next'
   candidate.symlink_to(os.environ['NEW_RELEASE'], target_is_directory=True)
   os.replace(candidate, parent / 'current')
   fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
   try:
       os.fsync(fd)
   finally:
       os.close(fd)
   PY
   ```

   Never remove current before creating its replacement. A leftover candidate,
   uncertain fsync or interrupted selection means STOP; inspect readlink/revision
   privately and keep maintenance. Select the reviewed physical Nginx config
   while it is stopped; validate it again before any ingress restart.

8. With the marker present and ingress closed, start only API for blocked-state
   loopback smoke; keep the worker off:

   ```sh
   sudo systemctl start eduvibe-api.service
   curl --fail --silent http://127.0.0.1:8000/healthz
   test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8000/readyz)" = 503
   test "$(curl --silent --output /dev/null --write-out '%{http_code}' http://127.0.0.1:8000/api/v1/apps)" = 503
   sudo systemctl stop eduvibe-api.service
   ```

   Confirm expected release/config identity, offline data checks and fixed safe
   diagnostic. This is blocked-state smoke, not proof of functional readiness.

9. Only after explicit operator acceptance of schema, remote backup, release,
   config and auth-candidate bindings, and absence of `.restore-blocked`, remove
   ONLY the migration marker and fsync its directory, while API is stopped:

   ```sh
   "$NEW_RELEASE/backend/.venv/bin/python" - <<'PY'
   import os
   from app.settings import Settings
   parent = Settings.from_environment().database_path.parent
   assert not os.path.lexists(parent / '.restore-blocked')
   (parent / '.migration-blocked').unlink()
   fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
   try:
       os.fsync(fd)
   finally:
       os.close(fd)
   PY
   sudo systemctl start eduvibe-api.service
   curl --fail --silent http://127.0.0.1:8000/readyz
   ```

   Perform permitted functional/auth smoke privately under closed ingress. On
   failure recreate the durable latch, stop API and keep ingress closed. Only
   after successful review reopen approved ingress and restart the backup timer.
   Health remains false. `.restore-blocked` is permanent quarantine with unchanged
   semantics; this procedure never removes it, even after restore verification.
   Release the migration lock only at the final accepted/stopped boundary:
   `flock --unlock 9; exec 9>&-`.

## Evidence limits

The backend tests execute the real CLI, Alembic, API and worker commands
individually; they do not test documentation text or install a migration runner.
The interrupted-upgrade barrier exists only in a copied Alembic tree. Release
drills seed once and compare data and independent evidence after selection and
restart. The single browser case uses owned-login cleanup and captures no secrets
or visual baselines. Real age/nginx checks are mandatory in CI when unavailable
locally.

`systemd-analyze verify` substitutes executable paths into a temporary tree:
**syntax verification only**, never account, mount, real supervisor or reboot
proof. Subprocess SIGTERM/SIGKILL/exit-70 tests prove OS/lock/socket boundaries,
not systemd's runtime ordering. Host behavior and unresolved retention cadence
remain **NOT RUN / T12**.

운영 점검·명시 중지·reset HMAC 교체와 수동 재개는 [운영 점검 runbook](operational-checks.md)을 따른다.
