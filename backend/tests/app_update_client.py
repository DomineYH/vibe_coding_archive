"""App edits through the existing protected HTTP seam."""

from tests.app_create_client import API, create, issued_key
from tests.contracts.test_admin_approval import headers

PATCH = {"name": "편집한 수업 앱"}


def registered(browser, body=None):
    return create(browser, issued_key(browser, body), body).json()["item"]


def issue_update(browser, app_id, patch=None, version=1, **kwargs):
    return browser.client.post(
        f"{API}/write-operations",
        json={
            "kind": "app_update",
            "target_id": app_id,
            "expected_version": version,
            "input": PATCH if patch is None else patch,
        },
        headers=kwargs.pop("headers", headers(browser)),
        **kwargs,
    )


def update_key(browser, app_id, patch=None, version=1):
    result = issue_update(browser, app_id, patch, version)
    assert result.status_code == 201, result.text
    return result.json()["key"]


def update(browser, app_id, key, patch=None, version=1, **kwargs):
    return browser.client.patch(
        f"{API}/apps/{app_id}",
        json={"expected_version": version, **(PATCH if patch is None else patch)},
        headers=kwargs.pop("headers", {**headers(browser), "Idempotency-Key": key}),
        **kwargs,
    )


def detail(browser, app_id):
    return browser.client.get(f"{API}/apps/{app_id}", headers=headers(browser))
