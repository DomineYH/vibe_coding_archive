from __future__ import annotations

import logging
import os
import resource
import signal
import sqlite3
import sys
from datetime import UTC, datetime
from getpass import getpass
from pathlib import Path
from unicodedata import normalize

from alembic.util.exc import CommandError
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.auth_boundary import normalized_login_id as _normalized_login_id
from app.auth_maintenance import reconcile
from app.database import current_head, current_revision, make_engine
from app.models import App, AppGrade, HealthResult, Member
from app.safe_logging import SafeParser, emit, install
from app.settings import ROOT, ConfigurationError, Settings

MEMBERS = (
    {
        "id": "00000000-0000-4000-8000-000000000084",
        "login_id": "seed-member-one",
        "nickname": "시연 교사",
    },
    {
        "id": "00000000-0000-4000-8000-000000000085",
        "login_id": "seed-member-two",
        "nickname": "비공개 검수 교사",
    },
)
APPS = (
    {
        "id": "00000000-0000-4000-8000-000000000084",
        "owner_id": MEMBERS[0]["id"],
        "name": "분수 탐험 교실",
        "url": "https://example.test/fraction-adventure",
        "prompt": "초등학교 4학년을 위한 분수 탐험 활동을 만들어 주세요.",
        "description": "분수와 수직선을 함께 살펴보는 합성 자료입니다.",
        "subject": "수학",
        "is_public": True,
        "theme_id": "cloudDancer",
        "grades": ("초4", "초5"),
    },
    {
        "id": "00000000-0000-4000-8000-000000000085",
        "owner_id": MEMBERS[1]["id"],
        "name": "비공개 검수 자료",
        "url": "https://example.test/private-review",
        "prompt": "private seed prompt sentinel",
        "description": "private seed description sentinel",
        "subject": "기타",
        "is_public": False,
        "theme_id": "ironGate",
        "grades": ("초1",),
    },
)


class SeedError(Exception):
    pass


def _development_database() -> Settings:
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise SeedError("Seed requires an interactive terminal.")
    try:
        settings = Settings.from_environment()
    except ConfigurationError:
        raise SeedError("Invalid development configuration.") from None
    if settings.app_env != "development":
        raise SeedError("Seed is available only in the development environment.")

    repo_root = ROOT.resolve()
    expected = (repo_root / "storage" / "development.sqlite3").resolve(strict=False)
    if settings.database_path != expected or not settings.database_path.is_relative_to(
        repo_root
    ):
        raise SeedError("Seed requires the designated development database.")
    if not settings.database_path.is_file():
        raise SeedError("Run the explicit development migration first.")

    try:
        engine = make_engine(settings.database_path)
        try:
            revision = current_revision(engine)
            head = current_head()
        finally:
            engine.dispose()
    except (CommandError, SQLAlchemyError, OSError, RuntimeError):
        raise SeedError("Database migration head could not be verified.") from None
    if not head or revision != head:
        raise SeedError("Database migration head does not match the application.")
    return settings


def _shared_password() -> str:
    password = normalize("NFC", getpass("Shared development password: "))
    confirmation = normalize("NFC", getpass("Confirm development password: "))
    if password != confirmation:
        raise SeedError("The entered passwords do not match.")
    if not 15 <= len(password) <= 128:
        raise SeedError("Password must contain 15 to 128 Unicode characters.")
    return password


def seed() -> None:
    settings = _development_database()
    engine = make_engine(settings.database_path)
    members_added = 0
    apps_added = 0
    try:
        with Session(engine) as session:
            try:
                seed_login_ids = {
                    member["id"]: _normalized_login_id(member["login_id"])
                    for member in MEMBERS
                }
                seed_id_by_login = {
                    login_id: member_id
                    for member_id, login_id in seed_login_ids.items()
                }
                existing_member_rows = session.execute(
                    select(Member.id, Member.login_id)
                ).all()
                existing_members = set()
                for member_id, login_id in existing_member_rows:
                    normalized_login_id = _normalized_login_id(login_id)
                    if (
                        member_id in seed_login_ids
                        and normalized_login_id != seed_login_ids[member_id]
                    ) or (
                        normalized_login_id in seed_id_by_login
                        and seed_id_by_login[normalized_login_id] != member_id
                    ):
                        raise SeedError("Conflicting seed data; no changes were saved.")
                    existing_members.add(member_id)
                missing_members = [
                    member for member in MEMBERS if member["id"] not in existing_members
                ]
                password = _shared_password() if missing_members else None
                hasher = PasswordHash.recommended() if password else None
                for member in missing_members:
                    timestamp = datetime.now(UTC)
                    session.add(
                        Member(
                            **member,
                            login_id_key=_normalized_login_id(member["login_id"]),
                            created_at=timestamp,
                            updated_at=timestamp,
                            first_approved_at=timestamp,
                            email=None,
                            phone=None,
                            password_hash=hasher.hash(password),
                            is_admin=False,
                            approval_status="approved",
                        )
                    )
                session.flush()
                members_added = len(missing_members)

                for app_data in APPS:
                    if session.get(App, app_data["id"]) is not None:
                        continue
                    now = datetime.now(UTC)
                    grades = app_data["grades"]
                    app_values = {
                        key: value
                        for key, value in app_data.items()
                        if key not in {"grades"}
                    }
                    session.add(
                        App(
                            **app_values,
                            stack_db=None,
                            stack_backend=None,
                            stack_frontend=None,
                            stack_hosting=None,
                            version=1,
                            url_version=1,
                            created_at=now,
                            updated_at=now,
                        )
                    )
                    session.add_all(
                        AppGrade(app_id=app_data["id"], grade=grade) for grade in grades
                    )
                    session.add(HealthResult(app_id=app_data["id"], state="unchecked"))
                    apps_added += 1
                session.commit()
            except SQLAlchemyError:
                session.rollback()
                raise SeedError(
                    "Conflicting seed data; no changes were saved."
                ) from None
    finally:
        engine.dispose()

    print(f"Seeded {members_added} members and {apps_added} apps.")


def _main() -> int:
    if sys.argv[1:2] == ["backup-db"]:
        from app.backup import main as backup_main

        return backup_main(sys.argv[2:])
    if sys.argv[1:2] in (["restore-db"], ["verify-restore"]):
        from app.restore import main as restore_main

        return restore_main(sys.argv[1], sys.argv[2:])
    parser = SafeParser(prog="python -m app.cli", allow_abbrev=False)
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("backup-db", help="create a local encrypted database backup")
    purge = subparsers.add_parser(
        "purge-expired", help="purge eligible local records and backups"
    )
    purge.add_argument("--backup-dir", required=True)
    for command in ("restore-db", "verify-restore"):
        subparsers.add_parser(command, help="inspect an isolated blocked restore")
    subparsers.add_parser(
        "maintenance-block", help="block services for explicit migration"
    )
    rotate = subparsers.add_parser("rotate-reset-key", allow_abbrev=False)
    choice = rotate.add_mutually_exclusive_group(required=True)
    choice.add_argument("--invalidate-only", action="store_true")
    choice.add_argument("--generate", action="store_true")
    subparsers.add_parser("disable-health", allow_abbrev=False)
    ops = subparsers.add_parser("ops-check", allow_abbrev=False)
    ops.add_argument("--backup-dir", required=True)
    ops.add_argument("--observations-file")
    ops.add_argument("--required-free-bytes", type=int)
    subparsers.add_parser("seed", help="add missing synthetic development data")
    subparsers.add_parser(
        "sweep-pending", help="delete expired initial pending members"
    )
    subparsers.add_parser(
        "invalidate-restored-auth",
        help="invalidate all restored browser authority before restart",
    )
    for command in ("bootstrap-admin", "recover-admin", "prepare-password-blocklist"):
        subparsers.add_parser(command)
    args = parser.parse_args()
    if args.command in ("ops-check", "disable-health", "rotate-reset-key"):
        settings = Settings.from_environment()
        raw = os.environ.get("DATABASE_PATH")
        if raw is not None and Path(raw) != settings.database_path:
            raise ConfigurationError("Invalid operational storage path")
    if args.command == "rotate-reset-key":
        from app.operational_commands import rotate_reset_key

        return rotate_reset_key(settings, generate=args.generate)
    if args.command == "disable-health":
        from app.operational_commands import disable_health

        return disable_health(settings)
    if args.command == "ops-check":
        from app.operations import main as ops_main

        if args.required_free_bytes is not None and args.required_free_bytes < 0:
            parser.error("Invalid headroom")
        return ops_main(
            settings,
            backup_dir=args.backup_dir,
            observations_file=args.observations_file,
            required_free_bytes=args.required_free_bytes,
        )
    if args.command == "maintenance-block":
        from app.maintenance import block

        return block(Settings.from_environment())
    if args.command == "purge-expired":
        from app.retention import purge_expired

        return purge_expired(Settings.from_environment(), backup_dir=args.backup_dir)
    if args.command in (
        "bootstrap-admin",
        "recover-admin",
        "prepare-password-blocklist",
    ):
        try:
            if args.command == "prepare-password-blocklist":
                from app.password_policy import prepare_blocklist

                prepare_blocklist(Settings.from_environment().password_blocklist_path)
                print("Fixed password blocklist verified and prepared.")
            else:
                from app.admin_credentials import admin_credentials

                admin_credentials(args.command)
        except (ValueError, RuntimeError, SQLAlchemyError, OSError, EOFError) as error:
            # SQL errors can embed bound hashes; report no raw exception or parameters.
            print(
                _safe_guidance(error)
                if isinstance(error, ValueError)
                else "Administrator credential operation failed; no changes saved.",
                file=sys.stderr,
            )
            return 1
        return 0
    if args.command in ("invalidate-restored-auth", "sweep-pending"):
        settings = Settings.from_environment()
        engine = make_engine(settings.database_path)
        try:
            if current_revision(engine) != current_head():
                raise RuntimeError(
                    "Explicit migration required before restore reconciliation."
                )
            from app.database import make_session_factory

            if args.command == "invalidate-restored-auth":
                reconcile(make_session_factory(engine), restored=True)
            else:
                from app.auth_maintenance import deliver_deletions
                from app.pending_retention import sweep_pending

                factory = make_session_factory(engine)
                deliver_deletions(factory)
                sweep_pending(factory)
        except (RuntimeError, SQLAlchemyError, OSError, sqlite3.Error):
            print(
                "Pending maintenance or restore verification failed; service must remain unavailable.",
                file=sys.stderr,
            )
            return 1
        finally:
            engine.dispose()
        return 0
    if args.command == "seed":
        try:
            seed()
        except SeedError as error:
            print(_safe_guidance(error), file=sys.stderr)
            return 1
    return 0


_GUIDANCE = (
    "Admin credentials require an interactive terminal.",
    "Administrator credential change cancelled.",
    "Bootstrap requires zero administrators.",
    "Conflicting seed data; no changes were saved.",
    "Database migration head could not be verified.",
    "Database migration head does not match the application.",
    "Invalid development configuration.",
    "Invalid login ID.",
    "Login ID collision; no member was promoted.",
    "Nickname must contain 2 to 20 characters.",
    "Password must contain 15 to 128 Unicode characters.",
    "Recovery requires an existing administrator.",
    "Run the explicit development migration first.",
    "Run the explicit migration first.",
    "Seed is available only in the development environment.",
    "Seed requires an interactive terminal.",
    "Seed requires the designated development database.",
    "Temporary password does not meet the password policy.",
    "The entered passwords do not match.",
)


def _safe_guidance(error):
    message = str(error)
    return next((fixed for fixed in _GUIDANCE if fixed == message), "CLI_FAILED")


def main() -> int:
    install()
    command = sys.argv[1] if len(sys.argv) > 1 else None
    fixed_output = command in (
        "maintenance-block",
        "ops-check",
        "disable-health",
        "rotate-reset-key",
        "backup-db",
        "restore-db",
        "verify-restore",
        "sweep-pending",
        "invalidate-restored-auth",
    )
    if fixed_output:
        # Preserve existing fixed CLI protocols without library diagnostics.
        logging.getLogger().handlers[0].addFilter(
            lambda record: record.name == "eduvibe.safe"
        )
    previous = {}
    if command in ("ops-check", "disable-health", "rotate-reset-key"):
        from app.backup import BackupInterrupted

        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))

        def interrupted(signum, _frame):
            for stop in (signal.SIGINT, signal.SIGTERM):
                signal.signal(stop, signal.SIG_IGN)
            raise BackupInterrupted(signum)

        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, interrupted)
    try:
        result = _main()
    except BaseException as error:
        if previous and isinstance(error, BackupInterrupted):
            emit("CLI_FAILED")
            return 128 + error.signum
        if isinstance(error, ConfigurationError):
            emit("CLI_USAGE_INVALID")
            return 2
        if not isinstance(error, Exception):
            raise
        emit("CLI_FAILED")
        return 1
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    if not fixed_output:
        emit("CLI_COMPLETED" if result in (0, 3) else "CLI_FAILED")
    return result


if __name__ == "__main__":
    raise SystemExit(main())
