#!/usr/bin/env bash
set -u

# verify_reproduction.sh
# Reproduces clean installation, lockfile verification, linting, type-checking,
# testing, building, and security auditing in isolated /tmp directories.
# Captures exact exit codes for every command without swallowing errors.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${FIXTURE_DIR}/../.." && pwd)"
WORK_DIR="$(mktemp -d /tmp/deps-verify-reproduce-XXXXXX)"
LOG_DIR="${FIXTURE_DIR}/logs"

mkdir -p "${LOG_DIR}"

declare -a STEP_RESULTS=()
ANY_FAILED=0

echo "=========================================================="
echo "Starting Clean Reproduction & Verification"
echo "Work Directory: ${WORK_DIR}"
echo "Fixture Directory: ${FIXTURE_DIR}"
echo "Time: $(date -Iseconds)"
echo "Platform: $(uname -s) $(uname -r) $(uname -m)"
echo "Node: $(node -v), npm: $(npm -v)"
echo "Python: $(python3 --version), uv: $(uv --version)"
echo "Chrome: $(/usr/bin/google-chrome --version 2>/dev/null || echo 'Not found')"
echo "=========================================================="

cleanup() {
  echo "Cleaning up temporary directory ${WORK_DIR}..."
  rm -rf "${WORK_DIR}"
}
trap cleanup EXIT

run_step() {
  local step_name="$1"
  local log_file="$2"
  shift 2
  local rc=0
  echo -n "  -> Running ${step_name}... "
  "$@" > "${log_file}" 2>&1 || rc=$?
  echo "exit code: ${rc}"
  STEP_RESULTS+=("${step_name}: exit ${rc}")
  if [ "${rc}" -ne 0 ]; then
    ANY_FAILED=1
  fi
  return "${rc}"
}

# -------------------------------------------------------------
# 1. Frontend Verification
# -------------------------------------------------------------
echo "[1/2] Verifying Frontend Clean Installation and Toolchain..."
FRONTEND_TMP="${WORK_DIR}/frontend"
mkdir -p "${FRONTEND_TMP}"
cp -a "${FIXTURE_DIR}/frontend/." "${FRONTEND_TMP}/"
mkdir -p "${FRONTEND_TMP}/contracts"
cp "${FIXTURE_DIR}/contracts/openapi.yaml" "${FRONTEND_TMP}/contracts/openapi.yaml"

cd "${FRONTEND_TMP}"

run_step "Frontend npm ci" "${LOG_DIR}/frontend_npm_ci.log" npm ci
run_step "Frontend OpenAPI lint (redocly)" "${LOG_DIR}/frontend_openapi_lint.log" npx redocly lint contracts/openapi.yaml
run_step "Frontend OpenAPI TypeScript generate" "${LOG_DIR}/frontend_openapi_generate.log" npx openapi-typescript contracts/openapi.yaml -o src/contracts/api.d.ts
run_step "Frontend OpenAPI generated diff check" "${LOG_DIR}/frontend_openapi_diff.log" diff -u src/contracts/api.d.ts "${FIXTURE_DIR}/frontend/src/contracts/api.d.ts"
run_step "Frontend TypeScript typecheck (tsc)" "${LOG_DIR}/frontend_tsc.log" npx tsc --noEmit
run_step "Frontend ESLint" "${LOG_DIR}/frontend_eslint.log" npx eslint .
run_step "Frontend Prettier check" "${LOG_DIR}/frontend_prettier.log" npx prettier --check .
run_step "Frontend Vitest unit/component tests" "${LOG_DIR}/frontend_vitest.log" npx vitest run
run_step "Frontend Vite production build" "${LOG_DIR}/frontend_vite_build.log" npx vite build
run_step "Frontend Playwright E2E smoke test" "${LOG_DIR}/frontend_playwright.log" npx playwright test
run_step "Frontend npm audit" "${LOG_DIR}/frontend_npm_audit.log" npm audit

# -------------------------------------------------------------
# 2. Backend Verification
# -------------------------------------------------------------
echo "[2/2] Verifying Backend Clean Installation and Toolchain..."
BACKEND_TMP="${WORK_DIR}/backend"
mkdir -p "${BACKEND_TMP}"
cp -a "${FIXTURE_DIR}/backend/." "${BACKEND_TMP}/"

cd "${BACKEND_TMP}"

run_step "Backend uv venv (Python 3.12.3)" "${LOG_DIR}/backend_uv_venv.log" uv venv --python 3.12.3
run_step "Backend uv sync --locked" "${LOG_DIR}/backend_uv_sync.log" uv sync --locked
run_step "Backend uv run ruff check" "${LOG_DIR}/backend_ruff_check.log" uv run --frozen ruff check .
run_step "Backend uv run ruff format check" "${LOG_DIR}/backend_ruff_format.log" uv run --frozen ruff format --check .
run_step "Backend uv run pytest" "${LOG_DIR}/backend_pytest.log" uv run --frozen pytest -v
run_step "Backend uv audit" "${LOG_DIR}/backend_uv_audit.log" uv audit

SUMMARY_LOG="${LOG_DIR}/run_summary.log"
{
  echo "=========================================================="
  echo "Execution Summary (${WORK_DIR}):"
  echo "Timestamp: $(date -Iseconds)"
  for res in "${STEP_RESULTS[@]}"; do
    echo "  - ${res}"
  done
  echo "Overall Result: $([ "${ANY_FAILED}" -eq 0 ] && echo "SUCCESS (all exit 0)" || echo "FAILURE")"
  echo "=========================================================="
} | tee "${SUMMARY_LOG}"

if [ "${ANY_FAILED}" -ne 0 ]; then
  echo "Verification finished with one or more failures."
  exit 1
else
  echo "All verifications completed successfully with exit code 0."
  exit 0
fi
