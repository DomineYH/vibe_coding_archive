"""Interactive deletion through the protected HTTP boundary."""

from tests.app_create_client import API
from tests.contracts.test_admin_approval import headers


def issue_delete(browser, app_id, version=1, **kwargs):
    return browser.client.post(
        f"{API}/write-operations",
        json={"kind": "app_delete", "target_id": app_id, "expected_version": version},
        headers=kwargs.pop("headers", headers(browser)),
        **kwargs,
    )


def delete_key(browser, app_id, version=1):
    result = issue_delete(browser, app_id, version)
    assert result.status_code == 201, result.text
    return result.json()["key"]


def delete(browser, app_id, key, version=1, **kwargs):
    return browser.client.request(
        "DELETE",
        f"{API}/apps/{app_id}",
        json={"expected_version": version},
        headers=kwargs.pop("headers", {**headers(browser), "Idempotency-Key": key}),
        **kwargs,
    )
