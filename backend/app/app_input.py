"""One strict normalization and request-hash boundary for app work keys and writes."""

import hashlib
import json
import re
from unicodedata import normalize

from pydantic import AnyUrl, ConfigDict, model_validator

from app.auth import StrictModel
from app.auth_boundary import AuthError
from app.catalog import CATALOG
from app.public_apps import SEARCH_TRIM

BIDI = re.compile("[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]")
CONTROL = re.compile("[\x00-\x1f\x7f-\x9f]")
MULTILINE_CONTROL = re.compile("[\x00-\x08\x0b-\x1f\x7f-\x9f]")
LINE_BREAKS = re.compile("\r\n|[\r\u0085\u2028\u2029]")
# Unicode White_Space and Default_Ignorable_Code_Point, as in the browser policy.
INVISIBLE_ONLY = re.compile(
    "^[\x09-\x0d\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000"
    "\xad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f"
    "\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0\ufff0-\ufff8"
    "\U0001bca0-\U0001bca3\U0001d173-\U0001d17a\U000e0000-\U000e0fff]*$"
)


def clean_text(
    value, maximum, *, trim=False, nfc=False, multiline=False, required=False
):
    if multiline:
        value = LINE_BREAKS.sub("\n", value)
    if (MULTILINE_CONTROL if multiline else CONTROL).search(value) or BIDI.search(
        value
    ):
        raise ValueError("허용되지 않는 문자가 포함되어 있어요.")
    if trim:
        value = value.strip(SEARCH_TRIM)
    if nfc:
        value = normalize("NFC", value)
    if required and INVISIBLE_ONLY.fullmatch(value):
        raise ValueError("필수 항목을 입력해 주세요.")
    if len(value) > maximum:
        raise ValueError(f"{maximum:,}자 이내로 입력해 주세요.")
    return value


def validate_url(value):
    value = clean_text(value, 2048, trim=True, required=True)
    if (
        any(character in SEARCH_TRIM for character in value)
        or "\\" in value
        or re.search(r"%(?![0-9a-f]{2})", value, re.IGNORECASE)
    ):
        raise ValueError("http 또는 https 주소를 확인해 주세요.")
    # Pydantic's installed Rust URL parser applies WHATWG host/IDNA/IPv4 parsing.
    # Inspect the parsed host, but preserve the browser's trimmed source spelling.
    parsed = AnyUrl(value)
    authority = re.match(r"^https?://([^/?#]*)", value, re.IGNORECASE)
    host = (parsed.host or "").lower().removesuffix(".")
    if (
        parsed.scheme not in ("http", "https")
        or (authority and "@" in authority[1])
        or parsed.username
        or parsed.password
        or parsed.port != {"http": 80, "https": 443}.get(parsed.scheme)
    ):
        raise ValueError("공개 http 또는 https 주소를 입력해 주세요.")
    private = host == "localhost" or host.endswith((".localhost", ".local"))
    if re.fullmatch(r"[0-9]+(?:\.[0-9]+){3}", host):
        first, second, *_ = map(int, host.split("."))
        private |= (
            first in (0, 10, 127)
            or (first == 100 and 64 <= second <= 127)
            or (first == 169 and second == 254)
            or (first == 172 and 16 <= second <= 31)
            or (first == 192 and second == 168)
        )
    if host.startswith("["):
        ipv6 = host[1:-1]
        private |= (
            ipv6 in ("::", "::1") or re.match(r"^(f[cd]|fe[89ab])", ipv6) is not None
        )
    if private:
        raise ValueError("공개 http 또는 https 주소를 입력해 주세요.")
    return value


class AppInput(StrictModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str
    url: str
    prompt: str
    description: str
    subject: str
    grades: list[str]
    is_public: bool
    theme_id: str
    stack_db: str | None
    stack_backend: str | None
    stack_frontend: str | None
    stack_hosting: str | None

    @model_validator(mode="after")
    def normalize_input(self):
        fields = {}
        for field, maximum, options in (
            ("name", 100, {"trim": True, "nfc": True, "required": True}),
            ("prompt", 30000, {"multiline": True, "required": True}),
            ("description", 20000, {"multiline": True, "required": True}),
            *(
                (field, 200, {"trim": True, "nfc": True})
                for field in (
                    "stack_db",
                    "stack_backend",
                    "stack_frontend",
                    "stack_hosting",
                )
            ),
        ):
            if (value := getattr(self, field)) is None:
                continue
            try:
                cleaned = clean_text(value, maximum, **options)
                setattr(
                    self,
                    field,
                    (cleaned or None) if field.startswith("stack_") else cleaned,
                )
            except ValueError as error:
                fields[field] = str(error)
        try:
            self.url = validate_url(self.url)
        except ValueError:
            fields["url"] = "공개 http 또는 https 주소를 입력해 주세요."
        if self.subject not in CATALOG["subjects"]:
            fields["subject"] = "교과 과목을 선택해 주세요."
        if self.theme_id not in {theme["id"] for theme in CATALOG["themes"]}:
            fields["theme_id"] = "테마를 선택해 주세요."
        if (
            not self.grades
            or len(self.grades) > 12
            or len(set(self.grades)) != len(self.grades)
            or any(grade not in CATALOG["grades"] for grade in self.grades)
        ):
            fields["grades"] = "서로 다른 적용 학년을 하나 이상 선택해 주세요."
        if fields:
            raise AuthError("VALIDATION_ERROR", 422, fields=fields)
        self.grades = [grade for grade in CATALOG["grades"] if grade in self.grades]
        return self

    def request_hash(self):
        wire = json.dumps(
            self.model_dump(),
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
            allow_nan=False,
        )
        return hashlib.sha256(wire.encode("utf-8")).hexdigest()
