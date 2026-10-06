# Development administrator password reset

Reset requires the existing verified authentication setup and a dedicated external
32-byte secret. Production remains disabled. Missing or invalid supply disables
reset issuance/execution only (503); result lookup, cancellation and general
authentication remain available.

With all development writers stopped, take a consistent SQLite backup (including
committed WAL data) and preserve the independent deletion ledger. Run the existing
migration command from `backend/`: `APP_ENV=development uv run --frozen alembic
upgrade head`. Verify revision `0010_password_reset` and `foreign_key_check` before
restarting. Restore through the existing `invalidate-restored-auth` procedure;
restored operation keys never regain authority.

Provision once outside the repository, database and static assets. This command
refuses to overwrite an existing file and prints no secret:

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
The file must be a regular 0600 UTF-8 JSON file with exactly `secret_hex` and
`key_id`, both 64 lowercase hex characters. The identifier must equal SHA-256 of
the decoded secret. Preserve this file across ordinary restarts. Never put its
contents in `.env`, source, logs, database backups or frontend configuration.

File loss, corruption or replacement latches reset off at the next request or
60-second maintenance check. Unresolved keys become rejected with
`OPERATION_INVALIDATED`; terminal results retain their original expiry. A request
still hashing cannot commit after this boundary. Restoring the old file does not
reopen the gate; restart is required.

For intentional rotation, stop issuance/execution, stop and drain **all** API
workers, confirm in-flight requests ended, provision/replace the private external
file, then restart. Startup invalidates old unresolved keys before opening new
reset traffic. This is not hot rotation; the process lock does not coordinate
multiple workers. Failed invalidation leaves reset closed. Successful history is
preserved until its original 24-hour deadline.

The existing 60-second online sweep removes expired keys and fingerprints; it
requires a running service with writable storage. Audit retention, backups and
the deletion ledger remain separate. Production secret deployment and interactive
account deletion integration (#161) belong to their later operating/integration
gates. This change provisions no real development or production secret.
