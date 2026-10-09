// @vitest-environment node
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { validateLedger } from "../scripts/check-phase7-ledger.mjs";

const options = {
  requiredIds: ["sample"],
  lockHashes: {
    backend: "b".repeat(64),
    frontend: "c".repeat(64),
  },
};
function fixture() {
  return {
    source_commit: "a".repeat(40),
    release_id: "test-release",
    verdict: "BLOCKED",
    bindings: [
      {
        binding_id: "source",
        source_commit: "a".repeat(40),
        release_id: "test-release",
        lock_hashes: structuredClone(options.lockHashes),
        versions: { os: "Linux", node: "22", python: "3.12", browser: "151" },
      },
    ],
    runs: [
      {
        run_id: "unit",
        binding_id: "source",
        layer: "local",
        command: "npm test",
        cwd: "frontend",
        exit_code: 0,
        start: "2026-10-09T00:00:00Z",
        end: "2026-10-09T00:01:00Z",
        evidence: "README.md#unit",
      },
    ],
    rows: [
      {
        row_id: "sample-local",
        item_id: "sample",
        source: "spec §1",
        applicability: "required",
        layer: "local",
        case_ids: ["known case"],
        command: "npm test",
        cwd: "frontend",
        expected: "known case passes",
        count: { collected: 1, executed: 1, passed: 1, failed: 0, skipped: 0 },
        result: "PASS",
        evidence: "README.md#unit",
        run_id: "unit",
        binding_id: "source",
        reason: "",
        owner: "implementer",
        reviewer: "DomineYH",
        timestamp: "2026-10-09T00:01:00Z",
      },
    ],
  };
}
it("accepts executed PASS without conferring release approval", () => {
  expect(validateLedger(fixture(), options).verdict).toBe("BLOCKED");
});
it.each([
  [
    "zero executed PASS",
    (l) => {
      l.rows[0].count = {
        collected: 0,
        executed: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
      };
    },
  ],
  [
    "skipped PASS",
    (l) => {
      l.rows[0].count.skipped = 1;
    },
  ],
  [
    "count mismatch",
    (l) => {
      l.rows[0].count.collected = 2;
    },
  ],
  [
    "absent count",
    (l) => {
      delete l.rows[0].count;
    },
  ],
  [
    "missing required ID",
    (l) => {
      l.rows = [];
    },
  ],
  [
    "duplicate row",
    (l) => {
      l.rows.push(structuredClone(l.rows[0]));
    },
  ],
  [
    "wrong source binding",
    (l) => {
      l.bindings[0].source_commit = "d".repeat(40);
    },
  ],
  [
    "wrong lock binding",
    (l) => {
      l.bindings[0].lock_hashes.backend = "d".repeat(64);
    },
  ],
  [
    "unknown binding",
    (l) => {
      l.rows[0].binding_id = "other";
    },
  ],
  [
    "NOT RUN evidence relabeled PASS",
    (l) => {
      l.runs[0].exit_code = null;
    },
  ],
  [
    "unrelated run evidence",
    (l) => {
      l.rows[0].evidence = "README.md#other";
    },
  ],
  [
    "unexecuted human PASS",
    (l) => {
      l.rows[0].layer = "human";
      l.runs[0].layer = "human";
    },
  ],
])("rejects %s", (_name, corrupt) => {
  const ledger = fixture();
  corrupt(ledger);
  expect(() => validateLedger(ledger, options)).toThrow();
});
it.each(["NOT RUN", "BLOCKED"])(
  "accepts explicit %s with reason and owner",
  (result) => {
    const ledger = fixture();
    Object.assign(ledger.rows[0], {
      result,
      run_id: null,
      evidence: null,
      reason: "Awaiting CI execution",
      count: { collected: 0, executed: 0, passed: 0, failed: 0, skipped: 0 },
    });
    expect(validateLedger(ledger, options)).toBe(ledger);
    ledger.rows[0].reason = "";
    expect(() => validateLedger(ledger, options)).toThrow();
  },
);

it("validates the committed full crosswalk against actual lock hashes", () => {
  const ledger = JSON.parse(
    readFileSync("../docs/evidence/phase-7/issue203/ledger.json", "utf8"),
  );
  expect(validateLedger(ledger).verdict).toBe("BLOCKED");
});

it("rejects duplicated coverage hidden behind a different row ID", () => {
  const ledger = fixture();
  const duplicate = structuredClone(ledger.rows[0]);
  duplicate.row_id = "different";
  ledger.rows.push(duplicate);
  expect(() => validateLedger(ledger, options)).toThrow(/Duplicate coverage/);
});
it("rejects a missing manual screen viewport even when its item ID remains", () => {
  const ledger = JSON.parse(
    readFileSync("../docs/evidence/phase-7/issue203/ledger.json", "utf8"),
  );
  ledger.rows.splice(
    ledger.rows.findIndex((row) => row.item_id === "MANUAL-viewports"),
    1,
  );
  expect(() => validateLedger(ledger)).toThrow(/viewport/);
});
