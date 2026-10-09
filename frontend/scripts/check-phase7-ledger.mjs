import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const range = (prefix, length) =>
  Array.from(
    { length },
    (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`,
  );
export const REQUIRED_IDS = [
  ...range("P7-", 7),
  ...range("T-UI-", 3),
  ...range("T-AUTH-", 3),
  ...range("T-ACL-", 2),
  ...range("T-APP-", 2),
  "T-ADMIN-01",
  ...range("T-HEALTH-", 3),
  "T-DATA-01",
  "T-OPS-01",
  ...range("PERF-", 12),
  ...range("PRIVACY-", 19),
  ...range("DEPLOY-", 17),
  ...range("UI-D", 9),
  ...range("R23-", 29),
  ...range("R24-", 29),
  ...[
    "egress_dns_tls",
    "http_headers_deadline",
    "resource_cleanup_concurrency",
    "supervisor_single_worker",
    "clock_suspend",
    "database_fencing_recovery",
    "api_batch_retention",
    "disable_reenable",
  ].map((group) => `HOST-${group}`),
  "G01-G18",
  ...range("AC", 7),
  ...range("T", 8),
  "SUPPORT-unset",
  "SUPPORT-valid",
  "SUPPORT-invalid",
  "SUPPORT-production",
  "SUPPORT-approval",
  "MANUAL-viewports",
  "MANUAL-accessibility",
  "AUTOMATED-accessibility",
  "HTTPS-normal",
  "HTTPS-support",
  "HTTPS-restore",
  "HTTPS-health",
  "HTTPS-static",
  "HTTPS-not-selected",
  ...[
    "backend-lint",
    "backend-format",
    "backend-pytest",
    "age",
    "frontend-check",
    "vitest",
    "mock-e2e",
    "api-e2e",
    "visual",
    "build-mock",
    "build-api",
    "dist",
    "reference",
  ].map((name) => `RUN-${name}`),
];
const manualStates = [
  "gallery/loading/paging/empty/long list",
  "public detail/long name/URL/prompt",
  "private detail/hidden/recheck",
  "auth login/errors",
  "auth signup/pending/errors",
  "auth support unset/configured/invalid",
  "auth reauthentication/change-only/errors",
  "administrator approval/long list/errors",
  "administrator reset/unknown result",
  "administrator deletion/cascade",
  "administrator monitor/controlled health/errors",
  "app create/dirty/error",
  "app edit/conflict/dirty/error",
  "app delete/confirm/error",
];
const manualViewports = [
  "1440x1000",
  "1024x900",
  "768x1024",
  "390x844",
  "360x844",
];
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
export function currentLockHashes() {
  return Object.fromEntries(
    [
      ["backend", "backend/uv.lock"],
      ["frontend", "frontend/package-lock.json"],
    ].map(([name, file]) => [
      name,
      createHash("sha256")
        .update(readFileSync(path.join(root, file)))
        .digest("hex"),
    ]),
  );
}
const require_ = (condition, message) => {
  if (!condition) throw new Error(message);
};
const nonempty = (value) =>
  typeof value === "string" && value.trim().length > 0;
const unique = (values) => new Set(values).size === values.length;

export function validateLedger(
  ledger,
  { requiredIds = REQUIRED_IDS, lockHashes = currentLockHashes() } = {},
) {
  require_(Array.isArray(ledger.rows), "Missing rows");
  for (const row of ledger.rows) {
    const c = row.count;
    require_(
      c &&
        ["collected", "executed", "passed", "failed", "skipped"].every(
          (key) => Number.isSafeInteger(c[key]) && c[key] >= 0,
        ),
      "Missing or invalid count",
    );
    require_(
      c.passed + c.failed === c.executed &&
        c.executed + c.skipped === c.collected,
      "Count mismatch",
    );
    require_(
      ["PASS", "FAIL", "NOT RUN", "BLOCKED"].includes(row.result),
      "Invalid result",
    );
    if (row.result === "PASS")
      require_(
        c.executed > 0 &&
          !c.failed &&
          !c.skipped &&
          c.passed === c.executed &&
          c.collected === c.executed,
        "Invalid PASS counts",
      );
    if (row.result === "FAIL")
      require_(c.failed > 0, "FAIL needs observed failure");
    if (["NOT RUN", "BLOCKED"].includes(row.result))
      require_(
        !c.executed &&
          !c.passed &&
          !c.failed &&
          nonempty(row.reason) &&
          nonempty(row.owner),
        "Unexecuted row needs reason and owner",
      );
    require_(
      [
        "row_id",
        "item_id",
        "source",
        "applicability",
        "layer",
        "command",
        "cwd",
        "expected",
        "binding_id",
        "owner",
        "reviewer",
        "timestamp",
      ].every((key) => nonempty(row[key])),
      "Missing row field",
    );
    require_(
      Number.isFinite(Date.parse(row.timestamp)),
      "Invalid row timestamp",
    );
    require_(
      Array.isArray(row.case_ids) &&
        row.case_ids.length > 0 &&
        row.case_ids.every(nonempty) &&
        unique(row.case_ids),
      "Missing or duplicate case IDs",
    );
    require_(
      !["human", "host"].includes(row.layer) || row.result !== "PASS",
      "Human/real-host acceptance cannot be automated PASS",
    );
  }
  require_(unique(ledger.rows.map((row) => row.row_id)), "Duplicate row ID");
  require_(
    unique(
      ledger.rows.map((row) =>
        JSON.stringify([row.item_id, row.layer, [...row.case_ids].sort()]),
      ),
    ),
    "Duplicate coverage in the same layer",
  );
  if (requiredIds === REQUIRED_IDS) {
    const actual = ledger.rows
      .filter((row) => row.item_id === "MANUAL-viewports")
      .flatMap((row) => row.case_ids)
      .sort();
    const expected = manualStates
      .flatMap((state) =>
        manualViewports.map((viewport) => `${state} @ ${viewport}`),
      )
      .sort();
    require_(
      JSON.stringify(actual) === JSON.stringify(expected),
      "Missing or extra manual screen viewport",
    );
    require_(
      ledger.rows.filter((row) => row.item_id === "G01-G18").length === 1,
      "Public gates need one pointer row",
    );
  }
  const inventory = [...new Set(ledger.rows.map((row) => row.item_id))].sort();
  require_(
    JSON.stringify(inventory) === JSON.stringify([...requiredIds].sort()),
    "Required ID inventory mismatch",
  );
  require_(ledger.verdict === "BLOCKED", "Release verdict must remain BLOCKED");
  require_(
    /^[a-f0-9]{40}$/.test(ledger.source_commit) && nonempty(ledger.release_id),
    "Invalid source/release identity",
  );
  require_(
    Array.isArray(ledger.bindings) &&
      unique(ledger.bindings.map((b) => b.binding_id)),
    "Duplicate or missing bindings",
  );
  for (const binding of ledger.bindings) {
    require_(
      nonempty(binding.binding_id) &&
        binding.source_commit === ledger.source_commit &&
        binding.release_id === ledger.release_id,
      "Wrong source/release binding",
    );
    require_(
      ["backend", "frontend"].every(
        (name) =>
          /^[a-f0-9]{64}$/.test(binding.lock_hashes?.[name]) &&
          binding.lock_hashes[name] === lockHashes[name],
      ),
      "Wrong lock binding",
    );
    require_(
      ["os", "node", "python", "browser"].every((name) =>
        nonempty(binding.versions?.[name]),
      ),
      "Missing runtime/browser versions",
    );
  }
  require_(
    Array.isArray(ledger.runs) && unique(ledger.runs.map((r) => r.run_id)),
    "Duplicate or missing runs",
  );
  for (const run of ledger.runs) {
    require_(
      [
        "run_id",
        "binding_id",
        "layer",
        "command",
        "cwd",
        "evidence",
        "start",
        "end",
      ].every((key) => nonempty(run[key])),
      "Missing run field",
    );
    require_(
      ledger.bindings.some((b) => b.binding_id === run.binding_id),
      "Unknown run binding",
    );
    require_(
      Number.isFinite(Date.parse(run.start)) &&
        Date.parse(run.end) >= Date.parse(run.start),
      "Invalid run times",
    );
    require_(
      run.exit_code === null || Number.isInteger(run.exit_code),
      "Invalid run exit status",
    );
  }
  for (const row of ledger.rows) {
    require_(
      ledger.bindings.some((b) => b.binding_id === row.binding_id),
      "Unknown row binding",
    );
    if (["PASS", "FAIL"].includes(row.result)) {
      const run = ledger.runs.find((r) => r.run_id === row.run_id);
      require_(
        run &&
          run.binding_id === row.binding_id &&
          run.layer === row.layer &&
          run.command === row.command &&
          run.cwd === row.cwd &&
          run.evidence === row.evidence,
        "Wrong run/evidence binding",
      );
      require_(
        Number.isInteger(run.exit_code),
        "NOT RUN evidence cannot become PASS/FAIL",
      );
      if (row.result === "PASS")
        require_(run.exit_code === 0, "Failed run cannot become PASS");
      else require_(run.exit_code !== 0, "FAIL needs failed run");
    } else
      require_(
        row.run_id === null && row.evidence === null,
        "Unexecuted row cannot cite execution evidence",
      );
  }
  return ledger;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const ledger = validateLedger(
    JSON.parse(readFileSync(process.argv[2], "utf8")),
  );
  console.log(
    `Validated ${ledger.rows.length} rows; release verdict ${ledger.verdict}.`,
  );
}
