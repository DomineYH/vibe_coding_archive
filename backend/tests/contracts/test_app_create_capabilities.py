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
