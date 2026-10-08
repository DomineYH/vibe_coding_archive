"""Synthetic candidate adapter: real HTTP remains APP_ENV=test over temp storage."""

import json
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from app import auth_runtime
from app.health_runtime import build_digest


def fixture_configuration(settings):
    assert settings.app_env == "test"
    return {**auth_runtime.auth_configuration(settings), "app_env": "production"}


def write_fixture(settings, status):
    path = settings.auth_activation_path
    assert settings.app_env == "test" and path.is_relative_to(
        Path(tempfile.gettempdir())
    )
    assert path.parent == settings.database_path.parent
    record = auth_runtime.activation_template(settings)
    record.update(
        configuration=fixture_configuration(settings),
        status="approved" if status == "invalid" else status,
        approved_by="DomineYH",
        approved_at="2026-01-01T00:00:00+00:00",
        issue_144_comment="https://github.com/DomineYH/vibe_coding_archive/issues/144#issuecomment-123",
    )
    if status == "invalid":
        record["build_sha256"] = "0" * 64
    path.write_text(json.dumps(record))
    path.chmod(0o600)


def install_candidate(app, settings):
    assert settings.app_env == "test"
    path = settings.auth_activation_path
    assert path.parent == settings.database_path.parent
    assert path.is_relative_to(Path(os.environ["API_E2E_TEMP_ROOT"]))
    assert path.is_relative_to(Path(tempfile.gettempdir()))
    expected = fixture_configuration(settings)
    digest = build_digest()
    auth_runtime.runtime_enabled = lambda _: auth_runtime.record_enabled(
        path,
        build_sha256=digest,
        release_id=settings.app_release_id,
        configuration=expected,
    )
    original = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(app):
        async with original(app):
            app.state.auth_candidate = True
            app.state.auth_revoked = False
            yield

    app.router.lifespan_context = lifespan
