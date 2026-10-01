"""Interactive administrator creation/recovery; all durable effects commit together."""

import re
import sys
from getpass import getpass
from unicodedata import bidirectional, category, normalize
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth_boundary import AuthError, after, normalized_login_id, now
from app.auth_login import HASHER
from app.database import current_head, current_revision, make_engine
from app.password_policy import load_blocklist, new_password
from app.settings import Settings


def admin_credentials(command):
    if not sys.stdin.isatty() or not sys.stdout.isatty():
        raise ValueError("Admin credentials require an interactive terminal.")
    settings = Settings.from_environment()
    if not settings.database_path.is_file():
        raise ValueError("Run the explicit migration first.")
    engine = make_engine(settings.database_path)
    try:
        if current_revision(engine) != current_head():
            raise ValueError("Database migration head does not match the application.")
        blocklist = load_blocklist(settings.password_blocklist_path)
        login = normalize("NFC", input("Login ID: ").strip())
        if not re.fullmatch(r"[가-힣A-Za-z0-9_.-]{2,32}", login):
            raise ValueError("Invalid login ID.")
        nickname = None
        if command == "bootstrap-admin":
            raw_nickname = input("Nickname: ")
            nickname = normalize("NFC", raw_nickname.strip())
            if (
                not 2 <= len(nickname) <= 20
                or any(
                    category(c) in {"Cc", "Cs"}
                    or bidirectional(c)
                    in {"LRE", "RLE", "LRO", "RLO", "PDF", "LRI", "RLI", "FSI", "PDI"}
                    for c in raw_nickname
                )
                or not any(not c.isspace() and category(c) != "Cf" for c in nickname)
            ):
                raise ValueError("Nickname must contain 2 to 20 characters.")
        try:
            password = new_password(getpass("Temporary password: "), blocklist)
        except AuthError:
            raise ValueError(
                "Temporary password does not meet the password policy."
            ) from None
        if password != normalize("NFC", getpass("Confirm temporary password: ")):
            raise ValueError("The entered passwords do not match.")
        if input("Type YES to confirm: ") != "YES":
            raise ValueError("Administrator credential change cancelled.")
        hashed = HASHER.hash(password)
        with Session(engine) as db:
            db.execute(text("BEGIN IMMEDIATE"))
            stamp = now()
            member = (
                db.execute(
                    text("SELECT * FROM members WHERE login_id_key=:key"),
                    {"key": normalized_login_id(login)},
                )
                .mappings()
                .first()
            )
            if command == "bootstrap-admin":
                if db.execute(text("SELECT 1 FROM members WHERE is_admin=1")).first():
                    raise ValueError("Bootstrap requires zero administrators.")
                if member:
                    raise ValueError("Login ID collision; no member was promoted.")
                member_id = str(uuid4())
                db.execute(
                    text(
                        "INSERT INTO members(id,login_id,login_id_key,nickname,password_hash,is_admin,approval_status,created_at,updated_at,first_approved_at,must_change_password,temporary_password_expires_at) VALUES (:id,:login,:key,:nickname,:hash,1,'approved',:now,:now,:now,1,:expiry)"
                    ),
                    {
                        "id": member_id,
                        "login": login,
                        "key": normalized_login_id(login),
                        "nickname": nickname,
                        "hash": hashed,
                        "now": stamp,
                        "expiry": after(stamp, 86400),
                    },
                )
            else:
                if not member or not member["is_admin"]:
                    raise ValueError("Recovery requires an existing administrator.")
                member_id = member["id"]
                db.execute(
                    text(
                        "UPDATE members SET password_hash=:hash, must_change_password=1, temporary_password_expires_at=:expiry, account_version=account_version+1, updated_at=:now WHERE id=:id"
                    ),
                    {
                        "hash": hashed,
                        "expiry": after(stamp, 86400),
                        "now": stamp,
                        "id": member_id,
                    },
                )
                db.execute(
                    text(
                        "UPDATE sessions SET revoked_at=:now WHERE member_id=:id AND revoked_at IS NULL"
                    ),
                    {"now": stamp, "id": member_id},
                )
            db.execute(
                text(
                    "INSERT INTO audit_logs(action,actor_id,target_id,occurred_at,outcome) VALUES (:action,:id,:id,:now,'succeeded')"
                ),
                {"action": command.replace("-", "_"), "id": member_id, "now": stamp},
            )
            db.commit()
    finally:
        engine.dispose()
    print(
        "Administrator temporary credential saved. Complete your own password change in the browser."
    )
