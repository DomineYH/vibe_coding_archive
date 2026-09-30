"""Forward selected failed tests through the unchanged owned API E2E runner."""

import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[5]
runner = root / "frontend/scripts/test-api-e2e.mjs"
source = runner.read_text()
arguments = '["test", "--config=playwright.api.config.js"]'
assert source.count(arguments) == 1
assert sys.argv[1:], "Specify failed test locations; do not repeat the full suite"
source = source.replace(
    arguments, json.dumps(["test", "--config=playwright.api.config.js", *sys.argv[1:]])
)
source = source.replace("import.meta.url", json.dumps(runner.as_uri()))
raise SystemExit(
    subprocess.run(
        ["node", "--input-type=module", "--eval", source],
        cwd=root / "frontend",
        env=os.environ,
        check=False,
    ).returncode
)
