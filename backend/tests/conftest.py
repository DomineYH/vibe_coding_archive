from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
CATALOG = json.loads((ROOT / "contracts/catalog.json").read_text())


@pytest.fixture
def migrate_test_database():
    def migrate(database_path: Path) -> None:
        env = {
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database_path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        }
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND,
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )

    return migrate


@pytest.fixture
def seed_public_and_private_apps():
    def seed(database_path: Path) -> None:
        connection = sqlite3.connect(database_path)
        try:
            connection.executemany(
                """
                INSERT INTO members (
                    id, login_id, nickname, email, phone, password_hash, is_admin,
                    approval_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        "00000000-0000-0000-0000-000000000010",
                        "private-login-sentinel",
                        "공개 별명",
                        "email-sentinel@example.test",
                        "phone-sentinel",
                        "password-hash-sentinel",
                        0,
                        "approved",
                    ),
                    (
                        "00000000-0000-0000-0000-000000000020",
                        "other-private-login-sentinel",
                        "비공개 별명 sentinel",
                        "email-sentinel@example.test",
                        "phone-sentinel",
                        "password-hash-sentinel",
                        0,
                        "approved",
                    ),
                ],
            )
            created_at = "2026-09-28T12:00:00+00:00"
            for app_id, owner_id, name, subject, is_public in [
                (
                    "00000000-0000-0000-0000-000000000001",
                    "00000000-0000-0000-0000-000000000010",
                    "첫 공개 앱",
                    "수학",
                    True,
                ),
                (
                    "00000000-0000-0000-0000-000000000002",
                    "00000000-0000-0000-0000-000000000010",
                    "둘째 공개 앱",
                    "영어",
                    True,
                ),
                (
                    "00000000-0000-0000-0000-000000000003",
                    "00000000-0000-0000-0000-000000000020",
                    "private-app-sentinel",
                    "수학",
                    False,
                ),
            ]:
                connection.execute(
                    """
                    INSERT INTO apps (
                        id, owner_id, name, url, prompt, description, subject, is_public,
                        theme_id, stack_db, stack_backend, stack_frontend, stack_hosting,
                        version, url_version, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        app_id,
                        owner_id,
                        name,
                        "https://example.test/app",
                        "line 1\nline 2",
                        f"Description for {name}",
                        subject,
                        int(is_public),
                        CATALOG["themes"][0]["id"],
                        "SQLite",
                        None,
                        "React",
                        None,
                        1,
                        1,
                        created_at,
                        created_at,
                    ),
                )
                connection.executemany(
                    "INSERT INTO app_grades (app_id, grade) VALUES (?, ?)",
                    [(app_id, grade) for grade in ["중1", "초2"]],
                )
                connection.execute(
                    """
                    INSERT INTO health_results (app_id, state, checked_at, fresh_until)
                    VALUES (?, 'unchecked', NULL, NULL)
                    """,
                    (app_id,),
                )
            connection.commit()
        finally:
            connection.close()

    return seed
