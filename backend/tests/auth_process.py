"""A real socket server over an isolated DB; restart never seeds or migrates."""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parents[1]


class AuthProcess:
    def __init__(self, database, blocklist):
        if not database.is_absolute() or not str(database).startswith("/tmp/"):
            raise ValueError("Process drills require an absolute temporary database.")
        self.directory = tempfile.TemporaryDirectory(prefix="auth-process-")
        self.control_path = Path(self.directory.name) / "control.sock"
        with socket.socket() as reservation:
            reservation.bind(("127.0.0.1", 0))
            self.port = reservation.getsockname()[1]
        self.env = {
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database),
            "PASSWORD_BLOCKLIST_PATH": str(blocklist),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "AUTH_FAULT_CONTROL": str(self.control_path),
        }
        self.process = None

    def start(self):
        self.control_path.unlink(missing_ok=True)
        self.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "tests.auth_fault_server:app",
                "--host",
                "127.0.0.1",
                "--port",
                str(self.port),
                "--no-access-log",
            ],
            cwd=BACKEND,
            env=self.env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 10
        with self.client() as probe:
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError("Private auth process failed to start.")
                try:
                    if probe.get("/healthz").status_code == 200:
                        return
                except httpx.TransportError:
                    pass
                time.sleep(0.02)
        raise RuntimeError("Private auth process did not become available.")

    def client(self):
        return httpx.Client(base_url=f"http://127.0.0.1:{self.port}", timeout=10)

    def command(self, **message):
        with socket.socket(socket.AF_UNIX) as channel:
            channel.settimeout(5)
            channel.connect(str(self.control_path))
            channel.sendall((json.dumps(message) + "\n").encode())
            data = b""
            while not data.endswith(b"\n"):
                data += channel.recv(4096)
            result = json.loads(data)
            if "error" in result:
                raise RuntimeError(result["error"])
            return result

    def wait(self):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.command(action="status")["reached"]:
                return
            time.sleep(0.01)
        raise RuntimeError("The actual worker did not reach the private barrier.")

    def kill(self):
        self.process.kill()
        self.process.wait(timeout=5)

    def close(self):
        if self.process is not None and self.process.poll() is None:
            self.kill()
        self.directory.cleanup()
