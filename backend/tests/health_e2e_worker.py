"""Owned API E2E process: real queue/transport with controlled external I/O."""

import asyncio
import os
import signal

from app.database import make_engine, make_session_factory
from app.health_probe import probe
from app.health_worker import Worker
from app.settings import Settings


class Record:
    def __init__(self, address):
        self.address = address

    def to_text(self):
        return self.address


class Resolver:
    async def resolve(self, host, kind, **kwargs):
        address = (
            "127.0.0.1" if host == "health-blocked.example.test." else "93.184.216.34"
        )
        return [Record(address)] if kind == "A" else []


class Stream:
    def __init__(self):
        self.sent = False

    async def read(self, max_bytes, timeout=None):
        await asyncio.sleep(0.05)
        if self.sent:
            return b""
        self.sent = True
        return b"HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"

    async def write(self, buffer, timeout=None):
        pass

    async def start_tls(self, ssl_context, server_hostname=None, timeout=None):
        return self

    async def aclose(self):
        pass

    def get_extra_info(self, name):
        return None


class Backend:
    async def connect_tcp(self, host, port, **kwargs):
        return Stream()


async def controlled_probe(url, **kwargs):
    # Public destination and TLS policy remain in the production probe;
    # only its DNS/network adapters are replaced by synthetic observations.
    return await probe(url, resolver=Resolver(), network_backend=Backend(), **kwargs)


async def run():
    settings = Settings.from_environment()
    if settings.app_env != "test" or not os.environ.get("API_E2E_TEMP_ROOT"):
        raise RuntimeError("Health browser fixtures require the isolated E2E runner.")
    engine = make_engine(settings.database_path)
    try:
        worker = Worker(
            settings, make_session_factory(engine), testing_probe=controlled_probe
        )
        asyncio.get_running_loop().add_signal_handler(signal.SIGTERM, worker.stop)
        await worker.run()
    finally:
        engine.dispose()


if __name__ == "__main__":
    asyncio.run(run())
