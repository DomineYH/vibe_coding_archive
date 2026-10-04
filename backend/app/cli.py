from __future__ import annotations

import argparse
import sys
from datetime import UTC, datetime
from getpass import getpass
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


def main() -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    subparsers = parser.add_subparsers(dest="command", required=True)
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
                str(error)
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
                from app.pending_retention import sweep_pending

                sweep_pending(make_session_factory(engine))
        except (RuntimeError, SQLAlchemyError, OSError):
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
            print(error, file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
