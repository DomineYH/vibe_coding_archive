"""One browser profile driving the real auth HTTP sequence (permit → execute)."""

from tests.support import AUTH_MEMBERS, AUTH_PASSWORD

ORIGIN = {"Origin": "http://localhost:5174"}
API = "/api/v1/auth"


class Browser:
    def __init__(self, client):
        self.client = client
        self.flow = None
        self.recovery_csrf = None
        self.csrf = None
        self.generation = None
        self.revision = None

    def recovery_headers(self):
        return {
            **ORIGIN,
            "X-CSRF-Token": self.recovery_csrf,
            "X-EduVibe-Flow-Id": self.flow,
        }

    def state(self, **params):
        return self.client.get(
            f"{API}/flow-state",
            params=params,
            headers={"X-EduVibe-Flow-Id": self.flow},
        ).json()

    def prepare(self):
        created = self.client.post(
            f"{API}/flows", json={"restart_from": []}, headers=ORIGIN
        )
        assert created.status_code == 201
        self.flow = created.json()["flow_id"]
        recovery = self.client.post(
            f"{API}/flows/{self.flow}/recovery-cookie", headers=ORIGIN
        ).json()
        self.recovery_csrf = recovery["recovery_csrf_token"]
        ready = self.client.post(
            f"{API}/flows/{self.flow}/ready",
            json={"expected_revision": recovery["revision"]},
            headers=self.recovery_headers(),
        )
        assert ready.status_code == 200
        return self

    def anonymous(self):
        state = self.state()
        permit = self.client.post(
            f"{API}/transitions",
            json={
                "flow_id": self.flow,
                "transition_id": state["next_transition_id"],
                "kind": "anonymous_session",
                "expected_revision": state["revision"],
                "expected_session_generation": None,
            },
            headers=self.recovery_headers(),
        ).json()
        result = self.client.post(
            f"{API}/anonymous-session",
            json={"expected_revision": permit["revision"]},
            headers={
                **self.recovery_headers(),
                "X-EduVibe-Auth-Revision": permit["revision"],
                "X-EduVibe-Transition-Id": permit["transition_id"],
            },
        )
        assert result.status_code == 201
        self.csrf = result.json()["csrf_token"]
        self.generation = result.json()["session_generation"]
        self.revision = result.json()["revision"]
        return self

    def session_headers(self, permit=None):
        headers = {
            **ORIGIN,
            "X-CSRF-Token": self.csrf,
            "X-EduVibe-Flow-Id": self.flow,
            "X-EduVibe-Session-Generation": self.generation,
        }
        if permit:
            headers["X-EduVibe-Auth-Revision"] = permit["revision"]
            headers["X-EduVibe-Transition-Id"] = permit["transition_id"]
        return headers

    def admit(self, kind):
        state = self.state()
        result = self.client.post(
            f"{API}/transitions",
            json={
                "flow_id": self.flow,
                "transition_id": state["next_transition_id"],
                "kind": kind,
                "expected_revision": state["revision"],
                "expected_session_generation": self.generation,
            },
            headers=self.session_headers(),
        )
        if result.status_code == 201:
            self.revision = result.json()["revision"]
        return result

    def login(self, login_id, password=AUTH_PASSWORD, **extra):
        permit = self.admit("login")
        assert permit.status_code == 201, permit.text
        return self.execute_login(permit.json(), login_id, password, **extra)

    def execute_login(self, permit, login_id, password=AUTH_PASSWORD, **extra):
        result = self.client.post(
            f"{API}/login",
            json={"login_id": login_id, "password": password},
            headers=self.session_headers(permit),
            **extra,
        )
        if result.status_code == 200:
            self.csrf = result.json()["csrf_token"]
            self.generation = result.headers["X-EduVibe-Session-Generation"]
            self.revision = result.headers["X-EduVibe-Auth-Revision"]
        return result

    def me(self):
        return self.client.get(
            f"{API}/me",
            headers={
                "X-EduVibe-Flow-Id": self.flow,
                "X-EduVibe-Auth-Revision": self.revision,
                "X-EduVibe-Session-Generation": self.generation,
            },
        )

    def logout(self):
        permit = self.admit("logout")
        assert permit.status_code == 201, permit.text
        return self.client.post(
            f"{API}/logout", headers=self.session_headers(permit.json())
        )


def signed_in(client, name="approved"):
    browser = Browser(client).prepare().anonymous()
    result = browser.login(AUTH_MEMBERS[name][1])
    assert result.status_code == 200, result.text
    return browser
