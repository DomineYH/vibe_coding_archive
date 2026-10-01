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
it implements no mutation after T02 (see the T02 section for login/logout).

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
boundary advertises `auth_login` and `auth_logout` together (they are one working
pair) and leaves `auth_password_change` off until the first-change flow (T03).

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
