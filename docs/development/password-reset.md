# Development administrator password reset

Reset requires the existing verified authentication setup and a dedicated external
32-byte secret. Production authentication is off by default; the
[limited authentication candidate](../operations/auth-candidate.md) and public
approval are separate gates. This development procedure grants neither approval.
Missing or invalid supply disables reset issuance/execution only
(`503 SERVICE_UNAVAILABLE`); result lookup, cancellation and general
authentication remain available when authentication is independently valid.

With all development writers stopped, take a consistent SQLite backup (including
committed WAL data) and preserve the independent deletion ledger. Run the existing
migration command from `backend/`: `APP_ENV=development uv run --frozen alembic
upgrade head`. Verify the current Alembic head (including `0010_password_reset`)
and `foreign_key_check` before restarting. Restore through the existing
`invalidate-restored-auth` procedure;
restored operation keys never regain authority.

Provision once outside the repository, database and static assets. On WSL, if
the `/mnt/c` repository mount cannot preserve Unix 0600 permissions, use the
Linux home filesystem as below. The location must actually preserve 0600.
This command refuses to overwrite an existing file and prints no secret:

```bash
python3 - <<'PY'
import hashlib, json, os, secrets
from pathlib import Path
path = Path.home() / '.local/state/eduvibe/password-reset-hmac.json'
path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
secret = secrets.token_bytes(32)
fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
with os.fdopen(fd, 'w') as file:
    json.dump({'secret_hex': secret.hex(), 'key_id': hashlib.sha256(secret).hexdigest()}, file)
print('Reset secret provisioned.')
PY
```

Set only `PASSWORD_RESET_HMAC_PATH=/absolute/external/path` in the server process.
Even in development, this setting is ignored in `backend/.env`; ordinary
development settings use that file with process values taking precedence.
Production/test use process settings and do not read the project env file.
The file must be a regular 0600 UTF-8 JSON file of at most 1024 bytes with exactly
`secret_hex` and `key_id`, both 64 lowercase hex characters. The identifier
must equal SHA-256 of the decoded secret. Preserve this file across ordinary
restarts; do not rerun creation or overwrite it. Never put its
contents in `.env`, source, logs, database backups or frontend configuration.

After the [existing development DB/authentication setup](../../backend/README.md),
start the API from `backend/` with only the external file's absolute path in the
HMAC process setting:

```sh
PASSWORD_RESET_HMAC_PATH="$HOME/.local/state/eduvibe/password-reset-hmac.json" \
  uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

In another terminal, confirm DB/authentication readiness and the `/meta`
capability (served at `/api/v1/meta`):

```sh
curl -fsS http://127.0.0.1:8000/readyz
curl -fsS http://127.0.0.1:8000/api/v1/meta \
  | python3 -c 'import json, sys; print(json.load(sys.stdin)["capabilities"]["admin_password_reset"])'
```

With verified authentication and a ready reset gate, `admin_password_reset`
reports `enabled: true` and empty `reasons`. `/readyz` alone does not prove HMAC
readiness. Missing supply, incorrect permissions/format or failed validation at
startup latches reset off. Stop the entire API process (including the reload
supervisor), correct the supply and restart with the path above. Creating or
repairing the file later, or relying on reload, does not automatically reopen it.

File loss, corruption or replacement latches reset off at the next request or
60-second maintenance check. Unresolved keys become rejected with
`OPERATION_INVALIDATED`; terminal results retain their original expiry. A request
still hashing cannot commit after this boundary. Restoring the old file does not
reopen the gate; a complete API restart is required after correcting the supply.

For intentional rotation, stop issuance/execution, stop and drain **all** API
workers, confirm in-flight requests ended, provision/replace the private external
file, then restart. Startup invalidates old unresolved keys before opening new
reset traffic. The existing `rotate-reset-key --generate` command belongs to the
[operational rotation/loss runbook](../operations/operational-checks.md#reset-hmac-rotation-or-loss):
it requires service-stop verification and invalidates unresolved DB operations.
It is not the first development setup or an ordinary restart command.
This is not hot rotation; the process lock does not coordinate
multiple workers. Failed invalidation leaves reset closed. Successful history is
preserved until its original 24-hour deadline.

The existing 60-second online sweep removes expired keys and fingerprints; it
requires a running service with writable storage. Audit retention, backups and
the deletion ledger remain separate. Production secret deployment and interactive
account deletion integration (#161) belong to their later operating/integration
gates. This change provisions no real development or production secret.
