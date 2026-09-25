import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve("..");
const manifest = JSON.parse(
  readFileSync(
    path.join(
      repoRoot,
      "docs/evidence/basic-design-runtime-20260922/reference/sources.json",
    ),
    "utf8",
  ),
);
for (const entry of manifest) {
  const sourcePath = path.join(repoRoot, entry.path);
  const copyPath = path.join(
    repoRoot,
    entry.path.replace(/^basic_design\//, "docs/reference/basic_design/"),
  );
  const source = readFileSync(sourcePath);
  const copy = readFileSync(copyPath);
  const digest = (data) => createHash("sha256").update(data).digest("hex");
  if (
    source.length !== entry.bytes ||
    copy.length !== entry.bytes ||
    digest(source) !== entry.sha256 ||
    digest(copy) !== entry.sha256
  ) {
    throw new Error(`Source preservation check failed: ${entry.path}`);
  }
}
if (manifest.length !== 11)
  throw new Error(
    `Expected 11 preserved source files, received ${manifest.length}`,
  );
process.stdout.write(
  `PASS: ${manifest.length} original files and preserved copies match their SHA-256 and byte counts.\n`,
);
