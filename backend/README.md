# Backend

Run commands from `backend/`. Set `APP_ENV` in the process environment; only
development reads this directory's ignored `.env` file.

```sh
uv sync --locked
APP_ENV=development uv run --frozen alembic upgrade head
APP_ENV=development uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
uv run --frozen ruff check .
uv run --frozen ruff format --check .
APP_ENV=test uv run --frozen pytest
```

Tests that start the API provide their own temporary `DATABASE_PATH` and
`PUBLIC_ORIGIN`. The API refuses to start until an explicit migration leaves
the file at the current Alembic head.
