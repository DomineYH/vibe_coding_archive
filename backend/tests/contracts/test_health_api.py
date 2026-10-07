"""HTTP health boundaries over migrated SQLite and the real auth flow."""

from fastapi.testclient import TestClient
from tests.admin_apps_fixtures import APPROVED_ID, STAMP, app_id, seed_apps


def test_public_snapshot_available_while_checks_disabled_and_private_hidden(member_app):
    app, path = member_app()
    seed_apps(path, [(1, APPROVED_ID, True, STAMP), (2, APPROVED_ID, False, STAMP)])
    with TestClient(app) as client:
        public = client.get(f"/api/v1/apps/{app_id(1)}/health")
        assert public.status_code == 200, public.text
        assert public.json()["health"] == {
            "result": {"state": "unchecked", "checked_at": None, "fresh_until": None},
            "latest_job": None,
            "next_check_at": None,
        }
        for id_ in (app_id(2), app_id(900), "invalid"):
            result = client.get(f"/api/v1/apps/{id_}/health")
            assert result.status_code == 404
            assert result.json()["error"]["code"] == "NOT_FOUND"
        capabilities = client.get("/api/v1/meta").json()["capabilities"]
        assert capabilities["health_read"] == {"enabled": True, "reasons": []}
        assert capabilities["health_check"]["enabled"] is False


def write_headers(browser):
    return {**browser.session_headers(), "X-EduVibe-Auth-Revision": browser.revision}


def test_disabled_post_still_checks_session_csrf_private_access_and_empty_body(
    member_app,
):
    from tests.auth_client import Browser, signed_in

    app, path = member_app()
    seed_apps(path, [(1, APPROVED_ID, True, STAMP), (2, APPROVED_ID, False, STAMP)])
    public_url = f"/api/v1/apps/{app_id(1)}/health-checks"
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        assert (
            client.post(
                public_url, headers={"Origin": "http://localhost:5174"}
            ).status_code
            == 422
        )
        browser = Browser(client).prepare().anonymous()
        headers = write_headers(browser)
        missing_csrf = {
            key: value for key, value in headers.items() if key != "X-CSRF-Token"
        }
        assert client.post(public_url, headers=missing_csrf).status_code == 403
        assert (
            client.post(
                public_url, headers={**headers, "Origin": "https://untrusted.test"}
            ).status_code
            == 403
        )
        hidden = client.post(f"/api/v1/apps/{app_id(2)}/health-checks", headers=headers)
        assert hidden.status_code == 404
        for content in ("{}", "null", " ", '{"url":"http://127.0.0.1"}'):
            assert (
                client.post(public_url, content=content, headers=headers).status_code
                == 422
            )
        unavailable = client.post(public_url, headers=headers)
        assert unavailable.status_code == 503, unavailable.text
        assert unavailable.json()["error"]["reasons"] == ["operational_restriction"]
        client.cookies.clear()
        import sqlite3

        from tests.support import AUTH_MEMBERS

        with sqlite3.connect(path) as db:
            db.execute(
                "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00.000000Z' WHERE id=?",
                (AUTH_MEMBERS["limited"][0],),
            )
        restricted = signed_in(client, "limited")
        result = client.post(public_url, headers=write_headers(restricted))
        assert result.status_code == 403
        assert result.json()["error"]["code"] == "PASSWORD_CHANGE_REQUIRED"


def test_real_queue_admission_job_polling_permissions_and_admin_batch(
    make_test_app, tmp_path
):
    import sqlite3

    from app import health_store
    from app.auth_boundary import now
    from app.health_runtime import boot_clock
    from tests.auth_client import Browser, signed_in
    from tests.support import populate_auth_members

    path = tmp_path / "health-enabled.sqlite3"
    app = make_test_app(path, auth_testing=True, health_testing=True)
    populate_auth_members(path)
    seed_apps(path, [(1, APPROVED_ID, True, STAMP), (2, APPROVED_ID, False, STAMP)])
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        boot_id, mono = boot_clock()
        with app.state.session_factory() as db:
            health_store.heartbeat(
                db, worker_id="api-test-worker", boot_id=boot_id, mono=mono, stamp=now()
            )
            db.commit()
        anonymous = Browser(client).prepare().anonymous()
        check_url = f"/api/v1/apps/{app_id(1)}/health-checks"
        first = client.post(check_url, headers=write_headers(anonymous))
        assert first.status_code == 202, first.text
        accepted = first.json()
        assert accepted["disposition"] == "created"
        job_id = accepted["health"]["latest_job"]["id"]
        again = client.post(check_url, headers=write_headers(anonymous))
        assert again.status_code == 202
        assert again.json()["disposition"] == "active_reused"
        assert again.json()["health"]["latest_job"]["id"] == job_id
        assert (
            client.get(f"/api/v1/health-checks/{job_id}").json()["job"]["status"]
            == "queued"
        )
        card = client.get("/api/v1/apps").json()["items"][0]
        assert card["health"]["latest_job"]["id"] == job_id
        client.cookies.clear()
        owner = signed_in(client, "approved")
        private_url = f"/api/v1/apps/{app_id(2)}/health-checks"
        private = client.post(private_url, headers=write_headers(owner))
        assert private.status_code == 202, private.text
        private_job = private.json()["health"]["latest_job"]["id"]
        assert client.get(f"/api/v1/health-checks/{private_job}").status_code == 404
        with sqlite3.connect(path) as db:
            before = db.execute(
                "SELECT token_hash,last_activity_at,expires_at FROM sessions ORDER BY token_hash"
            ).fetchall()
        owner_read = client.get(
            f"/api/v1/health-checks/{private_job}", headers=write_headers(owner)
        )
        assert owner_read.status_code == 200
        assert set(owner_read.json()["health"]["result"]) == {
            "state",
            "checked_at",
            "fresh_until",
        }
        with sqlite3.connect(path) as db:
            assert (
                db.execute(
                    "SELECT token_hash,last_activity_at,expires_at FROM sessions ORDER BY token_hash"
                ).fetchall()
                == before
            )
        forbidden = client.post(
            "/api/v1/admin/health-check-batches", headers=write_headers(owner)
        )
        assert forbidden.status_code == 403
        owner_cookies = dict(client.cookies)
        client.cookies.clear()
        admin = signed_in(client, "admin")
        batch = client.post(
            "/api/v1/admin/health-check-batches", headers=write_headers(admin)
        )
        assert batch.status_code == 202, batch.text
        batch_id = batch.json()["batch"]["id"]
        assert batch.json()["batch"]["target_count"] == 2
        assert batch.json()["batch"]["counts"]["queued"] == 2
        read = client.get(
            f"/api/v1/apps/{app_id(2)}/health", headers=write_headers(admin)
        )
        assert read.status_code == 200
        assert set(read.json()["health"]["result"]) == {
            "state",
            "checked_at",
            "fresh_until",
            "http_status",
            "response_ms",
            "error_kind",
            "error_stage",
        }
        summary = client.get(
            "/api/v1/admin/users", headers=write_headers(admin)
        ).json()["stats"]
        assert summary["active_health_batch_id"] == batch_id
        progress = client.get(
            f"/api/v1/admin/health-check-batches/{batch_id}",
            headers=write_headers(admin),
        )
        assert progress.status_code == 200
        assert progress.json()["target_count"] == 2
        # Current privacy and approval apply to old job URLs, not only admission.
        with sqlite3.connect(path) as db:
            db.execute("UPDATE apps SET is_public=0 WHERE id=?", (app_id(1),))
            db.execute(
                "UPDATE members SET approval_status='revoked' WHERE id=?",
                (APPROVED_ID,),
            )
        assert client.get(f"/api/v1/health-checks/{job_id}").status_code == 404
        client.cookies.clear()
        client.cookies.update(owner_cookies)
        assert (
            client.get(
                f"/api/v1/health-checks/{private_job}", headers=write_headers(owner)
            ).status_code
            == 404
        )


def test_anonymous_actor_quota_ignores_forwarded_ip_and_worker_gate_precedes_reuse(
    make_test_app, tmp_path
):
    from app import health_store
    from app.auth_boundary import now
    from app.health_runtime import boot_clock
    from tests.auth_client import Browser
    from tests.support import populate_auth_members

    path = tmp_path / "health-limits.sqlite3"
    app = make_test_app(path, auth_testing=True, health_testing=True)
    populate_auth_members(path)
    seed_apps(path, [(1, APPROVED_ID, True, STAMP)])
    with TestClient(app, client=("127.0.0.1", 50000)) as client:
        browser = Browser(client).prepare().anonymous()
        boot_id, mono = boot_clock()
        with app.state.session_factory() as db:
            health_store.heartbeat(
                db, worker_id="quota-worker", boot_id=boot_id, mono=mono, stamp=now()
            )
            db.commit()
        url = f"/api/v1/apps/{app_id(1)}/health-checks"
        for index in range(10):
            accepted = client.post(
                url,
                headers={
                    **write_headers(browser),
                    "X-Forwarded-For": f"203.0.113.{index}",
                },
            )
            assert accepted.status_code == 202, accepted.text
        limited = client.post(url, headers=write_headers(browser))
        assert limited.status_code == 429, limited.text
        assert limited.json()["error"]["reasons"] == ["actor_rate_limit"]
        assert 0 < int(limited.headers["Retry-After"]) <= 60
        assert (
            limited.json()["error"]["retry_at"] > limited.json()["error"]["server_time"]
        )
        with app.state.session_factory() as db:
            boot_id, mono = boot_clock()
            job = health_store.claim(
                db, worker_id="quota-worker", boot_id=boot_id, mono=mono, stamp=now()
            )
            db.commit()
        snapshot_url = f"/api/v1/apps/{app_id(1)}/health"
        assert client.get(snapshot_url).json()["health"]["next_check_at"] is None
        with app.state.session_factory() as db:
            boot_id, mono = boot_clock()
            health_store.finish(
                db,
                job,
                {
                    "state": "healthy",
                    "http_status": 204,
                    "response_ms": 3,
                    "checked_at": now(),
                },
                boot_id=boot_id,
                mono=mono,
                stamp=now(),
            )
            db.commit()
        assert client.get(snapshot_url).json()["health"]["next_check_at"] is not None
        with app.state.session_factory() as db:
            health_store.invalidate(db, "quota-worker", now())
            db.commit()
        unavailable = client.post(url, headers=write_headers(browser))
        assert unavailable.status_code == 503
        assert unavailable.json()["error"]["reasons"] == ["operational_restriction"]
        assert (
            client.get("/api/v1/meta").json()["capabilities"]["health_check"]["enabled"]
            is False
        )
        assert client.get(snapshot_url).json()["health"]["next_check_at"] is None


def test_disabled_restart_cancels_persisted_work_and_keeps_saved_result(
    make_test_app, tmp_path
):
    from app import health_store
    from app.auth_boundary import now
    from tests.support import populate_auth_members

    path = tmp_path / "disabled-restart.sqlite3"
    app = make_test_app(path, auth_testing=True, health_testing=True)
    populate_auth_members(path)
    seed_apps(path, [(1, APPROVED_ID, True, STAMP)])
    with TestClient(app), app.state.session_factory() as db:
        _, accepted = health_store.request_check(db, app_id(1), "fixture", None, now())
        db.commit()
        job_id = accepted["health"]["latest_job"]["id"]
    restarted = make_test_app(path, auth_testing=True)
    with TestClient(restarted) as client:
        result = client.get(f"/api/v1/health-checks/{job_id}")
        assert result.status_code == 200
        assert result.json()["job"]["status"] == "cancelled"
        assert result.json()["job"]["failure_code"] is None
        assert result.json()["health"]["result"]["state"] == "unchecked"
