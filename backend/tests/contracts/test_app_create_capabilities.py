import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.app_create_client import API, INPUT, error


def test_prepared_and_unready_app_create_capability(member_app):
    app, _ = member_app()
    with TestClient(app) as client:
        assert client.get(f"{API}/meta").json()["capabilities"]["apps_create"] == {
            "enabled": True,
            "reasons": [],
        }
        app.state.auth_ready = False
        assert (
            client.get(f"{API}/meta").json()["capabilities"]["apps_create"]["enabled"]
            is False
        )
        for url, body in (
            ("/apps", INPUT),
            ("/write-operations", {"kind": "app_create", "input": INPUT}),
        ):
            error(client.post(f"{API}{url}", json=body), 503, "FEATURE_UNAVAILABLE")


@pytest.mark.parametrize("environment", ["test", "production", "development"])
def test_environment_capability_gate(member_app, environment):
    prepared, _ = member_app()
    with TestClient(prepared):
        settings = prepared.state.settings.model_copy(update={"app_env": environment})
    app = create_app(settings)
    with TestClient(app) as client:
        assert client.get(f"{API}/meta").json()["capabilities"]["apps_create"][
            "enabled"
        ] is (environment == "development")


def test_edit_capability_has_exactly_the_create_readiness_boundary(
    member_app, make_test_app, tmp_path
):
    prepared, _ = member_app()
    with TestClient(prepared) as client:
        capabilities = client.get(f"{API}/meta").json()["capabilities"]
        assert (
            capabilities["apps_update_own"]
            == capabilities["apps_create"]
            == {"enabled": True, "reasons": []}
        )
        assert not capabilities["apps_delete_own"]["enabled"]
        assert not capabilities["admin_apps_manage"]["enabled"]
    for environment in ("development", "production", "test"):
        settings = prepared.state.settings.model_copy(update={"app_env": environment})
        with TestClient(create_app(settings)) as client:
            capabilities = client.get(f"{API}/meta").json()["capabilities"]
            assert (
                capabilities["apps_update_own"]["enabled"]
                is capabilities["apps_create"]["enabled"]
            )
    with TestClient(make_test_app(tmp_path / "unprepared.sqlite3")) as client:
        assert not client.get(f"{API}/meta").json()["capabilities"]["apps_update_own"][
            "enabled"
        ]
