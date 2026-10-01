// Read-only reproducibility check; never updates captures or a visual baseline.
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
const evidence = path.join(root, "docs/evidence/phase-3/issue118/2026-10-02");
const actual = path.join(root, "frontend/test-results/api");
const sizes = ["1440x1000", "1024x900", "768x1024", "390x844", "360x844"];
const results = [];
for (const size of sizes) {
  const directory = readdirSync(actual).find(
    (name) => name.startsWith("auth-register-") && name.endsWith(size),
  );
  assert(directory, `missing real browser capture at ${size}`);
  for (const state of ["signup", "collection-error", "pending"]) {
    const bytes = readFileSync(path.join(actual, directory, `${state}.png`));
    const committed = readFileSync(
      path.join(evidence, "visual", `${state}-${size}.png`),
    );
    assert.deepEqual(
      bytes,
      committed,
      `${state} ${size}: independent run differs`,
    );
    const png = PNG.sync.read(bytes);
    const row = {
      state,
      size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      dimensions: [png.width, png.height],
      scope: state === "signup" ? "source_observation" : "product_only",
    };
    if (state === "signup") {
      const source = PNG.sync.read(
        readFileSync(
          path.join(
            root,
            "docs/evidence/basic-design-runtime-20260922/reference",
            size,
            "09-signup.png",
          ),
        ),
      );
      row.sourceDimensions = [source.width, source.height];
      row.differentPixels = null;
      if (source.width === png.width && source.height === png.height) {
        row.differentPixels = 0;
        for (let i = 0; i < png.data.length; i += 4)
          if (
            !png.data.subarray(i, i + 4).equals(source.data.subarray(i, i + 4))
          )
            row.differentPixels++;
      }
    }
    results.push(row);
  }
}
console.log(
  JSON.stringify(
    { pixelTolerance: 0, baselineUpdated: false, results },
    null,
    2,
  ),
);
