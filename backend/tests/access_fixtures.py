"""Synthetic T06 ownership fixtures, inserted once by the isolated browser runner."""

import sqlite3
from pathlib import Path


def populate_access_apps(database_path: Path) -> None:
    with sqlite3.connect(database_path) as connection:
        for number, owner, name in [
            (30, 100, "회원 A 비공개 자료"),
            (31, 104, "회원 B 비공개 자료"),
        ]:
            app_id = f"00000000-0000-4000-8000-{number:012d}"
            owner_id = f"00000000-0000-4000-8000-{owner:012d}"
            connection.execute(
                """
                INSERT INTO apps (
                    id, owner_id, name, url, prompt, description, subject, is_public,
                    theme_id, stack_db, stack_backend, stack_frontend, stack_hosting,
                    version, url_version, created_at, updated_at
                ) SELECT ?, ?, ?, url, ?, description, subject, 0,
                    theme_id, stack_db, stack_backend, stack_frontend, stack_hosting,
                    version, url_version, created_at, updated_at FROM apps WHERE is_public=0 LIMIT 1
                """,
                (app_id, owner_id, name, f"{name}의 합성 전용 프롬프트"),
            )
            connection.execute(
                "INSERT INTO app_grades (app_id, grade) VALUES (?, '초2')", (app_id,)
            )
            connection.execute(
                "INSERT INTO health_results (app_id, state) VALUES (?, 'unchecked')",
                (app_id,),
            )
