from unicodedata import normalize

import pytest

from app.auth_boundary import AuthError
from app.password_policy import LOGIN_ID_MESSAGE, new_password, same_as_login_id

BLOCKLIST = frozenset({"synthetic-blocked-entry-15"})
LOGIN = "Teacher-Login-Id-15"


def rejected(value, login_id=LOGIN, blocklist=BLOCKLIST):
    with pytest.raises(AuthError) as error:
        new_password(value, blocklist, login_id=login_id)
    assert error.value.status == 422
    assert error.value.fields.keys() == {"password"}
    return error.value.fields["password"]


@pytest.mark.parametrize(
    "value",
    [
        LOGIN,
        LOGIN.lower(),
        LOGIN.upper(),
        "teacher-LOGIN-id-15",
    ],
)
def test_password_equal_to_login_id_ignoring_ascii_case_is_rejected(value):
    assert rejected(value) == LOGIN_ID_MESSAGE


def test_normalization_form_and_login_id_whitespace_do_not_hide_equality():
    login = "한글교사아이디열다섯자이상입니다"
    assert rejected(normalize("NFD", login), login) == LOGIN_ID_MESSAGE
    assert rejected(login, f" {login} ") == LOGIN_ID_MESSAGE


@pytest.mark.parametrize(
    "value",
    [
        f"{LOGIN}-extra",
        f"x{LOGIN}",
        f" {LOGIN}",
        f"{LOGIN} ",
    ],
)
def test_other_passwords_containing_the_login_id_are_allowed(value):
    assert new_password(value, BLOCKLIST, login_id=LOGIN) == normalize("NFC", value)


def test_short_login_id_inside_a_longer_password_is_allowed():
    assert (
        new_password("short-id-inside-a-long-password", BLOCKLIST, login_id="short-id")
        == "short-id-inside-a-long-password"
    )


def test_unknown_login_id_skips_the_rule():
    assert new_password(LOGIN, BLOCKLIST, login_id=None) == LOGIN


def test_login_id_is_a_required_keyword():
    with pytest.raises(TypeError):
        new_password("a valid synthetic password", BLOCKLIST)
    with pytest.raises(TypeError):
        new_password("a valid synthetic password", BLOCKLIST, LOGIN)


def test_length_then_blocklist_win_over_login_id_equality():
    short = "short-id-14-ch"
    assert rejected(short, short) == "비밀번호는 15~128자로 입력해 주세요."
    blocked = "synthetic-blocked-entry-15"
    assert rejected(blocked, blocked) == "흔한 비밀번호는 사용할 수 없습니다."


def test_same_as_login_id_folds_only_ascii_letters():
    assert same_as_login_id("ABC가나다", "abc가나다")
    assert not same_as_login_id("abc가나다", "abc가나다1")
    # Full Unicode case folding would equate these; the rule is ASCII-only.
    assert not same_as_login_id("É", "é")
