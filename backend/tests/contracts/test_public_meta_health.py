from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "contracts/catalog.json").read_text())


def test_meta_health_and_readiness_use_public_contract_and_file_database(
    tmp_path: Path, make_test_app
):
    database_path = tmp_path / "phase2.sqlite3"
    app = make_test_app(database_path)

    with TestClient(app) as client:
        health = client.get("/healthz")
        ready = client.get("/readyz")
        meta_response = client.get("/api/v1/meta")

        assert health.status_code == 200
        assert health.json() == {"status": "ok"}
        assert ready.status_code == 200
        assert ready.json() == {"status": "ready"}
        assert meta_response.status_code == 200
        meta = meta_response.json()
        assert set(meta) == {
            "subjects",
            "grades",
            "themes",
            "server_time",
            "capabilities",
            "support",
            "initial_pending_days",
        }
        assert meta["subjects"] == CATALOG["subjects"]
        assert meta["grades"] == CATALOG["grades"]
        assert meta["themes"] == CATALOG["themes"]
        datetime.fromisoformat(meta["server_time"])
        assert meta["support"] == {
            "email": None,
            "service_url": None,
            "announcement_url": None,
        }
        assert meta["initial_pending_days"] == 90
        assert set(meta["capabilities"]) == {
            "apps_read",
            "auth_register",
            "auth_login",
            "auth_logout",
            "auth_password_change",
            "admin_users_read",
            "admin_approval",
            "admin_summary",
            "apps_create",
            "apps_update_own",
            "apps_delete_own",
            "admin_apps_read",
            "admin_apps_manage",
            "admin_reauth",
            "admin_password_reset",
            "admin_user_delete",
            "health_read",
            "health_check",
            "health_batch",
            "email_collection",
            "phone_collection",
        }
        assert meta["capabilities"]["apps_read"] == {
            "enabled": True,
            "reasons": [],
        }
        for key, capability in meta["capabilities"].items():
            assert capability["enabled"] is (key in ("apps_read", "health_read"))
            expected_reasons = (
                []
                if key in ("apps_read", "health_read")
                else [
                    "collection_disabled"
                    if key.endswith("_collection")
                    else "operational_restriction"
                    if key
                    in (
                        "admin_password_reset",
                        "admin_user_delete",
                        "admin_apps_read",
                        "admin_apps_manage",
                        "health_check",
                        "health_batch",
                    )
                    else "not_implemented"
                ]
            )
            assert capability["reasons"] == expected_reasons

        connection = sqlite3.connect(database_path)
        try:
            assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
            connection.execute(
                "UPDATE alembic_version SET version_num = 'unknown_revision'"
            )
            connection.commit()
        finally:
            connection.close()

        with app.state.engine.connect() as first, app.state.engine.connect() as second:
            assert first.connection is not second.connection
            assert first.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1
            assert second.exec_driver_sql("PRAGMA foreign_keys").scalar_one() == 1

        not_ready = client.get("/readyz")
        still_alive = client.get("/healthz")
        assert not_ready.status_code == 503
        assert not_ready.json() == {"status": "not_ready"}
        assert still_alive.status_code == 200
        assert still_alive.json() == {"status": "ok"}


def test_fastapi_declarations_match_the_single_openapi_source(
    tmp_path: Path, make_test_app, normalize_schema
):
    app = make_test_app(tmp_path / "contract.sqlite3")
    source = yaml.safe_load((ROOT / "contracts/openapi.yaml").read_text())
    actual = app.openapi()

    for path, status, schema_name in [
        ("/healthz", "200", "LivenessResponse"),
        ("/readyz", "200", "ReadyResponse"),
        ("/readyz", "503", "NotReadyResponse"),
    ]:
        operation = source["paths"][path]["get"]
        assert operation["servers"] == [{"url": "/"}]
        assert operation["security"] == []
        expected_ref = f"#/components/schemas/{schema_name}"
        assert (
            operation["responses"][status]["content"]["application/json"]["schema"][
                "$ref"
            ]
            == expected_ref
        )
        assert (
            actual["paths"][path]["get"]["responses"][status]["content"][
                "application/json"
            ]["schema"]["$ref"]
            == expected_ref
        )

    expected_meta = source["components"]["schemas"]["Meta"]
    actual_meta = actual["components"]["schemas"]["MetaResponse"]
    assert set(actual_meta["properties"]) == set(expected_meta["properties"])
    assert normalize_schema(actual_meta["properties"], actual) == normalize_schema(
        expected_meta["properties"], source
    )
    assert actual_meta["additionalProperties"] is False


import pytest


@pytest.mark.parametrize(
    "support",
    [
        {},
        {
            "SUPPORT_EMAIL": "",
            "SUPPORT_SERVICE_URL": " \t",
            "SUPPORT_ANNOUNCEMENT_URL": "",
        },
        {"SUPPORT_EMAIL": "support@example.test"},
        {"SUPPORT_SERVICE_URL": "https://service.example.test/help"},
        {"SUPPORT_ANNOUNCEMENT_URL": "https://notice.example.test/updates"},
        {
            "SUPPORT_EMAIL": "support@example.test",
            "SUPPORT_SERVICE_URL": "https://service.example.test/help",
            "SUPPORT_ANNOUNCEMENT_URL": "https://notice.example.test/updates",
        },
    ],
)
def test_meta_support_matches_configuration(
    tmp_path, make_test_app, monkeypatch, support
):
    for field in ["SUPPORT_EMAIL", "SUPPORT_SERVICE_URL", "SUPPORT_ANNOUNCEMENT_URL"]:
        monkeypatch.setenv(field, support.get(field, ""))
    app = make_test_app(tmp_path / "support.sqlite3")
    with TestClient(app) as client:
        response = client.get("/api/v1/meta")
        assert response.status_code == 200
        meta = response.json()
        assert meta["support"] == {
            "email": support.get("SUPPORT_EMAIL") or None,
            "service_url": (support.get("SUPPORT_SERVICE_URL") or "").strip() or None,
            "announcement_url": support.get("SUPPORT_ANNOUNCEMENT_URL") or None,
        }
        for field in ["email_collection", "phone_collection"]:
            assert meta["capabilities"][field] == {
                "enabled": False,
                "reasons": ["collection_disabled"],
            }
        for field in ["health_check", "health_batch"]:
            assert meta["capabilities"][field]["enabled"] is False
        assert app.state.settings.health_checks_enabled is False
