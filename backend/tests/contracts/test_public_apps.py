from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "contracts/catalog.json").read_text())


def test_public_list_and_detail_use_contract_dtos_and_hide_private_fields(
    tmp_path: Path, make_test_app, seed_public_and_private_apps
):
    database_path = tmp_path / "apps.sqlite3"
    app = make_test_app(database_path)
    seed_public_and_private_apps(database_path)

    with TestClient(app) as client:
        first_page = client.get("/api/v1/apps?limit=1&offset=0")
        second_page = client.get("/api/v1/apps?limit=1&offset=1")
        past_end = client.get("/api/v1/apps?limit=1&offset=10")
        detail = client.get("/api/v1/apps/00000000-0000-0000-0000-000000000002")
        private_detail = client.get("/api/v1/apps/00000000-0000-0000-0000-000000000003")
        missing_detail = client.get("/api/v1/apps/00000000-0000-0000-0000-000000000099")
        unsupported_search = client.get("/api/v1/apps?q=private-app-sentinel")
        too_large = client.get("/api/v1/apps?limit=101")
        repeated_limit = client.get("/api/v1/apps?limit=1&limit=2")
        unknown_parameter = client.get("/api/v1/apps?tracking=1")

    assert first_page.status_code == second_page.status_code == 200
    page = first_page.json()
    assert set(page) == {"items", "pagination", "server_time", "facets"}
    assert page["pagination"] == {
        "limit": 1,
        "offset": 0,
        "total": 2,
        "has_more": True,
    }
    assert [item["id"] for item in page["items"]] == [
        "00000000-0000-0000-0000-000000000002"
    ]
    card = page["items"][0]
    assert set(card) == {
        "id",
        "owner",
        "name",
        "subject",
        "grades",
        "is_public",
        "theme_id",
        "version",
        "url_version",
        "health",
    }
    assert card["owner"] == {
        "id": "00000000-0000-0000-0000-000000000010",
        "nickname": "공개 별명",
    }
    assert set(card["health"]) == {"result", "latest_job", "next_check_at"}
    assert card["health"] == {
        "result": {"state": "unchecked", "checked_at": None, "fresh_until": None},
        "latest_job": None,
        "next_check_at": None,
    }
    assert page["facets"]["subjects_in_use"] == ["수학", "영어"]
    assert second_page.json()["pagination"] == {
        "limit": 1,
        "offset": 1,
        "total": 2,
        "has_more": False,
    }
    assert past_end.json()["items"] == []
    assert past_end.json()["pagination"] == {
        "limit": 1,
        "offset": 10,
        "total": 2,
        "has_more": False,
    }
    assert "private-app-sentinel" not in first_page.text
    assert "private-login-sentinel" not in first_page.text
    assert "email-sentinel" not in first_page.text
    assert "phone-sentinel" not in first_page.text
    assert "password-hash-sentinel" not in first_page.text

    assert detail.status_code == 200
    body = detail.json()
    assert set(body) == {"item", "server_time"}
    assert set(body["item"]) == {
        "id",
        "owner",
        "name",
        "subject",
        "grades",
        "is_public",
        "theme_id",
        "version",
        "url_version",
        "health",
        "url",
        "prompt",
        "description",
        "stack_db",
        "stack_backend",
        "stack_frontend",
        "stack_hosting",
        "created_at",
        "updated_at",
    }
    assert body["item"]["prompt"] == "line 1\nline 2"
    assert body["item"]["url"] == "https://example.test/app"
    assert body["item"]["grades"] == ["초2", "중1"]
    assert body["item"]["health"] == card["health"]
    assert private_detail.status_code == missing_detail.status_code == 404
    assert private_detail.json() == missing_detail.json()
    assert (
        unsupported_search.status_code
        == too_large.status_code
        == repeated_limit.status_code
        == unknown_parameter.status_code
        == 400
    )
    for response in (
        unsupported_search,
        too_large,
        repeated_limit,
        unknown_parameter,
    ):
        assert set(response.json()) == {"error"}
        assert response.json()["error"]["code"] == "VALIDATION_ERROR"
        assert response.json()["error"]["fields"]


def test_corrupt_stored_health_timestamp_is_server_error_not_query_error(
    tmp_path: Path, make_test_app, seed_public_and_private_apps
):
    database_path = tmp_path / "corrupt-health.sqlite3"
    app = make_test_app(database_path)
    seed_public_and_private_apps(database_path)

    with TestClient(app) as client:
        with app.state.engine.begin() as connection:
            connection.execute(
                text(
                    "UPDATE health_results SET state = 'healthy', checked_at = :checked_at, "
                    "fresh_until = :fresh_until WHERE app_id = :app_id"
                ),
                {
                    "checked_at": "not-a-timestamp",
                    "fresh_until": "2026-09-29T12:00:00+00:00",
                    "app_id": "00000000-0000-0000-0000-000000000001",
                },
            )
        response = client.get("/api/v1/apps")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "SERVICE_UNAVAILABLE"
    assert "not-a-timestamp" not in response.text


def test_public_apps_fastapi_declarations_match_openapi(
    tmp_path: Path, make_test_app, normalize_schema
):
    app = make_test_app(tmp_path / "app-contract.sqlite3")
    source = yaml.safe_load((ROOT / "contracts/openapi.yaml").read_text())
    actual = app.openapi()

    for path, schema_name in [
        ("/api/v1/apps", "AppPage"),
        ("/api/v1/apps/{id}", "AppDetailResponse"),
    ]:
        operation = actual["paths"][path]["get"]
        expected = source["paths"][path.removeprefix("/api/v1")]["get"]
        assert (
            operation["responses"]["200"]["content"]["application/json"]["schema"][
                "$ref"
            ]
            == f"#/components/schemas/{schema_name}"
        )
        assert (
            expected["responses"]["200"]["content"]["application/json"]["schema"][
                "$ref"
            ]
            == f"#/components/schemas/{schema_name}"
        )

    for schema_name in [
        "Owner",
        "HealthResult",
        "Job",
        "HealthView",
        "AppCard",
        "Pagination",
        "AppPage",
        "AppDetail",
        "AppDetailResponse",
        "ErrorEnvelope",
    ]:
        assert normalize_schema(
            actual["components"]["schemas"][schema_name], actual
        ) == normalize_schema(source["components"]["schemas"][schema_name], source)


def test_public_app_errors_use_safe_contract_envelopes(tmp_path: Path, make_test_app):
    app = make_test_app(tmp_path / "errors.sqlite3")
    with TestClient(app) as client:
        with app.state.engine.begin() as connection:
            connection.execute(text("DROP TABLE apps"))
        list_error = client.get("/api/v1/apps")
        detail_error = client.get("/api/v1/apps/00000000-0000-0000-0000-000000000099")

    assert list_error.status_code == detail_error.status_code == 503
    assert set(list_error.json()) == set(detail_error.json()) == {"error"}
    assert set(list_error.json()["error"]) == {"code", "message", "request_id"}
    assert "sqlite" not in list_error.text.lower()
    assert str(tmp_path) not in list_error.text


def test_file_database_constraints_reject_invalid_app_and_health_rows(
    tmp_path: Path, make_test_app
):
    app = make_test_app(tmp_path / "constraints.sqlite3")
    with TestClient(app):
        engine = app.state.engine
        member = {
            "id": "00000000-0000-0000-0000-000000000010",
            "login_id": "unique-login",
            "nickname": "별명",
            "email": None,
            "phone": None,
            "password_hash": "hash",
            "is_admin": False,
            "approval_status": "approved",
        }
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO members (id, login_id, nickname, email, phone, "
                    "password_hash, is_admin, approval_status) "
                    "VALUES (:id, :login_id, :nickname, :email, :phone, "
                    ":password_hash, :is_admin, :approval_status)"
                ),
                member,
            )

        invalid_rows = [
            (
                (
                    "INSERT INTO members (id, login_id, nickname, is_admin, approval_status) "
                    "VALUES ('00000000-0000-0000-0000-000000000011', 'unique-login', 'n', 0, 'approved')"
                ),
                {},
            ),
            (
                "INSERT INTO apps (id, owner_id, name, url, prompt, description, subject, "
                "is_public, theme_id, version, url_version, created_at, updated_at) "
                "VALUES ('00000000-0000-0000-0000-000000000021', 'missing-owner', 'n', "
                "'https://example.test', '', '', '수학', 1, '"
                + CATALOG["themes"][0]["id"]
                + "', 1, 1, 't', 't')",
                {},
            ),
            (
                (
                    "INSERT INTO apps (id, owner_id, name, url, prompt, description, subject, "
                    "is_public, theme_id, version, url_version, created_at, updated_at) "
                    "VALUES ('00000000-0000-0000-0000-000000000022', :owner, 'n', "
                    "'https://example.test', '', '', 'not-a-subject', 1, :theme, 1, 1, 't', 't')"
                ),
                {
                    "owner": member["id"],
                    "theme": CATALOG["themes"][0]["id"],
                },
            ),
            (
                (
                    "INSERT INTO apps (id, owner_id, name, url, prompt, description, subject, "
                    "is_public, theme_id, version, url_version, created_at, updated_at) "
                    "VALUES ('00000000-0000-0000-0000-000000000023', :owner, 'n', "
                    "'https://example.test', '', '', '수학', 1, :theme, 0, 1, 't', 't')"
                ),
                {
                    "owner": member["id"],
                    "theme": CATALOG["themes"][0]["id"],
                },
            ),
        ]
        for statement, parameters in invalid_rows:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement), parameters)

        app_id = "00000000-0000-0000-0000-000000000031"
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO apps (id, owner_id, name, url, prompt, description, "
                    "subject, is_public, theme_id, version, url_version, created_at, "
                    "updated_at) VALUES (:id, :owner, 'n', 'https://example.test', '', "
                    "'', '수학', 1, :theme, 1, 1, 't', 't')"
                ),
                {
                    "id": app_id,
                    "owner": member["id"],
                    "theme": CATALOG["themes"][0]["id"],
                },
            )
            connection.execute(
                text("INSERT INTO app_grades (app_id, grade) VALUES (:id, '초1')"),
                {"id": app_id},
            )

        for statement in [
            "INSERT INTO app_grades (app_id, grade) VALUES (:id, '초1')",
            "INSERT INTO app_grades (app_id, grade) VALUES (:id, '대1')",
            (
                "INSERT INTO health_results (app_id, state, checked_at, fresh_until) "
                "VALUES (:id, 'unchecked', '2026-09-28T12:00:00Z', NULL)"
            ),
            (
                "INSERT INTO health_results (app_id, state, checked_at, fresh_until) "
                "VALUES (:id, 'healthy', NULL, NULL)"
            ),
        ]:
            with pytest.raises(IntegrityError), engine.begin() as connection:
                connection.execute(text(statement), {"id": app_id})
