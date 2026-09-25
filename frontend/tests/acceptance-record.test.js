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
      "Expected result",
      "Actual result",
      "Review / acceptance",
    ]);
    expect(records).toHaveLength(10);
    const identifiers = records.map((record) => {
      const identifier = record
        .split("|")[1]
        .trim()
        .match(/^#31 AC(\d+)\b/);
      expect(identifier).not.toBeNull();
      return Number(identifier[1]);
    });
    expect(identifiers).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }

    const ac9 = records
      .find((record) => record.startsWith("| #31 AC9"))
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    expect(ac9[8]).toContain("36102435411");
    expect(ac9[8]).toContain("36105283727");
    expect(ac9[8]).toContain("FAIL");
    expect(ac9[9]).toContain("Docker");

    const ac10 = records
      .find((record) => record.startsWith("| #31 AC10"))
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    expect(ac10[9]).toContain("DomineYH");
    expect(ac10[9]).toMatch(/pending/i);
  });

  it("records every issue 32 criterion with all ten acceptance fields", () => {
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
      .filter((line) => line.startsWith("| #32 AC"));

    expect(records).toHaveLength(10);
    expect(
      records.map((record) =>
        Number(
          record
            .split("|")[1]
            .trim()
            .match(/^#32 AC(\d+)\b/)[1],
        ),
      ),
    ).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }
  });

  it("runs frontend checks, tests, builds, and preservation before visuals in CI", () => {
    const steps = workflow.jobs.frontend.steps;
    const commands = steps.map((step) => step.run);
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

    const fontPin = steps.find(
      (step) => step.name === "Install source-reference CJK font",
    );
    expect(fontPin.run).toContain("monospace:lang=ko");
    expect(fontPin.run).toContain("Noto Sans CJK KR:lang=ko");
    expect(fontPin.run).toContain("Expected Noto Sans CJK JP");
    expect(
      steps.find((step) => step.name === "Visual comparisons").env
        .FONTCONFIG_FILE,
    ).toBe("${{ github.workspace }}/frontend/visual/fontconfig.conf");
  });
});
