"""Allowlisted events; foreign messages, arguments and tracebacks are never formatted."""

import argparse
import json
import logging
import math
import sys
import time
from datetime import UTC, datetime
from uuid import uuid4

CODES = frozenset(
    {
        "API_FAILED",
        "CLI_FAILED",
        "CLI_USAGE_INVALID",
        "CLI_COMPLETED",
        "WORKER_FAILED",
        "WORKER_COMPLETED",
        "BACKGROUND_FAILED",
        "DIAGNOSTIC_SUPPRESSED",
        "REQUEST_COMPLETED",
        "RESTORE_MAINTENANCE_REQUIRED",
    }
)


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        emit("CLI_USAGE_INVALID")
        self.exit(2)


class _Event(dict):
    pass


class SafeFormatter(logging.Formatter):
    def format(self, record):
        # Only the emitter creates a payload; third-party extras are ignored.
        payload = (
            record.__dict__.get("_safe_event")
            if record.name == "eduvibe.safe"
            else None
        )
        if type(payload) is not _Event or payload.get("code") not in CODES:
            payload = {"code": "DIAGNOSTIC_SUPPRESSED"}
        return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


def install():
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(SafeFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    for logger in list(logging.root.manager.loggerDict.values()):
        if isinstance(logger, logging.Logger):
            logger.handlers.clear()
            logger.propagate = True
    logging.captureWarnings(True)
    sys.excepthook = lambda *_: emit("DIAGNOSTIC_SUPPRESSED")


def emit(code, *, run_id=None, route=None, status=None, duration_ms=None):
    if code not in CODES:
        raise ValueError("LOG_EVENT_INVALID")
    payload = _Event(
        code=code, at=datetime.now(UTC).isoformat(), run_id=run_id or str(uuid4())
    )
    if route is not None:
        payload["route"] = route
    if status is not None:
        payload["status"] = status
    if duration_ms is not None:
        payload["duration_ms"] = (
            round(max(0, duration_ms), 3) if math.isfinite(duration_ms) else 0
        )
    logging.getLogger("eduvibe.safe").info("", extra={"_safe_event": payload})


def background_error(loop, context):
    emit("BACKGROUND_FAILED")


class CompletionLog:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        started = time.monotonic()
        run_id = str(uuid4())
        status = 500

        async def response(message):
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, response)
        finally:
            route = scope.get("route")
            # Scope path, client IDs, and path parameters never become log fields.
            template = getattr(route, "path", "unmatched")
            emit(
                "REQUEST_COMPLETED",
                run_id=run_id,
                route=template,
                status=status,
                duration_ms=(time.monotonic() - started) * 1000,
            )
