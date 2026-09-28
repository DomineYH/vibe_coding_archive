from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[3]
CATALOG = json.loads((ROOT / "contracts/catalog.json").read_text())


def normalized_schema(schema: object, document: dict) -> object:
    components = document["components"]["schemas"]
    if isinstance(schema, list):
        return [normalized_schema(item, document) for item in schema]
    if not isinstance(schema, dict):
        return schema
    if "$ref" in schema:
        reference = schema["$ref"]
        assert reference.startswith("#/components/schemas/")
        return normalized_schema(components[reference.rsplit("/", 1)[1]], document)

    normalized = {
        key: normalized_schema(value, document)
        for key, value in schema.items()
        if key != "title"
    }
    variants = normalized.get("anyOf")
    if isinstance(variants, list) and all(
        isinstance(variant, dict)
        and set(variant) <= {"type", "format"}
        and "type" in variant
        for variant in variants
    ):
        formats = {variant.get("format") for variant in variants if "format" in variant}
        if len(formats) <= 1:
            normalized.pop("anyOf")
            normalized["type"] = [variant["type"] for variant in variants]
            if formats:
                normalized["format"] = formats.pop()
    return normalized


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
            "enabled": False,
            "reasons": ["not_implemented"],
        }
        for key, capability in meta["capabilities"].items():
            assert capability["enabled"] is False
            assert capability["reasons"] == [
                "collection_disabled"
                if key.endswith("_collection")
                else "not_implemented"
            ]

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
    tmp_path: Path, make_test_app
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
    assert normalized_schema(actual_meta["properties"], actual) == normalized_schema(
        expected_meta["properties"], source
    )
    assert actual_meta["additionalProperties"] is False
