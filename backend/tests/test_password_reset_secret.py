"""Dedicated secret file verification and independently calculated HMAC vector."""

import hashlib
import hmac
import json

import pytest

from tests.password_reset_client import supply


def test_canonical_hmac_binds_key_actor_version_and_nfc():
    from app.password_reset_secret import fingerprint

    secret = bytes(range(32))
    values = (
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
        1,
        " Password é 12345 ",
    )
    # Independent literal canonical wire representation, including preserved spaces.
    wire = '{"actor_id":"00000000-0000-4000-8000-000000000002","expected_account_version":1,"key":"00000000-0000-4000-8000-000000000001","kind":"user_password_reset","new_password":" Password é 12345 ","target_id":"00000000-0000-4000-8000-000000000003","version":1}'
    expected = hmac.new(secret, wire.encode(), hashlib.sha256).hexdigest()
    assert fingerprint(secret, *values) == expected
    assert fingerprint(secret, *values[:-1], " Password e\u0301 12345 ") == expected
    assert fingerprint(secret, *values[:-1], values[-1].strip()) != expected
    assert fingerprint(secret, "other-key", *values[1:]) != expected


@pytest.mark.parametrize(
    "problem",
    ["missing", "permissions", "key_id", "extra", "short", "large", "encoding"],
)
def test_invalid_supply_is_unavailable(tmp_path, problem):
    from app.password_reset_secret import load_secret

    path = supply(tmp_path / "secret.json")
    if problem == "missing":
        path.unlink()
    elif problem == "permissions":
        path.chmod(0o644)
    elif problem == "encoding":
        path.write_bytes(path.read_text().encode("utf-16"))
    else:
        value = json.loads(path.read_text())
        if problem == "key_id":
            value["key_id"] = "0" * 64
        if problem == "extra":
            value["extra"] = "no"
        if problem == "short":
            value["secret_hex"] = "aa"
        path.write_text("x" * 1025 if problem == "large" else json.dumps(value))
    available = load_secret(path) is not None
    assert not available


def test_verified_file_and_repository_file_rejection(tmp_path):
    from app.password_reset_secret import load_secret
    from app.settings import ROOT

    secret = bytes(range(32))
    path = supply(tmp_path / "valid.json", secret)
    assert load_secret(path) == (secret, hashlib.sha256(secret).hexdigest())
    assert load_secret(ROOT / "AGENTS.md") is None
    assert load_secret(tmp_path) is None
    assert load_secret(None) is None


@pytest.mark.parametrize("shape", ["array_of_pairs", "duplicate_property"])
def test_secret_supply_requires_an_object_with_unique_properties(tmp_path, shape):
    from app.password_reset_secret import load_secret

    path = supply(tmp_path / "secret.json")
    value = json.loads(path.read_text())
    if shape == "array_of_pairs":
        raw = json.dumps(list(value.items()))
    else:
        raw = json.dumps(value)[:-1] + ',"key_id":' + json.dumps(value["key_id"]) + "}"
    path.write_text(raw)
    available = load_secret(path) is not None
    assert not available


def test_identifier_and_request_binding_use_constant_time_comparison(
    make_test_app, tmp_path, monkeypatch
):
    from fastapi.testclient import TestClient

    from tests.password_reset_client import admin, execute, issue, reset_app

    calls = []
    real = hmac.compare_digest

    def compare(left, right):
        calls.append((len(left), len(right)))
        return real(left, right)

    app, _path, _ = reset_app(make_test_app, tmp_path)
    monkeypatch.setattr(hmac, "compare_digest", compare)
    with TestClient(app) as client:
        browser = admin(client)
        key = issue(browser).json()["key"]
        assert execute(browser, key).status_code == 204
    assert calls.count((64, 64)) >= 4


@pytest.mark.parametrize("problem", ["cycle", "unknown_home"])
def test_invalid_optional_path_does_not_escape_the_reset_loader(tmp_path, problem):
    from pathlib import Path

    from app.password_reset_secret import load_secret

    if problem == "cycle":
        path = tmp_path / "cycle"
        path.symlink_to(path.name)
    else:
        path = Path("~nonexistent-reset-fixture-user-167/secret.json")
    unavailable = load_secret(path) is None
    assert unavailable
