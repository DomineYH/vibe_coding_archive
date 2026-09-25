import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temporaryDirectory = mkdtempSync(
  path.join(os.tmpdir(), "eduvibe-openapi-"),
);
const temporaryTypes = path.join(temporaryDirectory, "api.d.ts");
const generator = path.join(
  frontendRoot,
  "node_modules/.bin/openapi-typescript",
);
const result = spawnSync(
  generator,
  ["../contracts/openapi.yaml", "-o", temporaryTypes],
  { cwd: frontendRoot, encoding: "utf8" },
);
try {
  if (result.status !== 0)
    throw new Error(
      result.stderr || result.stdout || "OpenAPI type generation failed",
    );
  const actual = readFileSync(
    path.join(frontendRoot, "src/contracts/api.d.ts"),
    "utf8",
  );
  const expected = readFileSync(temporaryTypes, "utf8");
  if (actual !== expected)
    throw new Error(
      "src/contracts/api.d.ts is stale; run npm run openapi:generate",
    );
  process.stdout.write("OpenAPI types match the generated contract.\n");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
