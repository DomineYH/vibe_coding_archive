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
const evidence = path.join(root, "docs/evidence/phase-3/issue120/2026-10-02");
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
    (name) =>
      name.startsWith("auth-access-private-access-states-") &&
      name.endsWith(size),
  );
  assert(directory, `missing actual access capture ${size}`);
  for (const state of [
    "owner",
    "concealed",
    "checking",
    "restored",
    "error",
    "denied",
    "admin",
  ]) {
    const bytes = readFileSync(path.join(actual, directory, `${state}.png`));
    const committed = readFileSync(
      path.join(evidence, "visual", `${state}-${size}.png`),
    );
    // Buffer.equals: a deepEqual failure diffs the bytes (quadratic memory).
    assert(
      bytes.equals(committed),
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
