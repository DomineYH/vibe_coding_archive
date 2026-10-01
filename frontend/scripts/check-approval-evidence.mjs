// Read-only independent replay check: never regenerate a source or product baseline.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const evidence = path.join(root, "docs/evidence/phase-3/issue119/2026-10-02");
const actual = path.join(root, "frontend/test-results/api");
const results = [];
for (const size of [
  "1440x1000",
  "1024x900",
  "768x1024",
  "390x844",
  "360x844",
]) {
  const directory = readdirSync(actual).find(
    (name) => name.startsWith("admin-approval-") && name.endsWith(size),
  );
  assert(directory, `missing actual approval capture ${size}`);
  for (const state of ["confirmation", "unknown", "cancelled"]) {
    const bytes = readFileSync(path.join(actual, directory, `${state}.png`));
    const committed = readFileSync(
      path.join(evidence, "visual", `${state}-${size}.png`),
    );
    assert.deepEqual(
      bytes,
      committed,
      `${state} ${size}: independent run differs`,
    );
    const frame = PNG.sync.read(bytes);
    results.push({
      state,
      size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      dimensions: [frame.width, frame.height],
      scope: "product_only",
    });
  }
}
console.log(
  JSON.stringify(
    {
      renderer: "Chromium 151.0.7922.34",
      pixelTolerance: 0,
      baselineUpdated: false,
      results,
    },
    null,
    2,
  ),
);
