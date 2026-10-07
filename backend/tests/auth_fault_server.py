"""Private process barriers; imported only by the isolated T07 test launcher."""

import asyncio
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
                self.clock = (
                    datetime.fromisoformat(message["at"]) if message["at"] else None
                )
                if self.clock is not None and self.clock.tzinfo is None:
                    raise ValueError("The injected clock must include its zone.")
            elif action != "status":
                raise ValueError("Unknown private command.")
            return {"stage": self.stage, "reached": self.reached}


barrier = Barrier()

# Sanitized readiness diagnostic: never report SQL, cookie or exception parameters.
from app import main

original_reconcile = main.reconcile
readiness_failure = None


def observed_reconcile(*args, **kwargs):
    global readiness_failure
    try:
        return original_reconcile(*args, **kwargs)
    except RuntimeError as error:
        known = {
            "Authentication current credential verification failed.",
            "Authentication sequence verification failed.",
            "Authentication foreign key verification failed.",
            "The independent deletion ledger is incomplete.",
        }
        readiness_failure = (
            str(error) if str(error) in known else "Verification failure"
        )
        raise


main.reconcile = observed_reconcile

# Tests advance the existing 60s maintenance cycle through a private event, not
# a shorter product interval. Every other asyncio sleep remains unchanged.
maintenance_tick = asyncio.Event()
maintenance_loop = None
original_sleep = asyncio.sleep


async def controlled_sleep(delay, *args, **kwargs):
    global maintenance_loop
    if delay == 60:
        maintenance_loop = asyncio.get_running_loop()
        await maintenance_tick.wait()
        maintenance_tick.clear()
    else:
        await original_sleep(delay, *args, **kwargs)


asyncio.sleep = controlled_sleep


class Control(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            message = json.loads(self.rfile.readline(4096))
            if message["action"] == "readiness":
                result = {"ready": app.state.auth_ready, "reason": readiness_failure}
            elif message["action"] == "maintenance":
                if maintenance_loop is None:
                    raise ValueError("Maintenance cycle not initialized.")
                maintenance_loop.call_soon_threadsafe(maintenance_tick.set)
                result = {"tick": True}
            elif message["action"] == "sweep":
                from app.auth_maintenance import sweep

                sweep(app.state.session_factory)
                result = {"swept": True}
            else:
                result = barrier.command(message)
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
from app import auth_boundary, auth_login, auth_password, auth_reauth

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
    target = args[1].url.path in {
        "/api/v1/auth/login",
        "/api/v1/auth/password",
        "/api/v1/auth/reauth",
    }
    target = target or (
        args[1].method == "DELETE"
        and args[1].url.path.startswith("/api/v1/admin/users/")
    )
    if target:
        barrier.hit("before_commit")
    result = respond(*args, **kwargs)
    if target:
        barrier.hit("committed")
    return result


auth_login.argon2_verify = verified
auth_login.execution_context = execution_context
auth_password.execution_context = execution_context
auth_reauth.execution_context = execution_context
auth_login.response = response

from app import admin_user_delete

admin_user_delete.response = response
