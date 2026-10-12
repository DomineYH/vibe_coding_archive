import json
from pathlib import Path

import pytest

from app.nickname_policy import normalize_nickname

CASES = json.loads(
    (
        Path(__file__).resolve().parents[2] / "contracts/fixtures/nickname-cases.json"
    ).read_text()
)


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_new_nickname_policy(case):
    if case["normalized"] is None:
        with pytest.raises(ValueError):
            normalize_nickname(case["raw"])
    else:
        assert normalize_nickname(case["raw"]) == case["normalized"]
