import json
import sqlite3
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.catalog import CATALOG
from tests.app_create_client import API, INPUT, error, read
from tests.app_update_client import detail, issue_update, registered, update, update_key
from tests.auth_client import signed_in
from tests.contracts.test_admin_approval import headers
from tests.contracts.test_app_input import URL_CASES


@pytest.mark.parametrize("boundary", ["issue", "patch"])
def test_edit_shares_all_registration_url_policy_cases(member_app, boundary):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = update_key(owner, item["id"])
        version = 1
        for url, valid in [
            *URL_CASES,
            ["https://example.com/" + "a" * 2028, True],
            ["https://example.com/" + "a" * 2029, False],
            ["http:/@example.com", False],
            ["https:////:@example.com", False],
            ["http://[::127.0.0.1]/", False],
        ]:
            patch = {"url": url}
            selected = (
                update_key(owner, item["id"], patch, version)
                if valid and boundary == "patch"
                else key
            )
            result = (
                issue_update(owner, item["id"], patch, version)
                if boundary == "issue"
                else update(owner, item["id"], selected, patch, version)
            )
            if valid:
                assert result.status_code == (201 if boundary == "issue" else 200), (
                    url,
                    result.text,
                )
                if boundary == "patch":
                    version += 1
                    assert result.json()["item"]["url"] == url.strip()
            else:
                error(result, 422, "VALIDATION_ERROR")
                assert "url" in result.json()["error"]["fields"]


@pytest.mark.parametrize("boundary", ["issue", "patch"])
def test_partial_input_strict_fields_catalog_unicode_and_limits(member_app, boundary):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        key = update_key(owner, item["id"])
        invalid = [{}]
        for field, maximum in [
            ("name", 100),
            ("prompt", 30000),
            ("description", 20000),
        ]:
            invalid += [
                {field: value}
                for value in (
                    " ",
                    "\u200b\u2060\ufe0f",
                    "😀" * (maximum + 1),
                    "a\x00",
                    "a\u202e",
                    123,
                    None,
                )
            ]
        invalid += [
            {field: None}
            for field in ("url", "subject", "grades", "is_public", "theme_id")
        ]
        invalid += [
            {field: value}
            for field, value in [
                ("subject", "outside"),
                ("theme_id", "outside"),
                ("grades", []),
                ("grades", [CATALOG["grades"][0]] * 2),
                ("grades", ["outside"]),
                ("grades", "초3"),
                ("is_public", 1),
                ("is_public", "true"),
                ("owner_id", str(uuid4())),
                ("version", 99),
                ("url_version", 99),
                ("health", {}),
                ("created_at", "2026-01-01"),
                ("name", "a\t"),
            ]
        ]
        for field in ("stack_db", "stack_backend", "stack_frontend", "stack_hosting"):
            invalid += [{field: value} for value in ("😀" * 201, "a\t", 42)]
        for patch in invalid:
            result = (
                issue_update(owner, item["id"], patch)
                if boundary == "issue"
                else update(owner, item["id"], key, patch)
            )
            error(result, 422, "VALIDATION_ERROR")
            assert result.json()["error"]["fields"]
        for version in (None, True, 1.0, "1", 0, -1, 9007199254740992):
            result = (
                issue_update(owner, item["id"], version=version)
                if boundary == "issue"
                else update(owner, item["id"], key, version=version)
            )
            error(result, 422, "VALIDATION_ERROR")
        assert read(owner, key).json()["state"] == "unresolved"
        assert detail(owner, item["id"]).json()["item"] == item


def test_omission_null_normalization_and_fragment_are_key_bound(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner, {**INPUT, "stack_db": "SQLite"})
        patch = {
            "name": " e\u0301 ",
            "prompt": "a\r\nb\u2028c",
            "grades": list(reversed(CATALOG["grades"])),
        }
        key = update_key(owner, item["id"], patch)
        error(
            update(owner, item["id"], key, {**patch, "stack_db": None}),
            409,
            "OPERATION_KEY_MISMATCH",
        )
        result = update(
            owner,
            item["id"],
            key,
            {**patch, "name": "é", "prompt": "a\nb\nc", "grades": CATALOG["grades"]},
        )
        assert result.status_code == 200, result.text
        saved = result.json()["item"]
        assert saved["name"] == "é" and saved["prompt"] == "a\nb\nc"
        assert (
            saved["stack_db"] == "SQLite"
            and saved["description"] == item["description"]
        )
        key = update_key(owner, item["id"], {"stack_db": None}, 2)
        error(
            update(owner, item["id"], key, {"name": "é"}, 2),
            409,
            "OPERATION_KEY_MISMATCH",
        )
        assert (
            update(owner, item["id"], key, {"stack_db": "   "}, 2).json()["item"][
                "stack_db"
            ]
            is None
        )
        key = update_key(owner, item["id"], {"url": INPUT["url"] + "#a"}, 3)
        error(
            update(owner, item["id"], key, {"url": INPUT["url"] + "#b"}, 3),
            409,
            "OPERATION_KEY_MISMATCH",
        )


@pytest.mark.parametrize(
    "patch,reset",
    [
        ({"name": INPUT["name"]}, False),
        ({"url": INPUT["url"] + "#next"}, False),
        ({"url": "https://WWW.naver.com"}, True),
        ({"url": "https://www.naver.com:443"}, True),
        ({"url": "https://example.com/next"}, True),
    ],
)
def test_url_literal_change_resets_health_but_fragment_and_same_values_preserve_it(
    member_app, patch, reset
):
    app, path = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE health_results SET state='healthy',checked_at='2026-10-01T00:00:00Z',fresh_until='2099-01-01T00:00:00Z'"
            )
        before = detail(owner, item["id"]).json()["item"]
        key = update_key(owner, item["id"], patch)
        result = update(owner, item["id"], key, patch)
        assert result.status_code == 200, result.text
        saved = result.json()["item"]
        assert saved["version"] == 2 and saved["url_version"] == (2 if reset else 1)
        assert saved["health"] == (item["health"] if reset else before["health"])
        error(update(owner, item["id"], key, patch), 409, "OPERATION_ALREADY_RESOLVED")
        assert detail(owner, item["id"]).json()["item"]["version"] == 2


def test_edit_large_unicode_body_duplicate_json_keys_and_key_validation(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        owner = signed_in(client)
        item = registered(owner)
        patch = {
            "name": "😀" * 100,
            "prompt": "😀" * 30000,
            "description": "😀" * 20000,
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
        issued = client.post(
            f"{API}/write-operations",
            content=json.dumps(
                {
                    "kind": "app_update",
                    "target_id": item["id"],
                    "expected_version": 1,
                    "input": patch,
                },
                ensure_ascii=True,
            ),
            headers={**headers(owner), "Content-Type": "application/json"},
        )
        assert issued.status_code == 201, issued.text
        key = issued.json()["key"]
        for keys in (
            [],
            [("Idempotency-Key", key)] * 2,
            [("Idempotency-Key", "bad")],
            [("Idempotency-Key", key.upper())],
        ):
            error(
                update(
                    owner,
                    item["id"],
                    key,
                    patch,
                    headers=[*headers(owner).items(), *keys],
                ),
                422,
                "VALIDATION_ERROR",
            )
        for url, method, body in [
            (f"/apps/{item['id']}", "patch", '{"name":"a","name":"b"}'),
            ("/write-operations", "post", '{"kind":"app_update","kind":"app_create"}'),
            (f"/apps/{item['id']}", "patch", "{bad"),
        ]:
            error(
                getattr(client, method)(
                    f"{API}{url}",
                    content=body,
                    headers={**headers(owner), "Content-Type": "application/json"},
                ),
                400,
                "BAD_REQUEST",
            )
        saved = client.patch(
            f"{API}/apps/{item['id']}",
            content=json.dumps({"expected_version": 1, **patch}, ensure_ascii=True),
            headers={
                **headers(owner),
                "Idempotency-Key": key,
                "Content-Type": "application/json",
            },
        )
        assert saved.status_code == 200, saved.text
        assert saved.json()["item"]["prompt"] == patch["prompt"]


@pytest.mark.parametrize("chunked", [False, True])
def test_edit_body_limit_is_exact_and_does_not_widen_approval_or_subpaths(
    member_app, chunked
):
    app, _ = member_app()
    with TestClient(app) as client:
        for url, method, size in [
            (f"/apps/{uuid4()}", "patch", 1200000),
            ("/write-operations", "post", 1200000),
            (f"/apps/{uuid4()}/health", "patch", 18000),
            ("/write-operations/unknown/cancel", "post", 18000),
        ]:
            body = b" " * size
            selected = iter([body[: size // 2], body[size // 2 :]]) if chunked else body
            response = getattr(client, method)(f"{API}{url}", content=selected)
            if url.endswith("/health"):
                assert response.status_code == 404
            else:
                error(response, 413, "PAYLOAD_TOO_LARGE")
        for body in (
            b'{"kind":"user_approval","padding":"' + b"x" * 18000 + b'"}',
            b'{"kind":"app_update","kind":"app_update","padding":"'
            + b"x" * 18000
            + b'"}',
        ):
            error(
                client.post(f"{API}/write-operations", content=body),
                413,
                "PAYLOAD_TOO_LARGE",
            )
