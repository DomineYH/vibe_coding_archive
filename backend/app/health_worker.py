"""Single-process health worker. Network execution never runs in the API process."""

from __future__ import annotations

import asyncio
import fcntl
import os
import signal
import stat
import time
from concurrent.futures import ThreadPoolExecutor
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

    async def transaction(self, operation):
        def execute():
            with self.session_factory() as db:
                db.execute(text("BEGIN IMMEDIATE"))
                # Clocks and execution conditions are sampled after acquiring the lock.
                boot, mono = boot_clock()
                value = operation(db, boot, mono, utc_stamp())
                db.commit()
                return value

        return await asyncio.get_running_loop().run_in_executor(self.executor, execute)

    async def register(self):
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

        await self.transaction(start)

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

    async def reconcile_failed_save(self, job):
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
            await self.transaction(reconcile)
        except SQLAlchemyError:
            # Neither success nor failure could be confirmed: leave recovery to
            # the next OS-confirmed worker instance; never repeat result writes.
            self.stopping.set()

    async def execute(self, job):
        from app.health_probe import probe
        from app.health_transport import ResourceCleanupError

        try:
            result = await (self.testing_probe or probe)(
                job["url"],
                dns_servers=self.settings.health_dns_servers,
                denied_ips=self.settings.health_denied_ips,
            )
        except ResourceCleanupError as error:
            raise UncleanShutdown(
                "Transport cleanup could not be confirmed."
            ) from error
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - A confirmed probe failure must terminalize its job.
            await self.transaction(
                lambda db, boot, mono, stamp: store.fail(
                    db, job, boot_id=boot, mono=mono, stamp=stamp
                )
            )
            return
        try:
            await self.transaction(
                lambda db, boot, mono, stamp: (
                    store.finish(db, job, result, boot_id=boot, mono=mono, stamp=stamp)
                    if self.enabled()
                    else False
                )
            )
        except SQLAlchemyError:
            await self.reconcile_failed_save(job)

    async def cycle(self, heartbeat_due):
        expired = await self.transaction(
            lambda db, boot, mono, stamp: db.execute(
                text(
                    "SELECT 1 FROM health_jobs WHERE worker_id=:worker AND status='running' AND (boot_id<>:boot OR lease_deadline<=:mono) LIMIT 1"
                ),
                {"worker": self.worker_id, "boot": boot, "mono": mono},
            ).scalar()
        )
        if expired:
            # Recovery is fenced by execution generation. Close every execution
            # in the old generation before the store receives its stopped ID.
            await self.unavailable()
            await self.cancel_running()
            self.worker_id = str(uuid4())
            await self.register()
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

            await self.transaction(maintain)
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
                )
            )
            for job_id, task in self.tasks.items():
                if job_id not in active and not task.done():
                    task.cancel()
        while len(self.tasks) < 3 and not self.stopping.is_set():
            job = await self.transaction(
                lambda db, boot, mono, stamp: store.claim(
                    db, worker_id=self.worker_id, boot_id=boot, mono=mono, stamp=stamp
                )
            )
            if job is None:
                break
            self.tasks[job["id"]] = asyncio.create_task(self.execute(job))

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
                offset = suspend_offset()
                heartbeat_at = time.monotonic()
                while not self.stopping.is_set():
                    if not self.enabled():
                        await self.transaction(
                            lambda db, boot, mono, stamp: store.cancel_all(db, stamp)
                        )
                        await self.cancel_running()
                        break
                    if suspend_offset() - offset > 0.05:
                        await self.unavailable()
                        await self.cancel_running()
                        self.worker_id = str(uuid4())
                        await self.register()
                        offset = suspend_offset()
                    heartbeat_due = time.monotonic() - heartbeat_at >= 5
                    await self.cycle(heartbeat_due)
                    if heartbeat_due:
                        heartbeat_at = time.monotonic()
                    try:
                        await asyncio.wait_for(self.stopping.wait(), 0.1)
                    except TimeoutError:
                        pass
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
                    remaining = max(
                        0,
                        (self.stop_deadline or (time.monotonic() + 15))
                        - time.monotonic()
                        - 1,
                    )
                    await asyncio.wait(list(self.tasks.values()), timeout=remaining)
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
    asyncio.run(serve(Settings.from_environment()))


if __name__ == "__main__":
    main()
