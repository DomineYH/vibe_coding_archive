"""Check this handover's paths, protected bytes, links and safe text evidence."""

import ast
import hashlib
import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[4]
base = "53652f750c3b67fb9513ac4f919dde136d1da955"
allowed = {
    "docs/acceptance.md",
    "frontend/scripts/test-seeded-dev-ui.mjs",
    "frontend/e2e-api/apps.spec.js",
}
prefix = here.relative_to(root).as_posix() + "/"


def git(*arguments):
    return subprocess.run(
        ["git", *arguments], cwd=root, text=True, capture_output=True, check=True
    ).stdout.splitlines()


changed = git("diff", "--name-only", base)
untracked = git("ls-files", "--others", "--exclude-standard")
assert all(p in allowed or p.startswith(prefix) for p in changed + untracked)
protected = json.loads((here / "environment.json").read_text())[
    "lock_and_protected_hashes"
]
for file, expected in protected.items():
    assert hashlib.sha256((root / file).read_bytes()).hexdigest() == expected, file
assert not git(
    "diff",
    "--name-only",
    base,
    "--",
    "docs/evidence/phase-2/issue81",
    "docs/evidence/phase-2/issue82",
    "docs/evidence/phase-2/issue83",
)
passwords = set(
    re.findall(
        r'password:\s*"([^"]+)"',
        (root / "frontend/src/services/mock/accounts.ts").read_text(),
    )
)
for node in ast.walk(ast.parse((root / "backend/tests/test_dev_seed.py").read_text())):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        value = node.value
        if (
            ("-password" in value.lower() or value.endswith("-hash"))
            and "\n" not in value
            and len(value) < 150
        ):
            passwords.add(value)
passwords = {
    p
    for p in passwords
    if p not in {"password", "password_hash"}
    and not p.endswith(": ")
    and not p.startswith(("SELECT ", "nickname ="))
}
files = [p for p in here.rglob("*") if p.is_file()]
text_files = [p for p in files if p.suffix in {".md", ".json", ".log", ".mjs", ".py"}]
for file in files:
    assert file.suffix not in {
        ".db",
        ".sqlite",
        ".sqlite3",
        ".wal",
        ".shm",
        ".bak",
        ".har",
        ".zip",
    }, file
    assert not file.name.startswith(".env"), file
for file in text_files:
    text = file.read_text()
    # Exact known fixture secrets, including intentionally weak demo values.
    assert not any(
        secret in text
        if len(secret) >= 8
        else re.search(r"[\"']" + re.escape(secret) + r"[\"']", text)
        for secret in passwords
    ), file
    assert not re.search(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}", text), file
    assert not re.search(r"(?:Set-Cookie|Cookie|X-CSRF-Token):\s*\S+", text), file
    assert not re.search(r"\$argon2(?:id|i|d)\$v=", text), file
inventory = json.loads((here / "capture-inventory.json").read_text())
records = inventory["records"]
committed = [record for record in records if record["committed"]]
omitted = [record for record in records if not record["committed"]]
assert len(records) == inventory["captured_pngs"] == 241
assert len(committed) == inventory["committed_pngs"] == 26
assert len(omitted) == inventory["not_committed_pngs"] == 215
assert {
    file.relative_to(here).as_posix() for file in files if file.suffix == ".png"
} == {record["path"] for record in committed}
for record in records:
    assert record["state"] and len(record["requested_viewport"]) == 2
    assert re.fullmatch(r"[a-f0-9]{64}", record["sha256"])
    capture = here / record["path"]
    if record["committed"]:
        data = capture.read_bytes()
        assert len(data) == record["bytes"]
        assert hashlib.sha256(data).hexdigest() == record["sha256"], capture
    else:
        assert not capture.exists(), capture
        assert record["retention"] == "로컬에서 생성·확인했으나 커밋하지 않음"
assert sum(record["bytes"] for record in committed) == inventory["committed_png_bytes"]
evidence_limit = 10_000_000
assert sum(file.stat().st_size for file in files) <= evidence_limit
links = 0
markdown_files = sorted(here.rglob("*.md")) + [root / "docs/acceptance.md"]
for file in markdown_files:
    text = file.read_text()
    if file.name == "acceptance.md":
        text = text.split("## Issue #85 Phase 2 local handover", 1)[1]
    for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
        if target.startswith(("https://", "http://")):
            continue
        relative, _, fragment = target.partition("#")
        resolved = file.parent / relative
        assert resolved.exists(), (file.name, target)
        if fragment and resolved.suffix == ".md":
            headings = re.findall(
                r"^#{1,6}\s+(.+)$", resolved.read_text(), re.MULTILINE
            )
            anchors = {
                re.sub(r"[^\w -]", "", heading.lower()).replace(" ", "-")
                for heading in headings
            }
            assert fragment in anchors, (file.name, target)
        links += 1
trace = (here / "traceability.md").read_text()
counts = {
    "user_stories": len(re.findall(r"^\| #77 US-\d+", trace, re.MULTILINE)),
    "ui_d": len(re.findall(r"^\| UI-D\d+", trace, re.MULTILINE)),
    "cases": len(re.findall(r"^\| #8 case \d+", trace, re.MULTILINE)),
}
assert counts == {"user_stories": 37, "ui_d": 9, "cases": 17}
required = [
    r
    for r in json.loads((here / "commands.json").read_text())["invocations"]
    if r["required_first_invocation"]
]
assert len(required) == len({r["name"] for r in required}) == 13
report = {
    "result": "PASS",
    "executed_utc": datetime.now(timezone.utc).isoformat(),
    "command": "python3 docs/evidence/phase-2/issue85/2026-09-30/audit.py",
    "tracked_change_allowlist": sorted(allowed),
    "evidence_prefix": prefix,
    "files_inspected": len(files),
    "text_files_scanned": len(text_files),
    "protected_hashes_equal": True,
    "prior_tracked_api_captures_restored": True,
    "forbidden_file_or_known_credential_hits": 0,
    "local_links_resolved": links,
    "markdown_files_checked": len(markdown_files),
    "generated_pngs": len(records),
    "committed_pngs": len(committed),
    "not_committed_pngs": len(omitted),
    "committed_png_bytes": inventory["committed_png_bytes"],
    "capture_hashes_and_retention_verified": True,
    "evidence_limit_bytes": evidence_limit,
    "evidence_bytes_under_limit": True,
    "traceability_counts": counts,
    "required_first_invocations": len(required),
    "first_invocation_failures": [r["name"] for r in required if r["exit_code"]],
    "binary_limit": "PNG safety uses public-only capture sources and agent visual inspection, not OCR or arbitrary-secret detection.",
    "operations_limit": "Repository/evidence/build inspection; no hosted static-server or backup-security claim.",
}
(here / "asset-audit.json").write_text(json.dumps(report, indent=2) + "\n")
evidence_bytes = sum(file.stat().st_size for file in files)
assert evidence_bytes <= evidence_limit
print(
    f"PASS: {evidence_bytes} bytes; {len(committed)} PNGs attached / {len(omitted)} manifest-only; "
    f"{len(files)} evidence files; {links} local links; 37 US / 9 UI-D / 17 cases; 13 required invocations"
)
