import json
import sqlite3
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.catalog import CATALOG
from tests.app_create_client import API, INPUT, create, error, issue, issued_key, read
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import headers

URL_CASES = json.loads((Path(__file__).parents[1] / "app_url_cases.json").read_text())


@pytest.mark.parametrize("boundary", ["issue", "create"])
def test_url_policy_at_both_boundaries(member_app, boundary):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        cases = [
            *URL_CASES,
            ["https://example.com/" + "a" * (2048 - 20), True],
            ["https://example.com/" + "a" * (2049 - 20), False],
        ]
        for url, valid in cases:
            body = {**INPUT, "url": url}
            if valid and boundary == "create":
                selected_key = issued_key(browser, body)
            else:
                selected_key = key
            result = (
                issue(browser, body)
                if boundary == "issue"
                else create(browser, selected_key, body)
            )
            if valid:
                assert result.status_code == 201, (url, result.text)
            else:
                error(result, 422, "VALIDATION_ERROR")
                assert "url" in result.json()["error"]["fields"], url


@pytest.mark.parametrize("boundary", ["issue", "create"])
def test_strict_fields_unicode_limits_and_catalog(member_app, boundary):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        key = issued_key(browser)
        invalid = []
        for field, maximum in (
            ("name", 100),
            ("prompt", 30000),
            ("description", 20000),
        ):
            invalid.extend(
                (field, value)
                for value in (
                    " ",
                    "\u200b\u2060\ufe0f",
                    "😀" * (maximum + 1),
                    "a\u0000",
                    "a\u202e",
                    123,
                    None,
                )
            )
        invalid += [
            ("name", "\tname"),
            ("name", "name\n"),
            ("url", "https://example.com/\r"),
        ]
        invalid += [
            ("subject", "outside"),
            ("theme_id", "outside"),
            ("is_public", 1),
            ("is_public", "true"),
            ("grades", []),
            ("grades", CATALOG["grades"] + [CATALOG["grades"][0]]),
            ("grades", [CATALOG["grades"][0]] * 2),
            ("grades", ["outside"]),
            ("grades", "고1"),
        ]
        for field in ("stack_db", "stack_backend", "stack_frontend", "stack_hosting"):
            invalid.extend(
                (field, value) for value in ("😀" * 201, "a\t", "a\u0080", 42)
            )
        invalid += [
            ("owner_id", "00000000-0000-4000-8000-000000000103"),
            ("version", 99),
            ("health", {"state": "healthy"}),
        ]
        for field, value in invalid:
            body = {**INPUT, field: value}
            result = (
                issue(browser, body)
                if boundary == "issue"
                else create(browser, key, body)
            )
            error(result, 422, "VALIDATION_ERROR")
            assert result.json()["error"]["fields"], (field, value)
        for field in INPUT:
            body = {k: v for k, v in INPUT.items() if k != field}
            result = (
                issue(browser, body)
                if boundary == "issue"
                else create(browser, key, body)
            )
            error(result, 422, "VALIDATION_ERROR")
        assert read(browser, key).json()["state"] == "unresolved"


def test_maximum_escaped_body_and_normalization_fit_app_limit(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = signed_in(client)
        body = {
            **INPUT,
            "name": "😀" * 100,
            "prompt": "😀" * 30000,
            "description": "😀" * 20000,
            "grades": list(reversed(CATALOG["grades"])),
            **{
                field: "😀" * 200
                for field in (
                    "stack_db",
                    "stack_backend",
                    "stack_frontend",
                    "stack_hosting",
                )
            },
        }
        wire = json.dumps({"kind": "app_create", "input": body}, ensure_ascii=True)
        result = client.post(
            f"{API}/write-operations",
            content=wire,
            headers={**headers(browser), "Content-Type": "application/json"},
        )
        assert result.status_code == 201, result.text
        key = result.json()["key"]
        result = client.post(
            f"{API}/apps",
            content=json.dumps(body, ensure_ascii=True),
            headers={
                **headers(browser),
                "Content-Type": "application/json",
                "Idempotency-Key": key,
            },
        )
        assert result.status_code == 201, result.text
        assert result.json()["item"]["grades"] == CATALOG["grades"]
        body = {
            **INPUT,
            "name": " e\u0301 ",
            "url": " https://www.naver.com ",
            "prompt": "a\r\nb\rc\u0085d\u2028e\u2029f\t ",
            "stack_db": " e\u0301 ",
        }
        key = issued_key(browser, body)
        result = create(browser, key, body)
        assert result.status_code == 201, result.text
        saved = result.json()["item"]
        assert saved["name"] == saved["stack_db"] == "é"
        assert saved["prompt"] == "a\nb\nc\nd\ne\nf\t "
        assert saved["url"] == INPUT["url"]


@pytest.mark.parametrize("chunked", [False, True])
def test_streaming_app_limits_and_approval_limit_before_auth(member_app, chunked):
    app, path = member_app()
    with TestClient(app) as client:
        for url in ("/apps", "/write-operations"):
            body = iter([b" " * 600000, b" " * 600000]) if chunked else b" " * 1200000
            error(client.post(f"{API}{url}", content=body), 413, "PAYLOAD_TOO_LARGE")
        for body in (
            b" " * 18000,
            b'{"kind":"user_approval","padding":"' + b"x" * 18000 + b'"}',
            b'{"kind":"app_create","kind":"app_create","padding":"'
            + b"x" * 18000
            + b'"}',
        ):
            selected = iter([body[:9000], body[9000:]]) if chunked else body
            error(
                client.post(f"{API}/write-operations", content=selected),
                413,
                "PAYLOAD_TOO_LARGE",
            )
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT count(*) FROM write_operations").fetchone() == (
                0,
            )
