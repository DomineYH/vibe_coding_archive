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
it does not implement member login or any T02–T07 mutation.

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
