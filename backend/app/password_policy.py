"""The fixed R15 whole-string list; acquisition is explicit, never at API startup."""

import hashlib
import json
import os
from functools import cache
from pathlib import Path
from unicodedata import normalize
from urllib.request import urlopen

from app.auth_boundary import AuthError
from app.settings import ROOT


@cache
def blocklist_source():
    # Public reads and seed do not depend on authentication provisioning metadata.
    return json.loads(
        (
            ROOT
            / "docs/research/password-blocklist-provenance/metadata/candidate_sources.json"
        ).read_text()
    )["candidates"]["seclists_ncsc_100k"]


def decode_blocklist(raw):
    source = blocklist_source()
    if (
        len(raw) != source["file_size_bytes"]
        or hashlib.sha256(raw).hexdigest() != source["sha256"]
    ):
        raise ValueError("Password blocklist integrity check failed.")
    lines = raw.decode("utf-8").split("\n")
    entries = [normalize("NFC", line) for line in lines if line]
    if len(entries) != source["non_empty_lines"]:
        raise ValueError("Password blocklist format check failed.")
    return frozenset(entries)


def load_blocklist(path):
    try:
        return decode_blocklist(Path(path).read_bytes())
    except (OSError, ValueError, UnicodeError):
        raise RuntimeError("A verified password blocklist is required.") from None


def prepare_blocklist(path):
    source = blocklist_source()
    with urlopen(source["download_url"], timeout=30) as reply:
        raw = reply.read(source["file_size_bytes"] + 1)
    decode_blocklist(raw)
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Write only verified data, privately and atomically, including on a repeated preparation.
    temporary = path.with_suffix(".preparing")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as file:
            file.write(raw)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def new_password(value, blocklist):
    value = normalize("NFC", value)
    message = None
    if not 15 <= len(value) <= 128:
        message = "비밀번호는 15~128자로 입력해 주세요."
    elif value in blocklist:
        message = "흔한 비밀번호는 사용할 수 없습니다."
    if message:
        raise AuthError("VALIDATION_ERROR", 422, fields={"password": message})
    return value
