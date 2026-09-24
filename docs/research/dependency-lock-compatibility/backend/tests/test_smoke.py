import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pydantic import BaseModel
from sqlalchemy import create_engine, event, text


def test_sqlite_pragmas(tmp_path):
    db_file = tmp_path / "test.db"
    engine = create_engine(f"sqlite:///{db_file}")

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys = ON")
        cursor.execute("PRAGMA busy_timeout = 5000")
        cursor.execute("PRAGMA journal_mode = WAL")
        cursor.close()

    with engine.connect() as conn:
        fk = conn.execute(text("PRAGMA foreign_keys")).scalar()
        bt = conn.execute(text("PRAGMA busy_timeout")).scalar()
        jm = conn.execute(text("PRAGMA journal_mode")).scalar()
        assert fk == 1
        assert bt == 5000
        assert jm.lower() == "wal"


def test_password_hash():
    password_hash = PasswordHash((Argon2Hasher(),))
    hashed = password_hash.hash("VerySecurePassword123!")
    assert password_hash.verify("VerySecurePassword123!", hashed) is True
    assert password_hash.verify("WrongPassword", hashed) is False


class UserSchema(BaseModel):
    login_id: str
    nickname: str


def test_pydantic_schema():
    user = UserSchema(login_id="teacher_kim", nickname="김선생")
    assert user.login_id == "teacher_kim"
    assert user.nickname == "김선생"


@pytest.mark.asyncio
async def test_fastapi_async_client():
    app = FastAPI()

    @app.get("/healthz")
    async def healthz():
        return {"status": "ok"}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        resp = await client.get("/healthz")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
