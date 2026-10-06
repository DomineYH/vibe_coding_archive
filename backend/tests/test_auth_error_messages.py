"""Auth error defaults preserve the shared response envelope and explicit copy."""

import ast
import json
from pathlib import Path
from uuid import UUID

import pytest

from app import auth_boundary
from app.auth_boundary import AuthError, error_response

FALLBACK = "인증 준비를 완료할 수 없어요. 다시 확인해 주세요."
DEFAULT_MESSAGES = [
    ("REAUTH_REQUIRED", 403, "관리자 본인 확인이 필요해요."),
    ("FORBIDDEN", 403, "이 작업을 수행할 권한이 없어요."),
    (
        "PASSWORD_CHANGE_REQUIRED",
        403,
        "먼저 본인 계정의 비밀번호를 변경해 주세요.",
    ),
    ("SESSION_KIND_NOT_ALLOWED", 403, "현재 세션으로는 이 작업을 수행할 수 없어요."),
    ("ADMIN_ACCOUNT_PROTECTED", 403, "관리자 계정에는 이 작업을 수행할 수 없어요."),
    ("USER_NOT_FOUND", 404, "회원을 찾을 수 없어요."),
    (
        "USER_STATE_CONFLICT",
        409,
        "회원 상태가 바뀌었어요. 현재 상태를 다시 확인해 주세요.",
    ),
    ("LOGIN_ID_TAKEN", 409, "이미 사용 중인 로그인 아이디예요."),
    (
        "VERSION_CONFLICT",
        409,
        "다른 곳에서 먼저 바뀌었어요. 최신 내용을 확인해 주세요.",
    ),
    ("OPERATION_NOT_FOUND", 404, "작업 키를 찾을 수 없어 결과를 확인할 수 없어요."),
    ("OPERATION_EXPIRED", 410, "작업 키의 확인 기간이 지나 결과를 확인할 수 없어요."),
    ("OPERATION_KEY_MISMATCH", 409, "작업 키와 요청 내용이 일치하지 않아요."),
    (
        "OPERATION_ALREADY_RESOLVED",
        409,
        "이미 결과가 확정된 작업이에요. 기존 작업 결과를 확인해 주세요.",
    ),
    ("SERVICE_UNAVAILABLE", 503, "현재 서비스를 이용할 수 없어요."),
]
REQUEST_ID = "00000000-0000-4000-8000-000000000164"
SERVER_TIME = "2026-10-05T00:00:00.000000Z"
RETRY_AT = "2026-10-05T00:01:00.000000Z"


def test_all_message_less_auth_error_codes_have_defaults():
    codes = set()
    for path in Path(auth_boundary.__file__).parent.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "AuthError"
            ):
                continue
            if any(
                keyword.arg == "message"
                and not (
                    isinstance(keyword.value, ast.Constant) and not keyword.value.value
                )
                for keyword in node.keywords
            ):
                continue
            values = [node.args[0]]
            if isinstance(values[0], ast.Name):
                name = values[0].id
                values = [
                    assignment.value
                    for assignment in ast.walk(tree)
                    if isinstance(assignment, ast.Assign)
                    and any(
                        isinstance(target, ast.Name) and target.id == name
                        for target in assignment.targets
                    )
                ]
            assert values, f"Unresolved AuthError code at {path.name}:{node.lineno}"
            for value in values:
                branches = (
                    [value.body, value.orelse]
                    if isinstance(value, ast.IfExp)
                    else [value]
                )
                for branch in branches:
                    assert isinstance(branch, ast.Constant) and isinstance(
                        branch.value, str
                    ), f"Unresolved AuthError code at {path.name}:{node.lineno}"
                    codes.add(branch.value)
    assert codes
    missing = [
        code
        for code in sorted(codes)
        if json.loads(error_response(AuthError(code)).body)["error"]["message"]
        == FALLBACK
    ]
    assert missing == [], f"AuthError codes without default messages: {missing}"


@pytest.fixture
def fixed_metadata(monkeypatch):
    monkeypatch.setattr(auth_boundary, "uuid4", lambda: UUID(REQUEST_ID))
    monkeypatch.setattr(auth_boundary, "now", lambda: SERVER_TIME)


@pytest.mark.parametrize("code,status,message", DEFAULT_MESSAGES)
def test_default_message_preserves_envelope(code, status, message):
    response = error_response(AuthError(code, status))
    error = json.loads(response.body)["error"]

    assert error["message"] == message
    assert error["message"] != FALLBACK
    assert error["code"] == code
    assert response.status_code == status
    assert str(UUID(error["request_id"])) == error["request_id"]
    assert set(error) == {"code", "message", "request_id"}
    assert response.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in response.headers


@pytest.mark.parametrize("code,status,message", DEFAULT_MESSAGES)
def test_default_message_preserves_optional_metadata(
    code, status, message, fixed_metadata
):
    response = error_response(
        AuthError(code, status, fields={"login_id": "field detail"}, retry_at=RETRY_AT)
    )

    assert json.loads(response.body) == {
        "error": {
            "code": code,
            "message": message,
            "request_id": REQUEST_ID,
            "fields": {"login_id": "field detail"},
            "retry_at": RETRY_AT,
            "server_time": SERVER_TIME,
        }
    }
    assert response.status_code == status
    assert response.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in response.headers


@pytest.mark.parametrize("fields", [None, {}])
def test_absent_or_empty_optional_metadata_stays_omitted(fields, fixed_metadata):
    response = error_response(
        AuthError("AUTH_REQUIRED", 401, fields=fields, retry_at=None)
    )

    assert json.loads(response.body) == {
        "error": {
            "code": "AUTH_REQUIRED",
            "message": "인증 흐름의 유효한 증명이 필요해요.",
            "request_id": REQUEST_ID,
        }
    }
    assert response.status_code == 401
    assert response.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in response.headers


@pytest.mark.parametrize("code,status,message", DEFAULT_MESSAGES)
def test_explicit_message_preserves_override_and_metadata(
    code, status, message, fixed_metadata
):
    response = error_response(
        AuthError(
            code,
            status,
            message="명시적으로 지정한 안내예요.",
            fields={"login_id": "field detail"},
            retry_at=RETRY_AT,
        )
    )

    assert json.loads(response.body) == {
        "error": {
            "code": code,
            "message": "명시적으로 지정한 안내예요.",
            "request_id": REQUEST_ID,
            "fields": {"login_id": "field detail"},
            "retry_at": RETRY_AT,
            "server_time": SERVER_TIME,
        }
    }
    assert response.status_code == status
    assert response.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in response.headers


def test_unknown_code_retains_fallback(fixed_metadata):
    response = error_response(AuthError("UNKNOWN_TEST_CODE", 418))

    assert json.loads(response.body) == {
        "error": {
            "code": "UNKNOWN_TEST_CODE",
            "message": FALLBACK,
            "request_id": REQUEST_ID,
        }
    }
    assert response.status_code == 418
    assert response.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in response.headers


@pytest.mark.parametrize(
    "code,message,retry_after",
    [
        ("AUTH_BUSY", "요청이 몰려 있어요. 잠시 뒤에 다시 시도해 주세요.", "1"),
        ("DB_BUSY", "서버가 바빠요. 잠시 뒤에 다시 시도해 주세요.", "1"),
    ],
)
def test_existing_defaults_and_retry_headers_stay_unchanged(
    code, message, retry_after, fixed_metadata
):
    response = error_response(AuthError(code, 503))

    assert json.loads(response.body) == {
        "error": {"code": code, "message": message, "request_id": REQUEST_ID}
    }
    assert response.status_code == 503
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers.get("Retry-After") == retry_after


@pytest.mark.parametrize("code,status,message", DEFAULT_MESSAGES)
def test_empty_explicit_message_selects_default(code, status, message, fixed_metadata):
    response = error_response(AuthError(code, status, message=""))

    assert json.loads(response.body) == {
        "error": {"code": code, "message": message, "request_id": REQUEST_ID}
    }
    assert response.status_code == status
    assert response.headers["Cache-Control"] == "no-store"
    assert "Retry-After" not in response.headers
