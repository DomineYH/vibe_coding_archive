from fastapi.testclient import TestClient

ORIGIN = {"Origin": "http://localhost:5174"}


def test_prepare_requires_recovery_receipt_before_admission(make_test_app, tmp_path):
    app = make_test_app(tmp_path / "auth.sqlite3", auth_testing=True)
    with TestClient(app) as client:
        created = client.post(
            "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
        )
        assert created.status_code == 201
        assert "set-cookie" not in created.headers
        flow = created.json()["flow_id"]
        issued = client.post(
            f"/api/v1/auth/flows/{flow}/recovery-cookie", headers=ORIGIN
        )
        assert issued.status_code == 201
        csrf = issued.json()["recovery_csrf_token"]
        headers = {**ORIGIN, "X-CSRF-Token": csrf, "X-EduVibe-Flow-Id": flow}
        state = client.get("/api/v1/auth/flow-state", headers=headers).json()
        assert not state["recovery_ready"]
        assert state["next_transition_id"] is None
        ready = client.post(
            f"/api/v1/auth/flows/{flow}/ready",
            json={"expected_revision": state["revision"]},
            headers=headers,
        )
        assert ready.status_code == 200
        state = client.get("/api/v1/auth/flow-state", headers=headers).json()
        permit = client.post(
            "/api/v1/auth/transitions",
            json={
                "flow_id": flow,
                "transition_id": state["next_transition_id"],
                "kind": "anonymous_session",
                "expected_revision": state["revision"],
                "expected_session_generation": None,
            },
            headers=headers,
        )
        assert permit.status_code == 201


def prepare(client):
    created = client.post(
        "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
    )
    assert created.status_code == 201
    flow = created.json()["flow_id"]
    recovery = client.post(
        f"/api/v1/auth/flows/{flow}/recovery-cookie", headers=ORIGIN
    ).json()
    headers = {
        **ORIGIN,
        "X-CSRF-Token": recovery["recovery_csrf_token"],
        "X-EduVibe-Flow-Id": flow,
    }
    assert (
        client.post(
            f"/api/v1/auth/flows/{flow}/ready",
            json={"expected_revision": recovery["revision"]},
            headers=headers,
        ).status_code
        == 200
    )
    return flow, headers


def admission(client, flow, headers):
    state = client.get("/api/v1/auth/flow-state", headers=headers).json()
    result = client.post(
        "/api/v1/auth/transitions",
        json={
            "flow_id": flow,
            "transition_id": state["next_transition_id"],
            "kind": "anonymous_session",
            "expected_revision": state["revision"],
            "expected_session_generation": None,
        },
        headers=headers,
    )
    assert result.status_code == 201
    return result.json()


def test_anonymous_cookie_receipt_csrf_and_gets_do_not_extend_lifetime(
    make_test_app, tmp_path
):
    with TestClient(
        make_test_app(tmp_path / "auth.sqlite3", auth_testing=True)
    ) as client:
        flow, headers = prepare(client)
        permit = admission(client, flow, headers)
        execution = {
            **headers,
            "X-EduVibe-Auth-Revision": permit["revision"],
            "X-EduVibe-Transition-Id": permit["transition_id"],
        }
        result = client.post(
            "/api/v1/auth/anonymous-session",
            json={"expected_revision": permit["revision"]},
            headers=execution,
        )
        assert result.status_code == 201
        assert "HttpOnly" in result.headers["set-cookie"]
        assert "SameSite=lax" in result.headers["set-cookie"]
        assert "Max-Age" not in result.headers["set-cookie"]
        import base64
        import hashlib
        import sqlite3

        raw_s = next(
            value
            for name, value in client.cookies.items()
            if name.startswith("eduvibe_session_")
        )
        raw_r = next(
            value
            for name, value in client.cookies.items()
            if name.startswith("eduvibe_recovery_")
        )
        assert raw_s != raw_r
        assert len(base64.urlsafe_b64decode(raw_s + "=")) == 32
        assert len(base64.urlsafe_b64decode(raw_r + "=")) == 32
        with sqlite3.connect(tmp_path / "auth.sqlite3") as db:
            assert (
                db.execute("SELECT token_hash FROM sessions").fetchone()[0]
                == hashlib.sha256(raw_s.encode()).hexdigest()
            )
            assert (
                db.execute("SELECT token_hash FROM recovery_credentials").fetchone()[0]
                == hashlib.sha256(raw_r.encode()).hexdigest()
            )
        state = client.get("/api/v1/auth/flow-state", headers=headers).json()
        assert state["session_cookie_present"]
        assert state["session_generation"] == result.json()["session_generation"]
        csrf = client.get("/api/v1/auth/csrf", headers=headers)
        assert csrf.status_code == 200
        assert csrf.json()["csrf_token"] == result.json()["csrf_token"]
        assert csrf.json()["expires_at"] == result.json()["expires_at"]
        assert csrf.headers["X-EduVibe-Auth-Revision"] == state["revision"]
        assert (
            client.get("/api/v1/auth/flow-state", headers=headers).json()["expires_at"]
            == state["expires_at"]
        )
        assert client.get("/api/v1/auth/csrf", headers=headers).json() == csrf.json()
        assert (
            client.post(
                "/api/v1/auth/anonymous-session",
                json={"expected_revision": permit["revision"]},
                headers=execution,
            ).status_code
            == 409
        )
        client.cookies.clear()
        assert client.get("/api/v1/auth/csrf", headers=headers).status_code == 401
        assert (
            "set-cookie" not in client.get("/api/v1/auth/csrf", headers=headers).headers
        )


def test_normal_restart_cancels_unresolved_permit_and_preserves_ready_proof(
    make_test_app, tmp_path
):
    path = tmp_path / "restart.sqlite3"
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        flow, headers = prepare(client)
        permit = admission(client, flow, headers)
        cookies = dict(client.cookies)
        previous = client.get("/api/v1/auth/flow-state", headers=headers).json()
    with TestClient(make_test_app(path, auth_testing=True)) as restarted:
        restarted.cookies.update(cookies)
        state = restarted.get(
            "/api/v1/auth/flow-state",
            params={"transition_id": permit["transition_id"]},
            headers=headers,
        ).json()
        assert state["pending_transition"] is None
        assert state["requested_transition"]["state"] == "cancelled"
        assert state["expires_at"] == previous["expires_at"]
        assert state["recovery_ready"]


def test_no_session_logout_is_origin_only_and_not_a_settlement(make_test_app, tmp_path):
    with TestClient(
        make_test_app(tmp_path / "logout.sqlite3", auth_testing=True)
    ) as client:
        flow, headers = prepare(client)
        permit = admission(client, flow, headers)
        assert client.post("/api/v1/auth/logout", headers=ORIGIN).status_code == 204
        state = client.get("/api/v1/auth/flow-state", headers=headers).json()
        assert state["pending_transition"]["transition_id"] == permit["transition_id"]
        assert client.post("/api/v1/auth/logout").status_code == 403


from datetime import UTC, datetime, timedelta

import pytest


@pytest.fixture
def auth_client(make_test_app, tmp_path):
    with TestClient(
        make_test_app(tmp_path / "boundary.sqlite3", auth_testing=True)
    ) as client:
        yield client


@pytest.fixture
def server_clock(monkeypatch):
    value = [datetime(2026, 10, 1, tzinfo=UTC)]

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return value[0]

    monkeypatch.setattr("app.auth_boundary.datetime", Clock)
    return value


def issue_anonymous(client, flow, headers):
    permit = admission(client, flow, headers)
    execution = {
        **headers,
        "X-EduVibe-Auth-Revision": permit["revision"],
        "X-EduVibe-Transition-Id": permit["transition_id"],
    }
    result = client.post(
        "/api/v1/auth/anonymous-session",
        json={"expected_revision": permit["revision"]},
        headers=execution,
    )
    assert result.status_code == 201
    return result.json(), permit


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "null"},
        {"Origin": "https://other.test"},
        {"Referer": "http://localhost:5174.evil.test/"},
        {"Referer": "http://[broken"},
    ],
)
def test_origin_rejects_unproved_or_malformed_source(auth_client, headers):
    assert (
        auth_client.post(
            "/api/v1/auth/flows", json={"restart_from": []}, headers=headers
        ).status_code
        == 403
    )


def test_exact_referer_is_only_a_fallback_and_csrf_exceptions_are_limited(auth_client):
    result = auth_client.post(
        "/api/v1/auth/flows",
        json={"restart_from": []},
        headers={"Referer": "http://localhost:5174/auth"},
    )
    assert result.status_code == 201
    flow = result.json()["flow_id"]
    assert (
        auth_client.post(
            f"/api/v1/auth/flows/{flow}/ready",
            json={"expected_revision": "0"},
            headers=ORIGIN,
        ).status_code
        == 401
    )
    issued = auth_client.post(
        f"/api/v1/auth/flows/{flow}/recovery-cookie", headers=ORIGIN
    ).json()
    assert (
        auth_client.post(
            f"/api/v1/auth/flows/{flow}/ready",
            json={"expected_revision": issued["revision"]},
            headers=ORIGIN,
        ).status_code
        == 403
    )
    assert (
        auth_client.post(
            "/api/v1/auth/flows",
            json={"restart_from": []},
            headers={
                **ORIGIN,
                "Origin": "null",
                "Referer": "http://localhost:5174/auth",
            },
        ).status_code
        == 403
    )
    assert (
        auth_client.post(
            f"/api/v1/auth/flows/{flow}/abandon", headers=ORIGIN
        ).status_code
        == 200
    )


def test_ready_receipt_and_never_ready_abandon_are_atomic(auth_client):
    flow, headers = prepare(auth_client)
    assert (
        auth_client.post(
            f"/api/v1/auth/flows/{flow}/abandon", headers=ORIGIN
        ).status_code
        == 409
    )
    assert (
        auth_client.post(
            f"/api/v1/auth/flows/{flow}/recovery-cookie", headers=ORIGIN
        ).status_code
        == 409
    )
    assert (
        auth_client.post(
            "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
        ).status_code
        == 409
    )
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    permit = admission(auth_client, flow, headers)
    assert (
        auth_client.post(
            "/api/v1/auth/transitions",
            json={
                "flow_id": flow,
                "transition_id": permit["transition_id"],
                "kind": "anonymous_session",
                "expected_revision": permit["revision"],
                "expected_session_generation": None,
            },
            headers=headers,
        ).json()["error"]["code"]
        == "AUTH_TRANSITION_PENDING"
    )
    settled = auth_client.post(
        f"/api/v1/auth/transitions/{permit['transition_id']}/settle",
        json={"flow_id": flow, "expected_revision": permit["revision"]},
        headers=headers,
    )
    assert settled.json()["result"]["state"] == "cancelled"
    assert (
        auth_client.post(
            "/api/v1/auth/anonymous-session",
            json={"expected_revision": permit["revision"]},
            headers={**headers, "X-EduVibe-Transition-Id": permit["transition_id"]},
        ).status_code
        == 409
    )
    assert state["recovery_ready"]


def test_settle_before_admission_fences_unknown_and_unavailable_is_not_failure(
    auth_client,
):
    flow, headers = prepare(auth_client)
    before = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    transition = before["next_transition_id"]
    queried = auth_client.get(
        "/api/v1/auth/flow-state", params={"transition_id": transition}, headers=headers
    ).json()["requested_transition"]
    assert queried["availability"] == "unavailable" and not queried["execution_blocked"]
    settled = auth_client.post(
        f"/api/v1/auth/transitions/{transition}/settle",
        json={"flow_id": flow, "expected_revision": before["revision"]},
        headers=headers,
    ).json()
    assert settled["result"]["availability"] == "unavailable"
    assert settled["result"]["execution_blocked"]
    assert settled["result"]["state"] is None
    late = auth_client.post(
        "/api/v1/auth/transitions",
        json={
            "flow_id": flow,
            "transition_id": transition,
            "kind": "anonymous_session",
            "expected_revision": before["revision"],
            "expected_session_generation": None,
        },
        headers=headers,
    )
    assert late.status_code == 409


def test_missing_result_session_discard_never_targets_a_newer_generation(auth_client):
    flow, headers = prepare(auth_client)
    result, permit = issue_anonymous(auth_client, flow, headers)
    name = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_session_")
    )
    auth_client.cookies.delete(name)
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    assert not state["session_cookie_present"] and state["next_transition_id"] is None
    discard = auth_client.post(
        f"/api/v1/auth/transitions/{permit['transition_id']}/discard-session",
        json={
            "flow_id": flow,
            "expected_revision": state["revision"],
            "expected_session_generation": result["session_generation"],
        },
        headers=headers,
    )
    assert discard.status_code == 200
    newer, _ = issue_anonymous(auth_client, flow, headers)
    assert newer["session_generation"] != result["session_generation"]
    repeated = auth_client.post(
        f"/api/v1/auth/transitions/{permit['transition_id']}/discard-session",
        json={
            "flow_id": flow,
            "expected_revision": newer["revision"],
            "expected_session_generation": result["session_generation"],
        },
        headers=headers,
    )
    assert repeated.status_code == 200
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    assert (
        state["session_cookie_present"]
        and state["session_generation"] == newer["session_generation"]
    )


def test_session_proof_rotates_lost_r_without_extending_s_and_old_r_cannot_fallback(
    auth_client,
):
    flow, headers = prepare(auth_client)
    result, _ = issue_anonymous(auth_client, flow, headers)
    old_r = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_recovery_")
    )
    old_value = auth_client.cookies[old_r]
    auth_client.cookies.delete(old_r)
    rotated = auth_client.post(
        f"/api/v1/auth/flows/{flow}/recovery-cookie/rotate",
        json={
            "expected_revision": result["revision"],
            "expected_session_generation": result["session_generation"],
        },
        headers={**ORIGIN, "X-CSRF-Token": result["csrf_token"]},
    )
    assert rotated.status_code == 201
    assert (
        auth_client.get("/api/v1/auth/csrf", headers=headers).json()["expires_at"]
        == result["expires_at"]
    )
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    assert not state["recovery_ready"]
    assert (
        auth_client.post(
            f"/api/v1/auth/flows/{flow}/abandon", headers=ORIGIN
        ).status_code
        == 409
    )
    new_r = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_recovery_")
    )
    assert new_r != old_r
    auth_client.cookies.delete(new_r)
    auth_client.cookies.set(old_r, old_value)
    assert (
        auth_client.get("/api/v1/auth/flow-state", headers=headers).status_code == 401
    )


def test_permit_and_anonymous_expiry_are_exact_and_gets_preserve_clock(
    auth_client, server_clock
):
    flow, headers = prepare(auth_client)
    permit = admission(auth_client, flow, headers)
    server_clock[0] += timedelta(seconds=60)
    assert (
        auth_client.post(
            "/api/v1/auth/anonymous-session",
            json={"expected_revision": permit["revision"]},
            headers={**headers, "X-EduVibe-Transition-Id": permit["transition_id"]},
        ).status_code
        == 409
    )
    settled = auth_client.post(
        f"/api/v1/auth/transitions/{permit['transition_id']}/settle",
        json={"flow_id": flow, "expected_revision": permit["revision"]},
        headers=headers,
    ).json()
    assert settled["result"]["state"] == "expired"
    result, permit = issue_anonymous(auth_client, flow, headers)
    server_clock[0] += timedelta(seconds=899)
    assert auth_client.get("/api/v1/auth/csrf", headers=headers).status_code == 200
    server_clock[0] += timedelta(seconds=1)
    assert auth_client.get("/api/v1/auth/csrf", headers=headers).status_code == 401
    server_clock[0] += timedelta(seconds=901)
    recovery = auth_client.get(f"/api/v1/auth/flows/{flow}/recovery-csrf")
    assert recovery.status_code == 401
    assert recovery.json()["error"]["code"] == "RECOVERY_REQUIRED"
    assert auth_client.get(f"/api/v1/auth/flows/{flow}/restart-eligibility").json() == {
        "restart_eligible": True
    }
    assert result["expires_at"]


def test_cookie_budget_counts_unknown_names_and_does_not_delete_them(auth_client):
    for seq in range(8):
        auth_client.cookies.set(
            f"eduvibe_session_dev_00000000-0000-4000-8000-000000000115_{seq}", "unknown"
        )
    created = auth_client.post(
        "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
    ).json()
    result = auth_client.post(
        f"/api/v1/auth/flows/{created['flow_id']}/recovery-cookie", headers=ORIGIN
    )
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "AUTH_COOKIE_BUDGET_EXCEEDED"
    assert "set-cookie" not in result.headers


def test_prepare_ip_limit_is_rolling_and_survives_restarts(
    make_test_app, tmp_path, server_clock
):
    path = tmp_path / "limits.sqlite3"
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        for _ in range(200):
            assert (
                client.post(
                    "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
                ).status_code
                == 201
            )
        limited = client.post(
            "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
        )
        assert limited.status_code == 429
        assert limited.json()["error"]["retry_at"] == "2026-10-01T00:15:00.000000Z"
        assert limited.json()["error"]["server_time"] == "2026-10-01T00:00:00.000000Z"
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        assert (
            client.post(
                "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
            ).status_code
            == 429
        )
        server_clock[0] += timedelta(seconds=900)
        assert (
            client.post(
                "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
            ).status_code
            == 201
        )


def test_auth_body_size_is_bounded_before_parse_or_persistence(auth_client):
    result = auth_client.post(
        "/api/v1/auth/flows",
        content=b" " * 16385,
        headers={**ORIGIN, "Content-Type": "application/json"},
    )
    assert result.status_code == 413
    assert result.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_retired_ids_cannot_be_allocated_again_and_late_cookies_are_provably_invalid(
    make_test_app, tmp_path, server_clock, monkeypatch
):
    from uuid import UUID

    path = tmp_path / "retirement.sqlite3"
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        flow, headers = prepare(client)
        issue_anonymous(client, flow, headers)
        cookies = dict(client.cookies)
    server_clock[0] += timedelta(seconds=3601)
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        client.cookies.update(cookies)
        result = client.get("/api/v1/auth/recovery-context")
        assert result.json() == {"items": []}
        assert len(result.headers.get_list("set-cookie")) == 2
        monkeypatch.setattr("app.auth.uuid4", lambda: UUID(flow))
        assert (
            client.post(
                "/api/v1/auth/flows", json={"restart_from": [flow]}, headers=ORIGIN
            ).status_code
            == 503
        )


def test_current_s_never_falls_back_to_old_cookie_or_string_maximum(
    auth_client, server_clock
):
    flow, headers = prepare(auth_client)
    issue_anonymous(auth_client, flow, headers)
    old_name = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_session_")
    )
    old_value = auth_client.cookies[old_name]
    server_clock[0] += timedelta(seconds=900)
    newer, _ = issue_anonymous(auth_client, flow, headers)
    new_name = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_session_")
    )
    assert new_name != old_name
    auth_client.cookies.delete(new_name)
    auth_client.cookies.set(old_name, old_value)
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    assert state["session_generation"] == newer["session_generation"]
    assert not state["session_cookie_present"]
    assert auth_client.get("/api/v1/auth/csrf", headers=headers).status_code == 401


def test_backup_restore_cli_revokes_s_r_flows_and_unresolved_permits(
    make_test_app, tmp_path
):
    import os
    import subprocess
    import sys

    path = tmp_path / "restored.sqlite3"
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        flow, headers = prepare(client)
        issue_anonymous(client, flow, headers)
        cookies = dict(client.cookies)
    result = subprocess.run(
        [sys.executable, "-m", "app.cli", "invalidate-restored-auth"],
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
        },
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert not result.stdout
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        client.cookies.update(cookies)
        assert client.get("/api/v1/auth/flow-state", headers=headers).status_code == 401
        assert client.get("/api/v1/auth/csrf", headers=headers).status_code == 401
        assert client.get(f"/api/v1/auth/flows/{flow}/restart-eligibility").json() == {
            "restart_eligible": True
        }
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/readyz").json() == {"status": "ready"}


def test_auth_reconciliation_failure_is_not_readiness_and_public_reading_survives(
    make_test_app, tmp_path
):
    from sqlalchemy import text

    path = tmp_path / "invalid-state.sqlite3"
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        flow, _ = prepare(client)
        with client.app.state.engine.begin() as db:
            db.execute(
                text("UPDATE auth_flows SET current_recovery_seq='999' WHERE id=:id"),
                {"id": flow},
            )
    with TestClient(make_test_app(path, auth_testing=True)) as client:
        assert client.get("/readyz").json() == {"status": "not_ready"}
        assert client.get("/readyz").status_code == 503
        assert client.get("/healthz").json() == {"status": "ok"}
        assert client.get("/api/v1/meta").json()["capabilities"]["apps_read"]["enabled"]
        assert not client.get("/api/v1/meta").json()["capabilities"]["auth_login"][
            "enabled"
        ]
        assert client.get("/api/v1/apps").status_code == 200
        assert (
            client.post(
                "/api/v1/auth/flows", json={"restart_from": []}, headers=ORIGIN
            ).status_code
            == 503
        )


def test_logout_with_recovery_and_valid_s_is_not_the_no_s_exception(auth_client):
    flow_id, headers = prepare(auth_client)
    issue_anonymous(auth_client, flow_id, headers)
    assert auth_client.post("/api/v1/auth/logout", headers=ORIGIN).status_code == 503


def test_sequences_above_machine_integer_and_concurrent_execution_remain_atomic(
    auth_client,
):
    from concurrent.futures import ThreadPoolExecutor

    from sqlalchemy import text

    flow_id, headers = prepare(auth_client)
    sequence = "9999999999999999999999999999999999999999"
    with auth_client.app.state.session_factory() as db:
        db.execute(
            text("UPDATE auth_flows SET revision=:seq, issued_seq=:seq WHERE id=:id"),
            {"seq": sequence, "id": flow_id},
        )
        db.commit()
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    assert state["revision"] == sequence
    assert state["next_transition_id"] == f"{flow_id}.{sequence}"
    permit = admission(auth_client, flow_id, headers)
    incremented = "1" + "0" * len(sequence)
    assert permit["revision"] == incremented
    execution_headers = {
        **headers,
        "X-EduVibe-Auth-Revision": permit["revision"],
        "X-EduVibe-Transition-Id": permit["transition_id"],
    }

    def execute(_):
        return auth_client.post(
            "/api/v1/auth/anonymous-session",
            json={"expected_revision": permit["revision"]},
            headers=execution_headers,
        )

    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(execute, range(2)))
    assert sorted(result.status_code for result in results) == [201, 409]
    successful = next(result for result in results if result.status_code == 201)
    assert successful.json()["session_generation"] == incremented
    with auth_client.app.state.session_factory() as db:
        assert (
            db.execute(
                text("SELECT count(*) FROM sessions WHERE flow_id=:id"), {"id": flow_id}
            ).scalar_one()
            == 1
        )
        assert (
            db.execute(
                text("SELECT state FROM auth_transitions WHERE transition_id=:id"),
                {"id": permit["transition_id"]},
            ).scalar_one()
            == "succeeded"
        )


def test_cookie_budget_cleanup_requires_observed_reduction_before_issuance(auth_client):
    flow_id, headers = prepare(auth_client)
    issued, _ = issue_anonymous(auth_client, flow_id, headers)
    r_name = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_recovery_")
    )
    s_name = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_session_")
    )
    endpoint = f"/api/v1/auth/flows/{flow_id}/recovery-cookie/rotate"
    s_headers = {**ORIGIN, "X-CSRF-Token": issued["csrf_token"]}
    payload = {
        "expected_revision": issued["revision"],
        "expected_session_generation": issued["session_generation"],
    }
    rotated = auth_client.post(endpoint, json=payload, headers=s_headers)
    assert rotated.status_code == 201
    payload["expected_revision"] = rotated.json()["revision"]
    # A response-loss browser still carries a known revoked R plus five unknown names.
    auth_client.cookies.set(
        r_name, "late-old-token", domain="testserver.local", path="/"
    )
    for index in range(5):
        auth_client.cookies.set(
            f"eduvibe_session_dev_00000000-0000-4000-8000-{index:012d}_1", "unknown"
        )
    result = auth_client.post(endpoint, json=payload, headers=s_headers)
    assert result.status_code == 409
    assert result.json()["error"]["code"] == "AUTH_COOKIE_BUDGET_EXCEEDED"
    assert len(result.headers.get_list("set-cookie")) == 1
    assert result.headers["set-cookie"].startswith(r_name + "=")
    assert s_name in auth_client.cookies
    # The next request observes the browser's deletion before allocating a new name.
    assert (
        auth_client.post(endpoint, json=payload, headers=s_headers).status_code == 201
    )


def test_non_ascii_csrf_is_rejected_instead_of_crashing(auth_client):
    flow_id, headers = prepare(auth_client)
    state = auth_client.get("/api/v1/auth/flow-state", headers=headers).json()
    result = auth_client.post(
        f"/api/v1/auth/flows/{flow_id}/ready",
        json={"expected_revision": state["revision"]},
        headers=[(b"Origin", b"http://localhost:5174"), (b"X-CSRF-Token", b"\xe9")],
    )
    assert result.status_code == 403
    assert result.json()["error"]["code"] == "CSRF_INVALID"


@pytest.mark.parametrize("raw", [b"{", b"\xff"])
def test_malformed_json_is_bad_request_without_echoing_body(auth_client, raw):
    result = auth_client.post(
        "/api/v1/auth/flows",
        content=raw,
        headers={**ORIGIN, "Content-Type": "application/json"},
    )
    assert result.status_code == 400
    assert result.json()["error"]["code"] == "BAD_REQUEST"
    assert result.headers["Cache-Control"] == "no-store"


def test_missing_recovery_is_distinct_from_missing_s(auth_client):
    flow_id, headers = prepare(auth_client)
    issued, _ = issue_anonymous(auth_client, flow_id, headers)
    r_name = next(
        name for name in auth_client.cookies if name.startswith("eduvibe_recovery_")
    )
    auth_client.cookies.delete(r_name)
    result = auth_client.get(f"/api/v1/auth/flows/{flow_id}/recovery-csrf")
    assert result.status_code == 401
    assert result.json()["error"]["code"] == "RECOVERY_REQUIRED"
    assert (
        auth_client.get("/api/v1/auth/csrf", headers=headers).json()["csrf_token"]
        == issued["csrf_token"]
    )
