import os
from datetime import datetime

"""Only the isolated API E2E runner may select this prepared T01 boundary."""

from app.main import create_app
from app.settings import Settings

settings = Settings.from_environment()
if settings.app_env != "test":
    raise RuntimeError(
        "Prepared authentication boundary requires the test environment."
    )
# Only the test runner supplies this clock for independent screen captures.
if fixed := os.environ.get("API_E2E_CLOCK"):
    from app import auth_boundary, main, public_apps

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromisoformat(fixed)

    auth_boundary.datetime = Clock
    main.datetime = Clock
    public_apps.datetime = Clock
app = create_app(settings, auth_testing=True)

# This file is imported only after the APP_ENV=test guard above.
if os.environ.get("API_E2E_CANDIDATE_STATUS"):
    from tests.auth_candidate import install_candidate

    install_candidate(app, settings)
