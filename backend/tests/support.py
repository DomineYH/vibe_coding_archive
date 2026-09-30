from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CATALOG = json.loads((ROOT / "contracts/catalog.json").read_text())


def populate_public_and_private_apps(
    database_path: Path,
    public_count: int = 2,
    *,
    valid_uuids: bool = True,
    include_search_edge_cases: bool = False,
) -> None:
    uuid_prefix = (
        "00000000-0000-4000-8000-" if valid_uuids else "00000000-0000-0000-0000-"
    )

    def fixture_uuid(value: int) -> str:
        return f"{uuid_prefix}{value:012d}"

    connection = sqlite3.connect(database_path)
    try:
        members = [
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
        ]
        if include_search_edge_cases:
            members.append(
                (
                    fixture_uuid(30),
                    "search-edge-login",
                    "검색 경계 별명",
                    "search-edge@example.test",
                    "search-edge-phone",
                    "search-edge-password-hash",
                    0,
                    "approved",
                )
            )
        connection.executemany(
            """
            INSERT INTO members (
                id, login_id, nickname, email, phone, password_hash, is_admin,
                approval_status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            members,
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
        edge_app_ids = set()
        if include_search_edge_cases:
            edge_apps = [
                (900000000001, "Casefold Straße fixture"),
                (900000000002, "Literal percent % fixture"),
                (900000000003, "Literal underscore _ fixture"),
            ]
            edge_app_ids = {fixture_uuid(app_id) for app_id, _ in edge_apps}
            apps.extend(
                (
                    fixture_uuid(app_id),
                    fixture_uuid(30),
                    name,
                    "영어",
                    True,
                    ["초2"],
                )
                for app_id, name in edge_apps
            )
        apps.append(
            (
                fixture_uuid(public_count + 1),
                fixture_uuid(20),
                "private-app-sentinel",
                "기타",
                False,
                ["초2", "중1"],
            )
        )
        for app_id, owner_id, name, subject, is_public, grades in apps:
            app_created_at = (
                "2026-09-27T12:00:00.000000Z" if app_id in edge_app_ids else created_at
            )
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
                    app_created_at,
                    app_created_at,
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


def prepare_issue83_detail_fixture(database_path: Path) -> None:
    name = ("긴 공개 수업 도구 " * 7).rstrip()
    nickname = "공개 별명 " + ("초등 수학 탐구 연구자 " * 7).rstrip()
    url = (
        "https://example.test/"
        + "classroom-resource/" * 12
        + "?lesson=fractions&mode=teacher#chapter-2"
    )
    prompt = "\n".join(
        [
            "프롬프트 첫 줄  ",
            "  둘째 줄",
            "",
            "<script>window.issue83Injected=true</script>",
            *(
                f"긴 프롬프트 경계 줄 {index:02d} - " + "활용 안내 " * 18
                for index in range(40)
            ),
            "마지막 프롬프트 줄\t",
        ]
    )
    description = "\n".join(
        [
            "첫째 줄  앞 공백",
            "",
            "둘째 줄\t들여쓰기",
            '<img src=x onerror="window.issue83Injected=true">',
            *(f"긴 설명 경계 줄 {index:02d} - 활용 안내 " * 4 for index in range(24)),
            "마지막 줄  ",
        ]
    )
    with sqlite3.connect(database_path) as connection:
        connection.execute(
            "UPDATE members SET nickname = ? WHERE id = ?",
            (nickname, "00000000-0000-4000-8000-000000000010"),
        )
        connection.execute(
            "UPDATE apps SET created_at = ? WHERE id = ?",
            (
                "2026-09-29T12:33:00.000000Z",
                "00000000-0000-4000-8000-000000000002",
            ),
        )
        connection.execute(
            """
            UPDATE apps SET
                name = ?, url = ?, prompt = ?, description = ?, stack_db = ?,
                stack_backend = ?, stack_frontend = ?, stack_hosting = ?,
                created_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                url,
                prompt,
                description,
                "PostgreSQL · Neon",
                "FastAPI · SQLAlchemy",
                "React · Vite",
                "Cloudflare Pages",
                "2026-09-29T12:34:00.000000Z",
                "2026-09-28T12:00:00.000000Z",
                "00000000-0000-4000-8000-000000000001",
            ),
        )
