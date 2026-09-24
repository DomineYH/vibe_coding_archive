#!/usr/bin/env bash
set -euo pipefail

# fetch_candidate_blocklists.sh
# Downloads candidate password blocklists into target directory,
# decompresses compressed files, and strictly verifies SHA-256 checksums.
# Usage: ./fetch_candidate_blocklists.sh <target_dir>

TARGET_DIR="${1:-/tmp/pw-research-download}"
mkdir -p "${TARGET_DIR}"

echo "Fetching candidate blocklists to ${TARGET_DIR}..."

# 1. SecLists NCSC 100k
echo "[1/5] Fetching SecLists NCSC 100k..."
curl -sSfL -o "${TARGET_DIR}/100k-most-used-passwords-NCSC.txt" \
  "https://raw.githubusercontent.com/danielmiessler/SecLists/190c6f7bd58c847ceadfe57d9853592737f059e8/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt"

# 2. Django common-passwords.txt.gz
echo "[2/5] Fetching Django common-passwords.txt.gz..."
curl -sSfL -o "${TARGET_DIR}/common-passwords.txt.gz" \
  "https://raw.githubusercontent.com/django/django/727731d76d9dfd5304d536478d862778f6dd6d9b/django/contrib/auth/common-passwords.txt.gz"

echo "[2b/5] Decompressing Django common-passwords.txt.gz..."
gzip -dc "${TARGET_DIR}/common-passwords.txt.gz" > "${TARGET_DIR}/common-passwords.txt"

# 3. SecLists 10k-most-common
echo "[3/5] Fetching SecLists 10k-most-common.txt..."
curl -sSfL -o "${TARGET_DIR}/10k-most-common.txt" \
  "https://raw.githubusercontent.com/danielmiessler/SecLists/190c6f7bd58c847ceadfe57d9853592737f059e8/Passwords/Common-Credentials/10k-most-common.txt"

# 4. SecLists probable-v2_top-1575
echo "[4/5] Fetching SecLists probable-v2_top-1575.txt..."
curl -sSfL -o "${TARGET_DIR}/probable-v2_top-1575.txt" \
  "https://raw.githubusercontent.com/danielmiessler/SecLists/190c6f7bd58c847ceadfe57d9853592737f059e8/Passwords/Common-Credentials/probable-v2_top-1575.txt"

# 5. SecLists xato-net-10-million-passwords-10000
echo "[5/5] Fetching SecLists xato-net-10-million-passwords-10000.txt..."
curl -sSfL -o "${TARGET_DIR}/xato-net-10-million-passwords-10000.txt" \
  "https://raw.githubusercontent.com/danielmiessler/SecLists/190c6f7bd58c847ceadfe57d9853592737f059e8/Passwords/Common-Credentials/xato-net-10-million-passwords-10000.txt"

echo "Verifying SHA-256 hashes..."
cd "${TARGET_DIR}"

cat << 'CHECKSUMS' > checksums.sha256
c2e5696882c603b76bb67a47ee970897e5a76fc4c3f5547abe3d0ca340c576e0  100k-most-used-passwords-NCSC.txt
3c1baed62596de36860824eb3f436d5932d37ca8b06e59df78f5a44ec175afe4  common-passwords.txt.gz
29ca0fa5303165f012f3e9775e3e95a3071cdd59f219973ec1cbb308d0214a6f  common-passwords.txt
4adb3f0afb4a10cf19ebe48d8c69a46f934bbc8d77c694c210564f9583e7f4ba  10k-most-common.txt
3ce41d89e5e75075f3e73ebf1b32121dd873510f2b242dc69c177707ade06dbb  probable-v2_top-1575.txt
c63d5e4ccc31344d662583cc39ca4bd5bd20517ff1d24501f0c4e0c22d9b722a  xato-net-10-million-passwords-10000.txt
CHECKSUMS

# Execute verification strictly without masking return code
sha256sum -c checksums.sha256
