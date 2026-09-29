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


def populate_public_and_private_apps(
    database_path: Path, public_count: int = 2, *, valid_uuids: bool = False
) -> None:
    uuid_prefix = (
        "00000000-0000-4000-8000-" if valid_uuids else "00000000-0000-0000-0000-"
    )

    def fixture_uuid(value: int) -> str:
        return f"{uuid_prefix}{value:012d}"

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
                    fixture_uuid(10),
                    "private-login-sentinel",
                    "공개 별명",
                    "email-sentinel@example.test",
                    "phone-sentinel",
                    "password-hash-sentinel",
                    0,
                    "approved",
                ),
                (
                    fixture_uuid(20),
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
        created_at = "2026-09-28T12:00:00.000000Z"
        apps = [
            (
                fixture_uuid(1),
                fixture_uuid(10),
                "첫 공개 앱",
                "수학",
                True,
                ["초2", "중1"],
            ),
            (
                fixture_uuid(2),
                fixture_uuid(10),
                "둘째 공개 앱",
                "영어",
                True,
                ["초2", "중1"],
            ),
        ]
        apps.extend(
            (
                fixture_uuid(index),
                fixture_uuid(10),
                f"추가 공개 앱 {index}",
                "수학",
                True,
                ["초1"],
            )
            for index in range(3, public_count + 1)
        )
        apps.append(
            (
                fixture_uuid(public_count + 1),
                fixture_uuid(20),
                "private-app-sentinel",
                "수학",
                False,
                ["초2", "중1"],
            )
        )
        for app_id, owner_id, name, subject, is_public, grades in apps:
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
                [(app_id, grade) for grade in grades],
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


@pytest.fixture
def seed_public_and_private_apps():
    return populate_public_and_private_apps
