import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const acceptance = readFileSync(path.resolve("../docs/acceptance.md"), "utf8");
const workflow = load(
  readFileSync(path.resolve("../.github/workflows/frontend-ci.yml"), "utf8"),
);

describe("issue 31 acceptance trace", () => {
  it("records every AC row with all five decision-29 trace fields", () => {
    const lines = acceptance.split("\n");
    const headerIndex = lines.findIndex((line) =>
      line.startsWith("| Requirement / source"),
    );
    const headers = lines[headerIndex]
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    const records = lines
      .slice(headerIndex + 2)
      .filter((line) => line.startsWith("| #31 AC"));

    expect(headers).toEqual([
      "Requirement / source",
      "Applicability / state",
      "Screen / state",
      "Service / API / data / permission",
      "Test layer",
      "Reproduction command",
      "Execution evidence",
    ]);
    expect(records).toHaveLength(10);
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.slice(2).every(Boolean)).toBe(true);
    }
  });

  it("runs frontend checks, tests, builds, and preservation before visuals in CI", () => {
    const commands = workflow.jobs.frontend.steps.map((step) => step.run);
    const required = [
      "npm run check",
      "npm test",
      "npm run test:e2e",
      "npm run build:mock",
      "npm run build && npm run check:dist",
      "npm run check:reference",
      "npm run test:visual",
    ];
    const positions = required.map((command) => commands.indexOf(command));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
