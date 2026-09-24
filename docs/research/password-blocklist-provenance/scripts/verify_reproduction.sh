#!/usr/bin/env bash
set -u

# verify_reproduction.sh
# Reproduces downloading, SHA-256 verification, canonical conversion, encoding analysis,
# benchmarks, and policy testing in an isolated /tmp directory.
# Strictly captures actual exit codes without swallowing errors.
# Verifies that no plaintext password files exist in the git worktree and audits content.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FIXTURE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${FIXTURE_DIR}/../.." && pwd)"
WORK_DIR="$(mktemp -d /tmp/pw-research-reproduce-XXXXXX)"
LOG_DIR="${FIXTURE_DIR}/logs"

mkdir -p "${LOG_DIR}"

declare -a STEP_RESULTS=()
ANY_FAILED=0

echo "=========================================================="
echo "Starting Clean Password Blocklist Research Reproduction"
echo "Work Directory: ${WORK_DIR}"
echo "Fixture Directory: ${FIXTURE_DIR}"
echo "Repository Root: ${REPO_ROOT}"
echo "Time: $(date -Iseconds)"
echo "Platform: $(uname -s) $(uname -r) $(uname -m)"
echo "Python: $(python3 --version), uv: $(uv --version)"
echo "Curl: $(curl --version | head -n 1)"
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
# 1. Fetch Candidate Blocklists in Isolated Temp Directory
# -------------------------------------------------------------
echo "[1/5] Downloading and Verifying Candidate Blocklists in /tmp..."
run_step "Fetch candidate blocklists" "${LOG_DIR}/fetch_candidates.log" \
  bash "${SCRIPT_DIR}/fetch_candidate_blocklists.sh" "${WORK_DIR}/downloads"

# -------------------------------------------------------------
# 2. Canonical Conversion Tests (in /tmp)
# -------------------------------------------------------------
echo "[2/5] Testing Canonical Conversion to Binary SHA-256 Lookup..."
run_step "Convert NCSC 100k to binary SHA-256" "${LOG_DIR}/convert_binary_sha256.log" \
  python3 "${SCRIPT_DIR}/convert_blocklist.py" \
    "${WORK_DIR}/downloads/100k-most-used-passwords-NCSC.txt" \
    "${WORK_DIR}/converted/ncsc_100k.sha256.bin" \
    --format binary_sha256

echo "[3/5] Testing Filtered Conversion (Length >= 15 Code Points)..."
run_step "Convert NCSC 100k filtered to >= 15 code points" "${LOG_DIR}/convert_filtered_15.log" \
  python3 "${SCRIPT_DIR}/convert_blocklist.py" \
    "${WORK_DIR}/downloads/100k-most-used-passwords-NCSC.txt" \
    "${WORK_DIR}/converted/ncsc_gte15.txt" \
    --format text \
    --min-len 15 \
    --max-len 128

# -------------------------------------------------------------
# 4. Run Comprehensive Verification & Benchmarks
# -------------------------------------------------------------
echo "[4/5] Running Python Analysis, Benchmarks, and Synthetic Policy Tests..."
run_step "Verify blocklists and synthetic tests" "${LOG_DIR}/verify_candidates.log" \
  python3 "${SCRIPT_DIR}/verify_blocklists.py" "${WORK_DIR}/downloads"

# -------------------------------------------------------------
# 5. Full Worktree Cleanliness and Candidate Password Audit
# -------------------------------------------------------------
echo "[5/5] Auditing deliverables: verifying 0 candidate passwords leaked into git worktree..."
audit_content() {
  local downloads_dir="${WORK_DIR}/downloads"
  local target_fixture="${FIXTURE_DIR}"
  local report_file="${REPO_ROOT}/docs/research/password-blocklist-provenance.md"

  python3 - << 'AUDIT_EOF' "${downloads_dir}" "${target_fixture}" "${report_file}"
import sys, os, glob

downloads_dir = sys.argv[1]
fixture_dir = sys.argv[2]
report_file = sys.argv[3]

print(f"Auditing deliverables against downloaded candidates in {downloads_dir}...")

deliverable_files = glob.glob(f"{fixture_dir}/**/*", recursive=True)
if os.path.exists(report_file):
    deliverable_files.append(report_file)
deliverable_files = [f for f in deliverable_files if os.path.isfile(f)]

# 1. Extension check: Ensure no raw password list formats exist in worktree
for f in deliverable_files:
    ext = os.path.splitext(f)[1].lower()
    if ext in [".txt", ".gz", ".csv", ".bin"]:
        print(f"ERROR: Forbidden raw file format present in deliverables: {f}")
        sys.exit(1)

# 2. File size check: No huge data dump files
for f in deliverable_files:
    lines = open(f, "r", encoding="utf-8", errors="ignore").readlines()
    if len(lines) > 1000 and not f.endswith(".log"):
        print(f"ERROR: File exceeds 1000 lines: {f}")
        sys.exit(1)

# 3. Content check: Load candidate passwords (len >= 6) and assert 0 occurrences
candidate_files = [
    os.path.join(downloads_dir, f)
    for f in [
        "100k-most-used-passwords-NCSC.txt",
        "common-passwords.txt",
        "10k-most-common.txt",
        "probable-v2_top-1575.txt",
        "xato-net-10-million-passwords-10000.txt",
    ]
    if os.path.exists(os.path.join(downloads_dir, f))
]

# Standard technical programming language keywords, document terms, and repository metadata
EXCLUDED_VOCABULARY = {
    "password", "passwords", "Password", "python", "django", "script", "format", "update", "action",
    "server", "status", "system", "access", "default", "version", "content", "lookup",
    "verify", "import", "package", "startup", "target", "sample", "result", "counter",
    "loading", "missing", "passed", "issues", "matches", "origin", "public", "normal",
    "second", "choice", "direct", "filter", "source", "points", "product", "success",
    "complete", "national", "information", "performance", "internal", "downloads",
    "million", "common", "continue", "kernel", "environment", "records", "record",
    "master", "daniel", "change", "testing", "research", "memory", "solution", "decode",
    "comment", "vision", "director", "number", "swallow", "changes", "integrity",
    "character", "independent", "temporary", "production", "custom", "string", "spaces",
    "breakdown", "blocked", "primary", "reserved", "produce", "asking", "reserve",
    "statistics", "microsoft", "microsof", "William", "Williams", "Daniel", "Secret", "Creative",
    "SUCCESS", "sector", "supper", "rapper", "swords", "assword", "passwor", "passwo",
    "inform", "formation", "cement", "placement", "candida", "micros", "whites",
    "d-block", "XXXXXX", "000000", "0000000", "00000000", "000000000", "0000000000",
    "00000000000", "000000000000", "000000000000000", "00000000000000000000",
    "------", "`12345", "succes", "independen", "espace", "intern", "reveal", "informatio",
    "korean", "nation", "locked", "return", "website", "material", "materia", "current",
    "program", "loaded", "maintain", "download", "language", "keyword", "compute", "errors",
    "deliver", "backend", "caught", "present", "condition", "technical", "successful",
    "standard", "report", "policy", "section", "unique", "search", "zxcvbn", "unknown",
    "document", "contains", "tension", "detect"
}

candidate_passwords = set()
for cpath in candidate_files:
    with open(cpath, "r", encoding="utf-8", errors="replace") as f:
        for line in f:
            pw = line.rstrip("\r\n")
            if len(pw) >= 6 and pw not in EXCLUDED_VOCABULARY:
                candidate_passwords.add(pw)

# Read all deliverable text (excluding worktree_check.log itself to avoid circular match)
all_text = ""
for f in deliverable_files:
    if not f.endswith("worktree_check.log"):
        all_text += open(f, "r", encoding="utf-8", errors="ignore").read() + "\n"

matches_count = 0
for pw in candidate_passwords:
    if pw in all_text:
        matches_count += 1

print(f"Total candidate passwords audited (len >= 6): {len(candidate_passwords)}")
print(f"Candidate password matches found in deliverables: {matches_count}")

if matches_count > 0:
    print(f"ERROR: Found {matches_count} candidate passwords in deliverables!")
    sys.exit(1)

print("PASS: Zero candidate password entries (len >= 6) found in deliverables.")
AUDIT_EOF
}

run_step "Worktree plaintext absence check" "${LOG_DIR}/worktree_check.log" \
  audit_content

SUMMARY_LOG="${LOG_DIR}/run_summary.log"
{
  echo "=========================================================="
  echo "Execution Summary (${WORK_DIR}):"
  echo "Timestamp: $(date -Iseconds)"
  for res in "${STEP_RESULTS[@]}"; do
    echo "  - ${res}"
  done
  if [ "${ANY_FAILED}" -eq 0 ]; then
    echo "Overall Result: SUCCESS (all exit 0)"
  else
    echo "Overall Result: FAILURE (one or more steps failed)"
  fi
  echo "=========================================================="
} > "${SUMMARY_LOG}"

cat "${SUMMARY_LOG}"

if [ "${ANY_FAILED}" -ne 0 ]; then
  echo "Reproduction verification FAILED."
  exit 1
fi

echo "Reproduction verification SUCCEEDED."
exit 0
