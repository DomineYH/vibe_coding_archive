from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi import FastAPI

from app.main import create_app
from app.settings import Settings

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def normalize_schema():
    def normalize(schema: object, document: dict) -> object:
        components = document["components"]["schemas"]
        if isinstance(schema, list):
            return [normalize(item, document) for item in schema]
        if not isinstance(schema, dict):
            return schema
        if "$ref" in schema:
            reference = schema["$ref"]
            assert reference.startswith("#/components/schemas/")
            return normalize(components[reference.rsplit("/", 1)[1]], document)

        normalized = {
            key: normalize(value, document)
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
            formats = {
                variant.get("format") for variant in variants if "format" in variant
            }
            if len(formats) <= 1:
                normalized.pop("anyOf")
                normalized["type"] = [variant["type"] for variant in variants]
                if formats:
                    normalized["format"] = formats.pop()
        return normalized

    return normalize


@pytest.fixture
def make_test_app(migrate_test_database, request):
    def make(database_path: Path, *, auth_testing=False) -> FastAPI:
        migrate_test_database(database_path)
        env = {
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database_path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        }
        if auth_testing:
            env["PASSWORD_BLOCKLIST_PATH"] = str(
                request.getfixturevalue("password_blocklist")
            )
        settings = Settings.from_environment(env, repo_root=ROOT)
        return create_app(settings, auth_testing=auth_testing)

    return make
