"""Policy for new nicknames; stored names are not revalidated."""

from unicodedata import category, normalize


def normalize_nickname(raw: str) -> str:
    if any(category(char) in {"Cc", "Cf", "Cs", "Zl", "Zp"} for char in raw):
        raise ValueError(
            "Nickname must contain 2 to 20 visible characters without controls."
        )
    nickname = normalize("NFC", raw.strip())
    if not 2 <= len(nickname) <= 20 or not any(
        category(char)[0] not in "CZM" for char in nickname
    ):
        raise ValueError(
            "Nickname must contain 2 to 20 visible characters without controls."
        )
    return nickname
