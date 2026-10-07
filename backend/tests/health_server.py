"""Actual API + separate test worker, restricted to the owned browser database."""

import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from sqlalchemy import text

from app.main import create_app
from app.settings import Settings

settings = Settings.from_environment()
if settings.app_env != "test" or not os.environ.get("API_E2E_TEMP_ROOT"):
    raise RuntimeError("Health fixtures require the isolated API E2E runner.")
app = create_app(settings, auth_testing=True, health_testing=True)
original_lifespan = app.router.lifespan_context


@asynccontextmanager
async def lifespan(application):
    async with original_lifespan(application):
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            "tests.health_e2e_worker",
            cwd=Path(__file__).resolve().parents[1],
            env=dict(os.environ),
        )
        try:
            async with asyncio.timeout(60):
                while True:
                    if process.returncode is not None:
                        raise RuntimeError("Controlled health worker failed to start.")
                    with application.state.session_factory() as db:
                        ready = db.execute(
                            text("SELECT ready FROM health_worker")
                        ).scalar()
                    if ready:
                        break
                    await asyncio.sleep(0.05)
            yield
        finally:
            if process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=16)
                except TimeoutError:
                    process.kill()
                    await process.wait()


app.router.lifespan_context = lifespan
