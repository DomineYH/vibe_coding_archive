"""Controlled child process: real Worker, only AF_UNIX probe I/O (APP_ENV=test)."""

import asyncio
import json
import os
import signal
import socket
import sys
from pathlib import Path

from app.database import make_engine, make_session_factory
from app.health_worker import UncleanShutdown, Worker, WorkerLock, serve, utc_stamp
from app.settings import Settings


async def main():
    database, lock, control = map(Path, sys.argv[1:4])
    mode = sys.argv[4] if len(sys.argv) > 4 else "normal"
    engine = make_engine(database)
    settings = Settings(
        app_env="test",
        database_path=database,
        public_origin="http://localhost:5174",
        health_worker_lock_path=lock,
    )

    async def probe(url, **_):
        # Socket EOF observed by the parent proves this specific probe's I/O
        # ended. Each original probe owns its own real ten-second deadline.
        reader, writer = await asyncio.open_unix_connection(control)
        start = asyncio.get_running_loop().time()
        try:
            writer.write((json.dumps({"pid": os.getpid(), "url": url}) + "\n").encode())
            await writer.drain()
            async with asyncio.timeout_at(start + 10):
                command = await reader.readline()
            if command != b"complete\n":
                raise RuntimeError("Controlled probe did not receive completion")
            return {
                "state": "healthy",
                "http_status": 204,
                "response_ms": 1,
                "error_kind": None,
                "error_stage": None,
                "checked_at": utc_stamp(),
            }
        except TimeoutError:
            return {
                "state": "timeout",
                "http_status": None,
                "response_ms": None,
                "error_kind": "TIMEOUT",
                "error_stage": "overall",
                "checked_at": utc_stamp(),
            }
        finally:
            writer.close()
            await writer.wait_closed()

    if mode == "unclean":
        # Test-only OS resources survive the raised error until production serve
        # takes os._exit(70); there is no activation or outbound network probe.
        retained = []

        async def unclean(self):
            lifetime_lock = WorkerLock(lock)
            lifetime_lock.__enter__()
            connection = socket.socket(socket.AF_UNIX)
            retained.extend((lifetime_lock, connection))
            connection.connect(str(control))
            connection.sendall((json.dumps({"pid": os.getpid()}) + "\n").encode())
            assert connection.recv(100) == b"unclean\n"
            raise UncleanShutdown()

        Worker.run = unclean
        await serve(settings)
        raise AssertionError("Unclean production serve returned")

    worker = Worker(settings, make_session_factory(engine), testing_probe=probe)
    loop = asyncio.get_running_loop()
    loop.add_signal_handler(signal.SIGTERM, worker.stop)
    loop.add_signal_handler(signal.SIGUSR1, worker.disable)
    if mode == "revocation":
        activation = control.parent / "activation.json"
        loop.add_signal_handler(
            signal.SIGUSR2,
            lambda: worker.disable() if not activation.exists() else None,
        )
    try:
        await worker.run()
    finally:
        engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
