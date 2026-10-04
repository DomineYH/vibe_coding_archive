"""App creation through the protected HTTP boundary."""

from app.catalog import CATALOG
from tests.contracts.test_admin_approval import headers

API = "/api/v1"
INPUT = {
    "name": "새 수업 앱",
    "url": "https://www.naver.com",
    "prompt": "수업을 위한 프롬프트",
    "description": "학생과 함께 사용합니다.",
    "subject": CATALOG["subjects"][0],
    "grades": [CATALOG["grades"][0]],
    "is_public": True,
    "theme_id": CATALOG["themes"][0]["id"],
    "stack_db": None,
    "stack_backend": None,
    "stack_frontend": None,
    "stack_hosting": None,
}


def issue(browser, body=None, **kwargs):
    return browser.client.post(
        f"{API}/write-operations",
        json={"kind": "app_create", "input": INPUT if body is None else body},
        headers=kwargs.pop("headers", headers(browser)),
        **kwargs,
    )


def create(browser, key, body=None, **kwargs):
    return browser.client.post(
        f"{API}/apps",
        json=INPUT if body is None else body,
        headers=kwargs.pop("headers", {**headers(browser), "Idempotency-Key": key}),
        **kwargs,
    )


def read(browser, key, **kwargs):
    return browser.client.get(
        f"{API}/write-operations/{key}",
        headers=kwargs.pop("headers", headers(browser)),
        **kwargs,
    )


def issued_key(browser, body=None):
    result = issue(browser, body)
    assert result.status_code == 201, result.text
    return result.json()["key"]


def error(result, status, code):
    assert result.status_code == status, result.text
    assert result.json()["error"]["code"] == code, result.text
    assert result.headers["Cache-Control"] == "no-store"
