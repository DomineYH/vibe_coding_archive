"""Single-process health worker. Network execution never runs in the API process."""

from __future__ import annotations

import asyncio
import fcntl
import os
import signal
import stat
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app import health_store as store
from app.database import (
    current_head,
    current_revision,
    make_engine,
    make_session_factory,
)
from app.health_runtime import boot_clock, runtime_enabled
from app.safe_logging import background_error, emit, install
from app.settings import Settings


class ActivationRequired(RuntimeError):
    pass


class UncleanShutdown(RuntimeError):
    """The supervisor must confirm OS process exit before another worker starts."""


class WorkerLock:
    def __init__(self, path: Path):
        self.path = path
        self.fd = None

    def __enter__(self):
        fd = os.open(
            self.path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600
        )
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_uid != os.getuid()
                or info.st_nlink != 1
                or info.st_mode & 0o022
            ):
                raise RuntimeError("Worker lock must be a private, owned regular file.")
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("A health worker is already running.") from None
            self.fd = fd
            return self
        except BaseException:
            os.close(fd)
            raise

    def __exit__(self, *_):
        os.close(self.fd)
        self.fd = None
        # Keep the inode: unlinking allows two independently locked worker files.


def utc_stamp():
    return datetime.now(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")


def suspend_offset():
    return time.clock_gettime(time.CLOCK_BOOTTIME) - time.monotonic()


class ExecutionDisabled(RuntimeError):
    """Explicit stop invalidates execution writes but permits cancellation cleanup."""


class ExecutionClockChanged(RuntimeError):
    """A confirmed clock discontinuity invalidates the old execution generation."""


@dataclass(frozen=True)
class ExecutionClock:
    boot_id: str
    monotonic: float
    offset: float

    @classmethod
    def capture(cls):
        boot, mono = boot_clock()
        return cls(boot, mono, suspend_offset())

    def check(self):
        current = self.capture()
        if (
            current.boot_id != self.boot_id
            or current.monotonic < self.monotonic
            or abs(current.offset - self.offset) > 0.05
        ):
            raise ExecutionClockChanged("Execution clock discontinuity")


class Worker:
    def __init__(self, settings, session_factory, *, testing_probe=None):
        if testing_probe is not None and settings.app_env != "test":
            raise ValueError("Controlled health probes require APP_ENV=test.")
        self.settings = settings
        self.session_factory = session_factory
        self.testing_probe = testing_probe
        self.worker_id = str(uuid4())
        self.stopping = asyncio.Event()
        self.disabled = False
        self.tasks = {}
        self.executor = None
        self.stop_deadline = None
        self.clock = None

    def stop(self):
        """Normal restart: retain queued work and drain current original deadlines."""
        if self.stop_deadline is None:
            self.stop_deadline = time.monotonic() + 15
        self.stopping.set()

    def disable(self):
        """Explicit stop: cancel queued/running work and preserve completed results."""
        self.disabled = True

    def enabled(self):
        return not self.disabled and (
            self.testing_probe is not None or runtime_enabled(self.settings)
        )

    async def transaction(self, operation, *, clock=None, require_enabled=False):
        def execute():
            with self.session_factory() as db:
                db.execute(text("BEGIN IMMEDIATE"))
                # Clocks and execution conditions are sampled after acquiring the lock.
                if clock is not None:
                    clock.check()
                if require_enabled and not self.enabled():
                    raise ExecutionDisabled()
                boot, mono = boot_clock()
                value = operation(db, boot, mono, utc_stamp())
                if clock is not None:
                    clock.check()
                if require_enabled and not self.enabled():
                    raise ExecutionDisabled()
                db.commit()
                return value

        return await asyncio.get_running_loop().run_in_executor(self.executor, execute)

    async def register(self):
        clock = ExecutionClock.capture()

        def start(db, boot, mono, stamp):
            previous = store.current_worker(db)
            dead = (previous["worker_id"],) if previous else ()
            # The process-wide OS lock is held. The previous owner has exited.
            store.maintain(
                db, boot_id=boot, mono=mono, stamp=stamp, stopped_worker_ids=dead
            )
            store.heartbeat(
                db, worker_id=self.worker_id, boot_id=boot, mono=mono, stamp=stamp
            )

        await self.transaction(start, clock=clock)
        self.clock = clock

    async def unavailable(self):
        await self.transaction(
            lambda db, boot, mono, stamp: store.invalidate(db, self.worker_id, stamp)
        )

    async def cancel_running(self):
        pending = [task for task in self.tasks.values() if not task.done()]
        for task in pending:
            task.cancel()
        if pending:
            _, unfinished = await asyncio.wait(pending, timeout=1)
            if unfinished:
                raise UncleanShutdown(
                    "Health execution did not confirm resource cleanup."
                )
        for task in self.tasks.values():
            if not task.cancelled() and task.done():
                error = task.exception()
                if isinstance(error, UncleanShutdown):
                    raise error
        self.tasks.clear()

    async def recover_generation(self):
        await self.unavailable()
        await self.cancel_running()
        self.worker_id = str(uuid4())
        await self.register()

    async def reconcile_failed_save(self, job, clock):
        def reconcile(db, boot, mono, stamp):
            current = (
                db.execute(
                    text("SELECT status,attempts FROM health_jobs WHERE id=:id"),
                    {"id": job["id"]},
                )
                .mappings()
                .first()
            )
            if (
                current
                and current["status"] == "running"
                and current["attempts"] == job["attempts"]
            ):
                store.fail(
                    db,
                    job,
                    boot_id=boot,
                    mono=mono,
                    stamp=stamp,
                    code="RESULT_STORE_FAILED",
                )

        try:
            await self.transaction(reconcile, clock=clock, require_enabled=True)
        except SQLAlchemyError:
            # Neither success nor failure could be confirmed: leave recovery to
            # the next OS-confirmed worker instance; never repeat result writes.
            self.stopping.set()

    async def execute(self, job, clock):
        from app.health_probe import probe
        from app.health_transport import ResourceCleanupError

        try:
            # The snapshot predates claim's DB wait, unlike probe's own clock.
            clock.check()
            if not self.enabled():
                return
            result = await (self.testing_probe or probe)(
                job["url"],
                dns_servers=self.settings.health_dns_servers,
                denied_ips=self.settings.health_denied_ips,
            )
        except ResourceCleanupError as error:
            raise UncleanShutdown(
                "Transport cleanup could not be confirmed."
            ) from error
        except (asyncio.CancelledError, ExecutionClockChanged):
            raise
        except Exception:  # noqa: BLE001 - A confirmed probe failure must terminalize its job.
            await self.transaction(
                lambda db, boot, mono, stamp: store.fail(
                    db, job, boot_id=boot, mono=mono, stamp=stamp
                ),
                clock=clock,
                require_enabled=True,
            )
            return
        try:
            await self.transaction(
                lambda db, boot, mono, stamp: store.finish(
                    db, job, result, boot_id=boot, mono=mono, stamp=stamp
                ),
                clock=clock,
                require_enabled=True,
            )
        except SQLAlchemyError:
            await self.reconcile_failed_save(job, clock)

    async def cycle(self, heartbeat_due):
        expired = await self.transaction(
            lambda db, boot, mono, stamp: db.execute(
                text(
                    "SELECT 1 FROM health_jobs WHERE worker_id=:worker AND status='running' AND (boot_id<>:boot OR lease_deadline<=:mono) LIMIT 1"
                ),
                {"worker": self.worker_id, "boot": boot, "mono": mono},
            ).scalar(),
            clock=self.clock,
        )
        if expired:
            # Recovery is fenced by execution generation. Close every execution
            # in the old generation before the store receives its stopped ID.
            await self.recover_generation()
        for job_id, task in list(self.tasks.items()):
            if task.done():
                del self.tasks[job_id]
                if not task.cancelled():
                    task.result()
        if heartbeat_due:

            def maintain(db, boot, mono, stamp):
                store.maintain(db, boot_id=boot, mono=mono, stamp=stamp)
                store.heartbeat(
                    db, worker_id=self.worker_id, boot_id=boot, mono=mono, stamp=stamp
                )

            await self.transaction(maintain, clock=self.clock)
        # Observe deletion/URL changes during execution so their sockets close.
        if self.tasks:
            active = await self.transaction(
                lambda db, boot, mono, stamp: set(
                    db.execute(
                        text(
                            "SELECT id FROM health_jobs WHERE worker_id=:worker AND boot_id=:boot AND status='running' AND lease_deadline>:mono"
                        ),
                        {"worker": self.worker_id, "boot": boot, "mono": mono},
                    ).scalars()
                ),
                clock=self.clock,
            )
            for job_id, task in self.tasks.items():
                if job_id not in active and not task.done():
                    task.cancel()
        while len(self.tasks) < 3 and not self.stopping.is_set():
            clock = ExecutionClock.capture()
            self.clock.check()
            job = await self.transaction(
                lambda db, boot, mono, stamp: (
                    store.claim(
                        db,
                        worker_id=self.worker_id,
                        boot_id=boot,
                        mono=mono,
                        stamp=stamp,
                    )
                    if not self.stopping.is_set()
                    else None
                ),
                clock=clock,
                require_enabled=True,
            )
            if job is None:
                break
            self.tasks[job["id"]] = asyncio.create_task(self.execute(job, clock))

    async def run(self):
        if not self.enabled():
            raise ActivationRequired(
                "Health execution requires a verified activation record."
            )
        if (
            self.testing_probe is None
            and os.getuid() != self.settings.health_worker_uid
        ):
            raise ActivationRequired(
                "Health worker must use its configured unprivileged UID."
            )
        with WorkerLock(self.settings.health_worker_lock_path):
            self.executor = ThreadPoolExecutor(
                max_workers=1, thread_name_prefix="health-db"
            )
            try:
                await self.register()
                heartbeat_at = time.monotonic()
                while not self.stopping.is_set():
                    if not self.enabled():
                        break
                    heartbeat_due = time.monotonic() - heartbeat_at >= 5
                    try:
                        self.clock.check()
                        await self.cycle(heartbeat_due)
                    except ExecutionClockChanged:
                        await self.recover_generation()
                    except ExecutionDisabled:
                        continue  # The next loop cancels all work before any new claim.
                    if heartbeat_due:
                        heartbeat_at = time.monotonic()
                    try:
                        await asyncio.wait_for(self.stopping.wait(), 0.1)
                    except TimeoutError:
                        pass
                if not self.enabled():
                    # Explicit disable wins even when SIGTERM ended the loop.
                    await self.transaction(
                        lambda db, boot, mono, stamp: store.cancel_all(db, stamp)
                    )
                    await self.cancel_running()
                # Normal SIGTERM does not cancel queued jobs or extend deadlines.
                await self.transaction(
                    lambda db, boot, mono, stamp: store.heartbeat(
                        db,
                        worker_id=self.worker_id,
                        boot_id=boot,
                        mono=mono,
                        stamp=stamp,
                        ready=False,
                    )
                )
                if self.tasks:
                    drain_deadline = (self.stop_deadline or (time.monotonic() + 15)) - 1
                    pending = set(self.tasks.values())
                    while pending and self.enabled():
                        remaining = drain_deadline - time.monotonic()
                        if remaining <= 0:
                            break
                        _, pending = await asyncio.wait(
                            pending, timeout=min(0.1, remaining)
                        )
                # Off may arrive during drain or as its last task completes.
                if not self.enabled():
                    await self.transaction(
                        lambda db, boot, mono, stamp: store.cancel_all(db, stamp)
                    )
                await self.cancel_running()
            except UncleanShutdown:
                if self.testing_probe is None:
                    # Keep the lock until OS exit closes every socket. Releasing
                    # it first could let a new worker overlap an unclosed stream.
                    os._exit(70)
                raise
            finally:
                try:
                    await self.cancel_running()
                    await self.unavailable()
                except UncleanShutdown:
                    if self.testing_probe is None:
                        os._exit(70)
                    raise
                finally:
                    self.executor.shutdown(wait=True, cancel_futures=True)


async def serve(settings):
    asyncio.get_running_loop().set_exception_handler(background_error)
    engine = make_engine(settings.database_path)
    try:
        if current_revision(engine) != current_head():
            raise RuntimeError("Database migration revision is not current.")
        worker = Worker(settings, make_session_factory(engine))
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(sig, worker.stop)
        await worker.run()
    except UncleanShutdown:
        # OS exit closes all network FDs and releases the lifetime lock together.
        # systemd must wait for this exit before restarting the worker.
        os._exit(70)
    finally:
        engine.dispose()


def main():
    install()
    try:
        asyncio.run(serve(Settings.from_environment()))
    except KeyboardInterrupt:
        return 130
    except Exception:  # noqa: BLE001 - Preserve nonzero exit without a traceback.
        emit("WORKER_FAILED")
        return 1
    emit("WORKER_COMPLETED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
