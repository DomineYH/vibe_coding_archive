#!/usr/bin/env bash
set -euo pipefail
script=$(realpath "$0")
lock=/tmp/claude-1000/-mnt-c-dev-vibe-coding-archive/f8bf8397-dea2-4b0b-ac26-c2b6e5aea7f6/scratchpad/playwright.lock
if [[ "${1:-}" != --locked ]]; then
  exec flock "$lock" bash "$script" --locked "$@"
fi
shift
cd "$(dirname "$script")/../../.."
mode=${1:?mode required: auth-gate, stress, stress-warm, network-delay}
repeat=${2:-1}
case "$mode" in auth-gate|stress|stress-warm|network-delay) ;; *) exit 2 ;; esac
if ss -H -ltn '( sport = :5173 or sport = :5174 or sport = :8000 )' | rg -q .; then
  echo PORT_OCCUPIED
  exit 2
fi
original=visual/app-create.spec.js
grep='app registration form at 1024x900'
if [[ "$mode" == auth-gate ]]; then
  original=visual/gallery.spec.js
  grep='gallery-loading matches its baseline at 1440x1000'
fi
copy=visual/issue91-loop.spec.js
if [[ -e "$copy" ]]; then echo DIAGNOSTIC_COPY_EXISTS; exit 2; fi
trap 'rm -f "$copy"; ss -H -ltn "( sport = :5173 or sport = :5174 or sport = :8000 )"' EXIT
python3 - "$original" "$copy" <<'PY'
from pathlib import Path
import sys
source = Path(sys.argv[1]).read_text().replace(
    'import { expect, test } from "@playwright/test";',
    'import { expect } from "@playwright/test";\nimport { test } from "../scripts/debug/issue91/fixtures.js";')
Path(sys.argv[2]).write_text(source)
PY
env -u VISUAL_BASELINE_CAPTURE \
  PLAYWRIGHT_CHROMIUM_EXECUTABLE="${PLAYWRIGHT_CHROMIUM_EXECUTABLE:-/tmp/issue85-run/chrome/chrome-headless-shell-linux64/chrome-headless-shell}" \
  FONTCONFIG_FILE="$PWD/visual/fontconfig.conf" ISSUE91_MODE="$mode" EVIDENCE_RUN="${ISSUE91_RUN:-$mode}" \
  npx playwright test --config=playwright.visual.config.js "$copy" --grep "$grep" \
  --repeat-each="$repeat" --retries=0 --workers=1 --max-failures="${ISSUE91_MAX_FAILURES:-1}" \
  --global-timeout=600000 --reporter=list,./scripts/debug/issue91/timing-reporter.js
