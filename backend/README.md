# Backend

Run commands from `backend/`. Set `APP_ENV` in the process environment; only
development reads this directory's ignored `.env` file.

```sh
uv sync --locked
APP_ENV=development uv run --frozen alembic upgrade head
APP_ENV=development uv run --frozen python -m app.cli seed
APP_ENV=development uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
uv run --frozen ruff check .
uv run --frozen ruff format --check .
# One-time, explicit R15 acquisition outside version control (network required):
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
APP_ENV=development uv run --frozen python -m app.cli prepare-password-blocklist
# Tests below reuse that verified source offline:
APP_ENV=test uv run --frozen pytest
```

Tests that start the API provide their own temporary `DATABASE_PATH` and
`PUBLIC_ORIGIN`. The API refuses to start until an explicit migration leaves
the file at the current Alembic head.

The seed command adds only missing synthetic development rows to
`storage/development.sqlite3`. It requires that explicit migration and an
interactive terminal; when a seeded member is missing, one shared password is
read twice without echo and stored as a hash.

## T01 authentication preparation

The ordinary app keeps every authentication capability disabled. Only the
`APP_ENV=test` app factory's `auth_testing=True` boundary exercises preparation;
it implements T01–T03 only (see the sections below).

Migration `0003_auth_identity` preserves member/app IDs and ownership. For an
existing database, provide `AUTH_MEMBER_BACKFILL=/absolute/path/history.json`:
a JSON object keyed by member ID, containing verified `created_at`, `updated_at`
and `first_approved_at` timestamps with explicit UTC offsets. Pending members
require `first_approved_at: null`; approved/revoked members require the original
first approval time. Unknown password hashes additionally require the explicit
`password_hash_policy: "unusable"` classification; the stored value is preserved
and is never converted to a password. Missing history, invalid login IDs or
normalized collisions stop the migration transaction. Correct the source data
with an audited decision before retrying; do not invent dates or passwords.
Keep this backfill file and database backups outside version control.

Before serving a restored backup, run the following **against the restored,
verified database while the server is stopped**:

```sh
uv run --frozen python -m app.cli invalidate-restored-auth
```

This revokes every restored S/R/flow and cancels pending permits before readiness;
it neither replays transitions nor extends successful-session clocks. Reapply
subsequent member deletions according to the operating backup procedure. The
local contract test uses only a temporary SQLite file, not an operating backup.

## T02 member login, session restore and logout

On the same `APP_ENV=test` boundary, `POST /auth/login`, `GET /auth/me` and
`POST /auth/logout` are live; the ordinary app keeps every capability off. The
boundary advertises `auth_login`, `auth_logout` and `auth_password_change` as the
verified T01–T03 bundle.

Passwords are verified with pwdlib's recommended Argon2id profile (RFC 9106
low-memory: m=64 MiB, t=3, p=4) outside any write transaction, behind a gate of
2 concurrent and 4 queued hashes with a 1 s queue wait (saturation is
`503 AUTH_BUSY` + `Retry-After: 1`). These values are test candidates; real-host
timing is measured at the T07 operating gate, not assumed. Login failures are
counted per account+IP (10) and per IP (200) over a rolling 15 minutes in SQLite;
blocked requests add no events. A full session lasts at most 8 hours and 30
minutes of inactivity; `me`, `csrf` and `flow-state` never extend it.

Synthetic Argon2 members for tests live in `tests/support.py`
(`populate_auth_members`); the API E2E runner inserts them once with the other
fixtures. Their shared password is a test-only constant, never a seed default.


## T03 administrator credentials and own password change

First run the explicit migration to `0004_session_recent_auth`. Individually
prepare the fixed R15 list in a private path outside version control:

```sh
export APP_ENV=development
export PASSWORD_BLOCKLIST_PATH=/absolute/private/path/ncsc.txt
uv run --frozen python -m app.cli prepare-password-blocklist
uv run --frozen python -m app.cli bootstrap-admin
# Only for an existing administrator:
uv run --frozen python -m app.cli recover-admin
```

The list source/version/digest remain the fixed R15 metadata. API startup never
fetches it; `auth_testing=True` refuses a missing or corrupt list. Tests and the
API E2E runner require an explicitly prepared
`PASSWORD_BLOCKLIST_PATH`, validate the unchanged full source and copy it into
private test-owned temporary files. They never acquire it from the network.
Public backend contracts do not require the list. CI provisions it in a separate
setup step before tests; local runs use the one-time command above. Export the
same path before frontend `npm run test:e2e:api`. No list or derived
password material is committed or packaged. Redistribution rights remain U02
at T07. `PASSWORD_BLOCKLIST_PATH` defaults to `password-blocklist-ncsc.txt` next to
the database; always keep both outside version control.

The administrator CLI requires stdin/stdout TTY, reads/confirm passwords without
echo, asks for explicit `YES`, and supplies no credential argument/environment
option. Bootstrap requires zero administrators and rejects a login ID collision;
recovery targets only an existing administrator. The credential, member version,
recovery session revocations and minimal audit commit together; audit failure
rolls everything back. Running these commands against operating accounts is a
separate operator action, not authorized by the implementation ticket.

A temporary credential lasts 24 hours. Login issues only `change_only`, expiring
at the earlier of login+15 minutes or the credential deadline. Its Self omits
contact fields and recent auth. The existing password card submits no confirmation.
A successful own change consumes the credential, increments the member version,
revokes all restricted sessions and issues full S only to the completing browser.
Its 8-hour absolute/30-minute inactivity and administrator 15-minute recent-auth
windows begin at the change; ordinary later login does not open recent auth.
A lost reply uses the original transition and cookie observation, never replays
the change, and discards only that unreceived result S. Ordinary auth capabilities
stay off; administrator reauth/reset/deletion and signup stay unavailable.
