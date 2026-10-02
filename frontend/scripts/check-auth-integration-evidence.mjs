// Read-only comparison of an independently reproduced functional → capture run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const evidence = path.join(root, "docs/evidence/phase-3/issue121/2026-10-03");
const actual = path.join(root, "frontend/test-results/api");
const manifest = JSON.parse(readFileSync(path.join(evidence, "captures.json")));
assert.equal(manifest.captures.length, 40);
const results = [];
for (const entry of manifest.captures) {
  const directory = readdirSync(actual).filter(
    (name) =>
      name.startsWith("auth-recovery-captures-") &&
      name.endsWith(entry.viewport) &&
      existsSync(path.join(actual, name, `${entry.state}.png`)),
  );
  assert.equal(
    directory.length,
    1,
    `missing/ambiguous actual ${entry.state} ${entry.viewport}`,
  );
  const bytes = readFileSync(
    path.join(actual, directory[0], `${entry.state}.png`),
  );
  const committed = readFileSync(path.join(evidence, entry.file));
  assert.deepEqual(
    bytes,
    committed,
    `independent ${entry.state} ${entry.viewport} differs`,
  );
  const hash = createHash("sha256").update(bytes).digest("hex");
  assert.equal(hash, entry.sha256);
  const frame = PNG.sync.read(bytes);
  assert.deepEqual([frame.width, frame.height], entry.dimensions);
  results.push({
    state: entry.state,
    viewport: entry.viewport,
    sha256: hash,
    dimensions: entry.dimensions,
    classification: entry.classification,
  });
}
const ledger = readFileSync(path.join(evidence, "README.md"), "utf8");
for (const [namespace, count] of [
  ["US", 55],
  ["I", 24],
  ["Q", 12],
  ["T", 7],
  ["AC", 12],
]) {
  for (let number = 1; number <= count; number++) {
    const id =
      namespace === "AC"
        ? `${namespace}${number}`
        : `${namespace}-${String(number).padStart(2, "0")}`;
    const canonical = ["I", "Q", "T"].includes(namespace)
      ? `${namespace}${String(number).padStart(2, "0")}`
      : id;
    assert(ledger.includes(canonical), `missing requirement ${canonical}`);
  }
}
const gates = ledger.slice(
  ledger.indexOf("## Public gate"),
  ledger.indexOf("## Four separate"),
);
assert(gates.includes("WITHHELD") || ledger.includes("WITHHELD"));
const gateRows = gates.split("\n").filter((row) => /^\| G[0-9]+/.test(row));
assert.equal(gateRows.length, 18, "public gate inventory must remain complete");
for (const row of gateRows) {
  assert(/NOT RUN|BLOCKED/.test(row), "public gate incorrectly passed");
  assert(!/\| PASS/.test(row), "public acceptance cannot be automated");
}
console.log(
  JSON.stringify(
    {
      renderer: manifest.renderer,
      pixelTolerance: 0,
      baselineUpdated: false,
      independentRun: true,
      results,
    },
    null,
    2,
  ),
);
