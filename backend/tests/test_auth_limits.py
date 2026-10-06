import sqlite3
import threading
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.auth_boundary import AuthError
from app.auth_login import HashGate
from tests.auth_client import Browser
from tests.support import AUTH_MEMBERS, AUTH_PASSWORD

APPROVED = AUTH_MEMBERS["approved"][1]
WRONG = "wrong password 12345"


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


@pytest.fixture
def fast_hasher(monkeypatch):
    """Rate-limit tests drive hundreds of attempts; hashing itself is tested elsewhere."""
    from app import auth_login

    monkeypatch.setattr(
        auth_login,
        "argon2_verify",
        lambda hashed, password: password == AUTH_PASSWORD,
    )


def code(result):
    return result.json()["error"]["code"]


def test_account_and_ip_failures_are_a_rolling_ten_per_fifteen_minutes(
    member_app, server_clock, fast_hasher
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        for _ in range(5):
            assert browser.login(APPROVED, WRONG).status_code == 401
        server_clock[0] += timedelta(seconds=600)
        for _ in range(5):
            assert browser.login(APPROVED, WRONG).status_code == 401
        blocked = browser.login(APPROVED, AUTH_PASSWORD)
        assert (blocked.status_code, code(blocked)) == (429, "RATE_LIMITED")
        # The first five failures leave the window at +900s; blocked requests add none.
        assert blocked.json()["error"]["retry_at"] == "2026-10-01T00:15:00.000000Z"
        server_clock[0] += timedelta(seconds=299)
        again = browser.login(APPROVED, AUTH_PASSWORD)
        assert again.json()["error"]["retry_at"] == "2026-10-01T00:15:00.000000Z"
        # Another account from the same address is not blocked by the account window.
        other = browser.login("한글교사", AUTH_PASSWORD)
        assert other.status_code == 200
    with TestClient(app) as second:
        other_browser = Browser(second).prepare().anonymous()
        server_clock[0] += timedelta(seconds=1)
        assert other_browser.login(APPROVED, AUTH_PASSWORD).status_code == 200


def test_blocked_attempts_do_not_extend_the_window_and_it_survives_restart(
    member_app, server_clock, fast_hasher
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        for _ in range(10):
            assert browser.login(APPROVED, WRONG).status_code == 401
        assert code(browser.login(APPROVED, WRONG)) == "RATE_LIMITED"
    with sqlite3.connect(path) as db:
        counted = db.execute(
            "SELECT count(*) FROM rate_limit_events WHERE purpose='login_account'"
        ).fetchone()[0]
    assert counted == 10
    with TestClient(app) as restarted:
        browser = Browser(restarted).prepare().anonymous()
        assert code(browser.login(APPROVED, AUTH_PASSWORD)) == "RATE_LIMITED"
    server_clock[0] += timedelta(seconds=900)
    with TestClient(app) as later:
        fresh = Browser(later).prepare().anonymous()
        assert fresh.login(APPROVED, AUTH_PASSWORD).status_code == 200


def test_address_wide_failures_stop_at_two_hundred_per_window(
    member_app, server_clock, fast_hasher
):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        for index in range(200):
            assert browser.login(f"nobody-{index}", WRONG).status_code == 401
        blocked = browser.login(AUTH_MEMBERS["hangul"][1], AUTH_PASSWORD)
        assert (blocked.status_code, code(blocked)) == (429, "RATE_LIMITED")
    server_clock[0] += timedelta(seconds=900)
    with TestClient(app) as later:
        fresh = Browser(later).prepare().anonymous()
        assert fresh.login(AUTH_MEMBERS["hangul"][1], AUTH_PASSWORD).status_code == 200


def test_hash_gate_runs_two_queues_four_and_rejects_the_rest():
    gate = HashGate(running=2, waiting=4, wait=0.2)
    release, entered, outcomes = threading.Event(), threading.Semaphore(0), []

    def work():
        try:
            with gate:
                entered.release()
                release.wait(5)
            outcomes.append("ran")
        except AuthError as error:
            outcomes.append(error.code)

    threads = [threading.Thread(target=work) for _ in range(8)]
    for thread in threads[:2]:
        thread.start()
    entered.acquire(), entered.acquire()
    for thread in threads[2:6]:
        thread.start()
    # Wait until all four sit in the queue, then the seventh is refused at once.
    while gate.queued < 4:
        pass
    work()
    assert outcomes == ["AUTH_BUSY"]
    for thread in threads[6:]:
        thread.start()
    for thread in threads[2:]:
        thread.join()
    # Queued callers that never got a slot within the wait were refused too.
    assert outcomes.count("AUTH_BUSY") >= 5
    release.set()
    for thread in threads[:2]:
        thread.join()
    assert outcomes.count("ran") == 2


def test_saturated_hashing_is_503_auth_busy_and_keeps_the_permit(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        app.state.hash_gate = HashGate(running=1, waiting=0)
        app.state.hash_gate.slots.acquire()
        permit = browser.admit("login").json()
        busy = browser.execute_login(permit, APPROVED)
        assert (busy.status_code, code(busy)) == (503, "AUTH_BUSY")
        assert busy.headers["Retry-After"] == "1"
        assert "set-cookie" not in busy.headers
        app.state.hash_gate.slots.release()
        assert browser.execute_login(permit, APPROVED).status_code == 200


def test_a_locked_database_is_a_controlled_db_busy_after_the_five_second_cap(
    member_app,
):
    app, path = member_app()
    with TestClient(app) as client:
        browser = Browser(client).prepare().anonymous()
        permit = browser.admit("login").json()
        blocker = sqlite3.connect(path, isolation_level=None)
        blocker.execute("BEGIN IMMEDIATE")
        try:
            busy = browser.execute_login(permit, APPROVED)
        finally:
            blocker.execute("ROLLBACK")
            blocker.close()
        assert (busy.status_code, code(busy)) == (503, "DB_BUSY")
        assert browser.execute_login(permit, APPROVED).status_code == 200


def test_shared_ip_limit_includes_reauth_and_survives_rolling_restart(
    member_app, server_clock, fast_hasher
):
    from tests.auth_client import signed_in
    from tests.contracts.test_auth_reauth import ADMIN, reauth

    app, path = member_app()
    with TestClient(app) as client, TestClient(app) as other:
        admin = signed_in(client, "admin")
        anonymous = Browser(other).prepare().anonymous()
        for index in range(190):
            assert anonymous.login(f"nobody-{index}", WRONG).status_code == 401
        for _ in range(10):
            assert reauth(admin, WRONG).status_code == 401
        blocked = anonymous.login(AUTH_MEMBERS["hangul"][1])
        assert blocked.status_code == 429
        assert blocked.json()["error"]["retry_at"] == "2026-10-01T00:15:00.000000Z"
        assert reauth(admin).status_code == 429
        cookies = dict(client.cookies)
    with TestClient(app) as restarted:
        restarted.cookies.update(cookies)
        admin.client = restarted
        assert reauth(admin).status_code == 429
        server_clock[0] += timedelta(seconds=900)
        assert reauth(admin).status_code == 200
        with sqlite3.connect(path) as db:
            assert db.execute(
                "SELECT count(*) FROM rate_limit_events WHERE purpose='login_ip'"
            ).fetchone() == (200,)
        # Success does not delete even the now-expired persisted failure events.
        assert admin.me().json()["login_id"] == ADMIN
