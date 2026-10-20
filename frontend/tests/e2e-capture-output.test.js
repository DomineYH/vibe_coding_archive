import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const e2eFiles = ["e2e", "e2e-api"].map((dir) =>
  readdirSync(path.resolve(dir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
    .map((entry) => `${dir}/${entry.name}`),
);
const read = (file) => readFileSync(path.resolve(file), "utf8");

describe("default E2E capture destinations", () => {
  it("finds the e2e and e2e-api sources", () => {
    for (const files of e2eFiles) expect(files.length).toBeGreaterThan(0);
  });

  it.each(e2eFiles.flat())(
    "%s does not write default captures into docs/evidence",
    (file) => {
      expect(read(file)).not.toMatch(/docs\/evidence/);
    },
  );

  it("shared gallery capture helper uses Playwright testInfo.outputPath", () => {
    expect(read("e2e-api/gallery-helpers.js")).toContain("outputPath(");
  });
});
