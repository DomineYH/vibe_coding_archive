"""Only the isolated API E2E runner may select this prepared T01 boundary."""

from app.main import create_app
from app.settings import Settings

settings = Settings.from_environment()
if settings.app_env != "test":
    raise RuntimeError(
        "Prepared authentication boundary requires the test environment."
    )
app = create_app(settings, auth_testing=True)
