import sqlite3
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from tests.auth_client import API, Browser

PASSWORD = "  가입 비밀번호 보존 AbC 1234  "


def test_ordinary_runtime_rejects_registration_without_creating_a_member(
    make_test_app, tmp_path
):
    path = tmp_path / "ordinary.sqlite3"
    app = make_test_app(path, auth_testing=False)
    with TestClient(app) as client:
        result = client.post(
            f"{API}/register",
            json={"login_id": "teacher", "nickname": "교사", "password": PASSWORD},
            headers={"Origin": "http://localhost:5174"},
        )
    assert result.status_code == 503
    assert result.json()["error"]["code"] == "FEATURE_UNAVAILABLE"
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT count(*) FROM members").fetchone() == (0,)


def register(browser, **values):
    return browser.client.post(
        f"{API}/register",
        json={
            "login_id": " Teacher ",
            "password": PASSWORD,
            "nickname": " 같은 별명 ",
            **values,
        },
        headers={
            **browser.session_headers(),
            "X-EduVibe-Auth-Revision": browser.revision,
        },
    )


def test_registration_preserves_anonymous_session_and_stores_pending_member(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        cookies = dict(client.cookies)
        result = register(browser)
        assert result.status_code == 201, result.text
        body = result.json()
        assert body["login_id"] == "Teacher"
        assert body["nickname"] == "같은 별명"
        assert body["approved"] is False
        assert dict(client.cookies) == cookies
        assert "set-cookie" not in result.headers
        with sqlite3.connect(path) as db:
            member = db.execute(
                "SELECT login_id_key, approval_status, is_admin, first_approved_at, created_at, password_hash, email, phone FROM members WHERE id=?",
                (body["id"],),
            ).fetchone()
            assert member[:4] == ("teacher", "pending", 0, None)
            assert datetime.fromisoformat(
                body["pending_expires_at"]
            ) - datetime.fromisoformat(member[4]) == timedelta(days=90)
            assert member[5].startswith("$argon2id$")
            assert member[6:] == (None, None)
            assert db.execute(
                "SELECT member_id,kind FROM sessions WHERE flow_id=?", (browser.flow,)
            ).fetchall() == [(None, "anonymous")]
        assert (
            browser.login("teacher", PASSWORD + "!").json()["error"]["code"]
            == "INVALID_CREDENTIALS"
        )
        assert (
            browser.login("teacher", PASSWORD).json()["error"]["code"]
            == "ACCOUNT_NOT_APPROVED"
        )


import pytest


@pytest.mark.parametrize(
    "values,field",
    [
        ({"login_id": "a"}, "login_id"),
        ({"login_id": "ab" * 17}, "login_id"),
        ({"login_id": "bad name"}, "login_id"),
        ({"nickname": "교사\n"}, "nickname"),
        ({"nickname": "교\u202e사"}, "nickname"),
        ({"nickname": "\u200b\u200d"}, "nickname"),
        ({"nickname": "😀" * 21}, "nickname"),
        ({"password": "short"}, "password"),
        ({"password": "😀" * 129}, "password"),
        ({"password": "123456789012345"}, "password"),
        ({"email": "teacher@example.test"}, "email"),
        ({"phone": "010-1234-5678"}, "phone"),
        ({"approved": True}, "approved"),
        ({"role": "admin"}, "role"),
        ({"password_confirm": PASSWORD}, "password_confirm"),
    ],
)
def test_invalid_registration_counts_attempt_without_partial_member(
    member_app, values, field
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        result = register(browser, **values)
        assert result.status_code == 422, result.text
        assert result.json()["error"]["code"] == "VALIDATION_ERROR"
        assert field in result.json()["error"]["fields"]
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM members WHERE login_id_key='teacher'"
                ).fetchone()[0]
                == 0
            )
            assert (
                db.execute(
                    "SELECT count(*) FROM rate_limit_events WHERE purpose='register'"
                ).fetchone()[0]
                == 1
            )


def test_normalized_ids_are_unique_but_unicode_nicknames_are_not(member_app):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        first = register(browser, login_id="  가Teacher ", nickname=" e\u0301👩‍🏫 ")
        assert first.status_code == 201, first.text
        assert first.json()["login_id"] == "가Teacher"
        assert first.json()["nickname"] == "é👩‍🏫"
        duplicate = register(browser, login_id="가TEACHER")
        assert duplicate.status_code == 409
        assert duplicate.json()["error"]["code"] == "LOGIN_ID_TAKEN"
        second = register(
            browser, login_id="other", nickname="é👩‍🏫", email="  ", phone=None
        )
        assert second.status_code == 201
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM members WHERE login_id_key='가teacher'"
                ).fetchone()[0]
                == 1
            )


from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

from app.auth_boundary import after, digest, now
from app.auth_login import HASHER, HashGate
from tests.auth_client import signed_in


def test_concurrent_normalized_registration_is_one_member(member_app, monkeypatch):
    app, path = member_app()
    hashed = Barrier(2)
    real_hash = HASHER.hash

    def concurrent_hash(password):
        value = real_hash(password)
        hashed.wait(timeout=5)  # Both requests finish hashing before final commit.
        return value

    with TestClient(app) as one, TestClient(app) as two:
        a = Browser(one).prepare().anonymous()
        b = Browser(two).prepare().anonymous()
        monkeypatch.setattr(HASHER, "hash", concurrent_hash)
        with ThreadPoolExecutor(2) as pool:
            futures = [
                pool.submit(register, a),
                pool.submit(register, b, login_id="TEACHER"),
            ]
            results = [future.result() for future in futures]
        assert sorted(result.status_code for result in results) == [201, 409]
        assert (
            next(r for r in results if r.status_code == 409).json()["error"]["code"]
            == "LOGIN_ID_TAKEN"
        )
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM members WHERE login_id_key='teacher'"
                ).fetchone()[0]
                == 1
            )
            assert (
                db.execute(
                    "SELECT count(*) FROM sessions WHERE member_id IS NOT NULL"
                ).fetchone()[0]
                == 0
            )
            assert (
                db.execute(
                    "SELECT count(*) FROM auth_transitions WHERE state IN ('admitted','executing')"
                ).fetchone()[0]
                == 0
            )


def test_final_registration_rechecks_session_after_hash(member_app, monkeypatch):
    app, path = member_app()
    started, release = Event(), Event()
    real_hash = HASHER.hash

    def delayed(password):
        started.set()
        assert release.wait(5)
        return real_hash(password)

    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        monkeypatch.setattr(HASHER, "hash", delayed)
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(register, browser)
            assert started.wait(5)
            with sqlite3.connect(path) as db:
                db.execute(
                    "UPDATE sessions SET revoked_at=? WHERE flow_id=?",
                    (now(), browser.flow),
                )
            release.set()
            result = future.result()
        assert result.status_code == 401
        assert result.json()["error"]["code"] == "AUTH_REQUIRED"
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM members WHERE login_id_key='teacher'"
                ).fetchone()[0]
                == 0
            )


def test_rolling_registration_limit_serializes_last_slot_and_excludes_unproven_calls(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as one, TestClient(app) as two:
        a, b = Browser(one).prepare().anonymous(), Browser(two).prepare().anonymous()
        headers = a.session_headers() | {
            "X-EduVibe-Auth-Revision": a.revision,
            "X-CSRF-Token": "wrong",
        }
        assert (
            one.post(f"{API}/register", json={}, headers=headers).json()["error"][
                "code"
            ]
            == "CSRF_INVALID"
        )
        stamp = now()
        with sqlite3.connect(path) as db:
            db.executemany(
                "INSERT INTO rate_limit_events(purpose,subject_hash,occurred_at,expires_at) VALUES ('register',?,?,?)",
                [(digest("testclient"), stamp, after(stamp, 3600))] * 99,
            )
        with ThreadPoolExecutor(2) as pool:
            results = list(
                pool.map(lambda browser: register(browser, password="short"), [a, b])
            )
        assert sorted(r.status_code for r in results) == [422, 429]
        assert {r.json()["error"]["code"] for r in results} == {
            "VALIDATION_ERROR",
            "RATE_LIMITED",
        }
        blocked = register(a)
        assert blocked.status_code == 429
        assert "retry_at" in blocked.json()["error"]
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM rate_limit_events WHERE purpose='register'"
                ).fetchone()[0]
                == 100
            )
            # An event older than one hour no longer occupies a rolling slot.
            db.execute(
                "UPDATE rate_limit_events SET occurred_at=?,expires_at=? WHERE purpose='register'",
                (after(now(), -3601), after(now(), -1)),
            )
        assert register(a).status_code == 201


@pytest.mark.parametrize("kind", ["full", "change_only"])
def test_authenticated_busy_and_oversized_registration_never_leave_partial_member(
    member_app,
    kind,
):
    app, path = member_app()
    if kind == "change_only":
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET must_change_password=1,temporary_password_expires_at=? WHERE login_id='member-a'",
                (after(now(), 86400),),
            )
    with TestClient(app) as client:
        browser = signed_in(client)
        assert browser.me().json()["session_kind"] == kind
        assert register(browser).json()["error"]["code"] == "ALREADY_AUTHENTICATED"
        browser.logout()
        # Separate anonymous profile; full S must not be used to mint a new flow.
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        app.state.hash_gate = HashGate(running=1, waiting=0)
        with app.state.hash_gate:
            busy = register(browser)
        assert busy.status_code == 503
        assert busy.json()["error"]["code"] == "AUTH_BUSY"
        assert busy.headers["retry-after"] == "1"
        oversized = register(browser, password="x" * 17000)
        assert oversized.status_code == 413
        assert oversized.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT count(*) FROM members WHERE login_id_key='teacher'"
                ).fetchone()[0]
                == 0
            )


def test_login_distinguishes_initial_deadline_revocation_and_expired_deleted_member(
    member_app, monkeypatch
):
    from datetime import UTC

    from app import auth_boundary
    from tests.support import AUTH_MEMBERS

    app, path = member_app()
    fixed = datetime(2026, 10, 2, tzinfo=UTC)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed

    monkeypatch.setattr(auth_boundary, "datetime", Clock)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE members SET created_at='2026-10-01T20:00:00.000000Z' WHERE id=?",
            (AUTH_MEMBERS["pending"][0],),
        )
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        pending = browser.login("pending-user")
        assert pending.status_code == 403
        assert "90일" in pending.json()["error"]["message"]
        assert pending.json()["error"]["message"] == (
            "승인 대기 중인 계정입니다. 최초 승인 대기는 가입일부터 90일이며 "
            "2026년 12월 31일 오전 5:00 (KST)에 만료됩니다. 관리자 승인 후 로그인해 주세요."
        )
        revoked = browser.login("revoked-user")
        assert revoked.status_code == 403
        assert "승인이 해제" in revoked.json()["error"]["message"]
        assert "90일" not in revoked.json()["error"]["message"]
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET created_at='2026-07-04T00:00:00.000000Z' WHERE id=?",
                (AUTH_MEMBERS["pending"][0],),
            )
        expired = browser.login("pending-user")
        assert expired.status_code == 401
        assert expired.json()["error"]["code"] == "INVALID_CREDENTIALS"
        state = browser.state()
        assert state["pending_transition"] is None
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT state,failure_code FROM auth_transitions WHERE flow_id=? ORDER BY rowid DESC LIMIT 1",
                (browser.flow,),
            ).fetchone() == ("failed", "INVALID_CREDENTIALS")
