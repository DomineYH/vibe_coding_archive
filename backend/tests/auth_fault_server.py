"""Private process barriers; imported only by the isolated T07 test launcher."""

import json
import os
import socketserver
import threading
from datetime import datetime

from tests import auth_server

app = auth_server.app
settings = auth_server.settings

if settings.app_env != "test" or not os.environ.get("AUTH_FAULT_CONTROL"):
    raise RuntimeError("Fault controls require the private test launcher.")


class Barrier:
    def __init__(self):
        self.lock = threading.Lock()
        self.release = threading.Event()
        self.stage = None
        self.reached = False
        self.clock = None

    def hit(self, stage):
        with self.lock:
            if self.stage != stage or self.reached:
                return
            self.reached = True
        if not self.release.wait(20):
            raise RuntimeError("Private auth barrier was not released.")

    def command(self, message):
        with self.lock:
            action = message["action"]
            if action == "arm":
                if self.stage and not self.release.is_set():
                    raise ValueError("A barrier is already armed.")
                if message["stage"] not in {
                    "before_claim",
                    "hash_return",
                    "before_commit",
                    "committed",
                }:
                    raise ValueError("Unknown barrier stage.")
                self.stage = message["stage"]
                self.reached = False
                self.release.clear()
            elif action == "release":
                self.release.set()
            elif action == "clock":
                self.clock = datetime.fromisoformat(message["at"])
                if self.clock.tzinfo is None:
                    raise ValueError("The injected clock must include its zone.")
            elif action != "status":
                raise ValueError("Unknown private command.")
            return {"stage": self.stage, "reached": self.reached}


barrier = Barrier()


class Control(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            result = barrier.command(json.loads(self.rfile.readline(4096)))
        except (ValueError, KeyError):
            result = {"error": "invalid private command"}
        self.wfile.write((json.dumps(result) + "\n").encode())


control = socketserver.ThreadingUnixStreamServer(
    os.environ["AUTH_FAULT_CONTROL"], Control
)
os.chmod(os.environ["AUTH_FAULT_CONTROL"], 0o600)
threading.Thread(target=control.serve_forever, daemon=True).start()

# Hooks live in tests/, never in product routes or public request headers.
# The native Argon2 verifier still runs. hash_return holds its actual worker
# after native verification, before the real verifier callable returns.
from app import auth_boundary, auth_login, auth_password

original_datetime = auth_boundary.datetime


class Clock(datetime):
    @classmethod
    def now(cls, tz=None):
        return barrier.clock or original_datetime.now(tz)


auth_boundary.datetime = Clock
verify = auth_login.argon2_verify
execution = auth_login.execution_context
respond = auth_login.response


def verified(*args, **kwargs):
    result = verify(*args, **kwargs)
    barrier.hit("hash_return")
    return result


def execution_context(db, request, kind, state):
    if state == "admitted":
        barrier.hit("before_claim")
    return execution(db, request, kind, state)


def response(*args, **kwargs):
    target = args[1].url.path in {"/api/v1/auth/login", "/api/v1/auth/password"}
    if target:
        barrier.hit("before_commit")
    result = respond(*args, **kwargs)
    if target:
        barrier.hit("committed")
    return result


auth_login.argon2_verify = verified
auth_login.execution_context = execution_context
auth_password.execution_context = execution_context
auth_login.response = response
