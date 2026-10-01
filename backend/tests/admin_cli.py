"""Drive the actual admin CLI in a pseudoterminal; never expose secret output."""

import errno
import os
import pty
import select
import subprocess
import sys
import time

from tests.conftest import BACKEND


def run_admin_cli(command, database_path, blocklist_path, answers):
    terminal, slave = pty.openpty()
    process = subprocess.Popen(
        [sys.executable, "-m", "app.cli", command],
        cwd=BACKEND,
        stdin=slave,
        stdout=slave,
        stderr=slave,
        start_new_session=True,
        env={
            **os.environ,
            "APP_ENV": "test",
            "DATABASE_PATH": str(database_path),
            "PUBLIC_ORIGIN": "http://localhost:5174",
            "PASSWORD_BLOCKLIST_PATH": str(blocklist_path),
        },
    )
    os.close(slave)
    output = bytearray()
    sent = 0
    deadline = time.monotonic() + 25
    try:
        while time.monotonic() < deadline:
            if select.select([terminal], [], [], 0.1)[0]:
                try:
                    output.extend(os.read(terminal, 4096))
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
            if sent < len(answers) and answers[sent][0].encode() in output:
                os.write(terminal, answers[sent][1].encode() + b"\n")
                sent += 1
            if process.poll() is not None:
                return process.returncode, output.decode(errors="replace")
        raise AssertionError("Admin CLI timed out")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        os.close(terminal)
