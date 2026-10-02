"""Private screen reads through real HTTP and test-owned file SQLite."""

import socket
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event, Thread

import httpx
import pytest
import uvicorn
from sqlalchemy import event

from app.auth_boundary import after
from tests.auth_client import Browser, signed_in
from tests.contracts.test_admin_approval import execute, issue
from tests.support import AUTH_MEMBERS, populate_public_and_private_apps

API = "/api/v1"
PUBLIC = "00000000-0000-4000-8000-000000000002"
PRIVATE = "00000000-0000-4000-8000-000000000003"
MISSING = "00000000-0000-4000-8000-000000000099"


def headers(browser):
    return {
        "X-EduVibe-Flow-Id": browser.flow,
        "X-EduVibe-Auth-Revision": browser.revision,
        "X-EduVibe-Session-Generation": browser.generation,
    }


@pytest.fixture
def access_server(member_app):
    app, path = member_app()
    populate_public_and_private_apps(path)
    with sqlite3.connect(path) as db:
        db.execute(
            "UPDATE apps SET owner_id=? WHERE id IN (?,?)",
            (AUTH_MEMBERS["approved"][0], PRIVATE, PUBLIC),
        )
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        config = uvicorn.Config(app, log_level="error", lifespan="on")
        server = uvicorn.Server(config)
        worker = Thread(target=server.run, kwargs={"sockets": [listener]})
        worker.start()
        try:
            deadline = time.monotonic() + 10
            while not server.started and worker.is_alive():
                assert time.monotonic() < deadline
                time.sleep(0.01)
            assert server.started
            with httpx.Client(
                base_url=f"http://127.0.0.1:{listener.getsockname()[1]}", timeout=10
            ) as client:
                yield app, path, client
        finally:
            server.should_exit = True
            worker.join(10)
            assert not worker.is_alive()


@pytest.mark.parametrize(
    "name", ["anonymous", "approved", "hangul", "admin", "limited"]
)
def test_private_detail_permission_matrix_and_identical_missing(access_server, name):
    _, path, client = access_server
    if name == "limited":
        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE apps SET owner_id=? WHERE id=?",
                (AUTH_MEMBERS[name][0], PRIVATE),
            )
            db.execute(
                "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00.000000Z' WHERE id=?",
                (AUTH_MEMBERS[name][0],),
            )
    browser = (
        Browser(client).prepare().anonymous()
        if name == "anonymous"
        else signed_in(client, name)
    )
    context = headers(browser)
    private = client.get(f"{API}/apps/{PRIVATE}", headers=context)
    missing = client.get(f"{API}/apps/{MISSING}", headers=context)
    if name in ("approved", "admin"):
        assert private.status_code == 200
        assert private.json()["item"]["is_public"] is False
        assert private.headers["Cache-Control"] == "private, no-store"
        for key, value in context.items():
            assert private.headers[key] == value
        assert set(private.json()["item"]["owner"]) == {"id", "nickname"}
    else:
        assert private.status_code == missing.status_code == 404
        assert private.json() == missing.json()
        assert private.headers["Cache-Control"] == missing.headers["Cache-Control"]
    # Cookies and forged identity claims do not authorize headerless requests.
    assert client.get(f"{API}/apps/{PRIVATE}").status_code == 404
    assert client.get(f"{API}/apps/{PUBLIC}").status_code == 200
    page = client.get(f"{API}/apps", headers=context).json()
    assert page["pagination"]["total"] == 2
    assert all(item["is_public"] for item in page["items"])
    assert (
        client.get(f"{API}/apps?q=private-app-sentinel", headers=context).json()[
            "pagination"
        ]["total"]
        == 0
    )


@pytest.mark.parametrize(
    "endpoint", ["/meta", "/apps", f"/apps/{PRIVATE}", f"/apps/{MISSING}"]
)
@pytest.mark.parametrize(
    "context",
    [
        {"X-EduVibe-Flow-Id": "00000000-0000-4000-8000-000000000099"},
        {
            "X-EduVibe-Flow-Id": "",
            "X-EduVibe-Auth-Revision": "1",
            "X-EduVibe-Session-Generation": "1",
        },
        {
            "X-EduVibe-Flow-Id": "00000000-0000-4000-8000-000000000099",
            "X-EduVibe-Auth-Revision": "01",
            "X-EduVibe-Session-Generation": "1",
        },
        {
            "X-EduVibe-Flow-Id": "00000000-0000-4000-8000-000000000099",
            "X-EduVibe-Auth-Revision": "1",
            "X-EduVibe-Session-Generation": "-1",
        },
    ],
)
def test_public_read_context_is_all_or_none_and_canonical(
    access_server, endpoint, context
):
    _, _, client = access_server
    result = client.get(f"{API}{endpoint}", headers=context)
    assert result.status_code == 422
    assert result.json()["error"]["code"] == "VALIDATION_ERROR"


def test_detail_rejects_stale_context_and_pending_without_resource_disclosure(
    access_server,
):
    _, _, client = access_server
    browser = signed_in(client)
    for name in ("X-EduVibe-Auth-Revision", "X-EduVibe-Session-Generation"):
        stale = {**headers(browser), name: "999"}
        for app_id in (PUBLIC, PRIVATE, MISSING):
            result = client.get(f"{API}/apps/{app_id}", headers=stale)
            assert result.status_code == 409
            assert result.json()["error"]["code"] == "AUTH_STATE_CHANGED"
    assert browser.admit("logout").status_code == 201
    for app_id in (PUBLIC, PRIVATE, MISSING):
        result = client.get(f"{API}/apps/{app_id}", headers=headers(browser))
        assert result.status_code == 409
        assert result.json()["error"]["code"] == "AUTH_TRANSITION_PENDING"


def test_authorized_screen_activity_extends_idle_without_advancing_revision(
    access_server, monkeypatch
):
    _, path, client = access_server
    browser = signed_in(client)
    with sqlite3.connect(path) as db:
        original, absolute = db.execute(
            "SELECT last_activity_at,absolute_expires_at FROM sessions WHERE flow_id=? AND issued_seq=?",
            (browser.flow, browser.generation),
        ).fetchone()
    stamp = after(original, 600)
    monkeypatch.setattr("app.auth_boundary.now", lambda: stamp)
    result = client.get(f"{API}/apps/{PRIVATE}", headers=headers(browser))
    assert result.status_code == 200
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT last_activity_at,expires_at,absolute_expires_at FROM sessions WHERE flow_id=? AND issued_seq=?",
            (browser.flow, browser.generation),
        ).fetchone() == (stamp, after(stamp, 1800), absolute)
        assert db.execute(
            "SELECT last_activity_at,expires_at,revision FROM auth_flows WHERE id=?",
            (browser.flow,),
        ).fetchone() == (stamp, after(stamp, 1800), browser.revision)
        assert db.execute(
            "SELECT expires_at FROM recovery_credentials WHERE flow_id=? AND revoked_at IS NULL",
            (browser.flow,),
        ).fetchone() == (after(stamp, 1800),)
    # A denied resource, auth observation and public headerless reads are not activity.
    monkeypatch.setattr("app.auth_boundary.now", lambda: after(stamp, 60))
    assert (
        client.get(f"{API}/apps/{MISSING}", headers=headers(browser)).status_code == 404
    )
    assert browser.me().status_code == 200
    assert client.get(f"{API}/apps/{PUBLIC}").status_code == 200
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT last_activity_at FROM auth_flows WHERE id=?", (browser.flow,)
        ).fetchone() == (stamp,)


@pytest.mark.parametrize("boundary", ["idle", "absolute", "flow"])
def test_exact_expiry_cannot_authorize_or_resurrect_private_screen(
    access_server, monkeypatch, boundary
):
    _, path, client = access_server
    browser = signed_in(client)
    with sqlite3.connect(path) as db:
        original = db.execute(
            "SELECT last_activity_at FROM auth_flows WHERE id=?", (browser.flow,)
        ).fetchone()[0]
        expiry = after(original, 10)
        db.execute(
            "UPDATE sessions SET expires_at=?,absolute_expires_at=? WHERE flow_id=? AND issued_seq=?",
            (
                expiry if boundary == "idle" else after(original, 100),
                expiry if boundary == "absolute" else after(original, 200),
                browser.flow,
                browser.generation,
            ),
        )
        db.execute(
            "UPDATE auth_flows SET expires_at=? WHERE id=?",
            (expiry if boundary == "flow" else after(original, 100), browser.flow),
        )
    monkeypatch.setattr("app.auth_boundary.now", lambda: expiry)
    private = client.get(f"{API}/apps/{PRIVATE}", headers=headers(browser))
    missing = client.get(f"{API}/apps/{MISSING}", headers=headers(browser))
    assert private.status_code == missing.status_code == 404
    assert private.json() == missing.json()
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT last_activity_at FROM auth_flows WHERE id=?", (browser.flow,)
        ).fetchone() == (original,)


def test_activity_is_capped_at_original_absolute_expiry(access_server, monkeypatch):
    _, path, client = access_server
    browser = signed_in(client)
    with sqlite3.connect(path) as db:
        stamp = db.execute(
            "SELECT last_activity_at FROM auth_flows WHERE id=?", (browser.flow,)
        ).fetchone()[0]
        absolute = after(stamp, 5)
        db.execute(
            "UPDATE sessions SET absolute_expires_at=? WHERE flow_id=? AND issued_seq=?",
            (absolute, browser.flow, browser.generation),
        )
    monkeypatch.setattr("app.auth_boundary.now", lambda: after(stamp, 1))
    assert (
        client.get(f"{API}/apps/{PRIVATE}", headers=headers(browser)).status_code == 200
    )
    with sqlite3.connect(path) as db:
        assert db.execute(
            "SELECT expires_at,absolute_expires_at FROM sessions WHERE flow_id=? AND issued_seq=?",
            (browser.flow, browser.generation),
        ).fetchone() == (absolute, absolute)
        assert db.execute(
            "SELECT expires_at FROM auth_flows WHERE id=?", (browser.flow,)
        ).fetchone() == (absolute,)


@pytest.mark.parametrize("read_first", [True, False])
def test_private_read_and_revoke_both_commit_orders_and_reapprove(
    access_server, read_first
):
    app, path, client = access_server
    owner = signed_in(client)
    target = AUTH_MEMBERS["approved"][0]
    held, waiting, release = Event(), Event(), Event()

    def hold_first(connection, cursor, statement, parameters, context, many):
        if statement == "BEGIN IMMEDIATE" and held.is_set():
            waiting.set()
        elif not held.is_set() and (
            (read_first and statement.startswith("SELECT * FROM auth_flows WHERE id="))
            or (
                not read_first
                and statement.startswith("UPDATE members SET approval_status=")
            )
        ):
            held.set()
            assert release.wait(5)

    with httpx.Client(base_url=str(client.base_url), timeout=10) as admin_client:
        admin = signed_in(admin_client, "admin")
        key = issue(admin, target, approved=False).json()["key"]

        def read():
            return client.get(f"{API}/apps/{PRIVATE}", headers=headers(owner))

        def revoke():
            return execute(admin, key, target, approved=False)

        event.listen(app.state.engine, "before_cursor_execute", hold_first)
        try:
            with ThreadPoolExecutor(2) as pool:
                first = pool.submit(read if read_first else revoke)
                assert held.wait(5)
                second = pool.submit(revoke if read_first else read)
                assert waiting.wait(5)
                release.set()
                first_result, second_result = first.result(), second.result()
        finally:
            release.set()
            event.remove(app.state.engine, "before_cursor_execute", hold_first)
        result = first_result if read_first else second_result
        assert result.status_code == (200 if read_first else 404)
        assert (second_result if read_first else first_result).status_code == 200
        key = issue(admin, target, version=2).json()["key"]
        assert execute(admin, key, target, version=2).status_code == 200
        assert (
            client.get(f"{API}/apps/{PRIVATE}", headers=headers(owner)).status_code
            == 404
        )
        assert client.get(f"{API}/apps/{PUBLIC}").status_code == 200
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM sessions WHERE member_id=? AND revoked_at IS NULL",
                (target,),
            ).fetchone() == (0,)
