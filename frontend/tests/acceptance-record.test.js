import { readFileSync } from "node:fs";
import path from "node:path";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const acceptance = readFileSync(path.resolve("../docs/acceptance.md"), "utf8");
const workflow = load(
  readFileSync(path.resolve("../.github/workflows/frontend-ci.yml"), "utf8"),
);

describe("Phase 1 acceptance traces", () => {
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

  it("records every issue 33 criterion and its case evidence", () => {
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
      .filter((line) => line.startsWith("| #33 AC"));

    expect(records).toHaveLength(11);
    expect(
      records.map((record) =>
        Number(
          record
            .split("|")[1]
            .trim()
            .match(/^#33 AC(\d+)\b/)[1],
        ),
      ),
    ).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }

    const evidence = readFileSync(
      path.resolve("../docs/evidence/phase-1/issue33/2026-09-25/README.md"),
      "utf8",
    );
    expect(evidence).toContain("#8 case trace");
    expect(evidence).toContain("return_to");
    expect(evidence).toContain("app-write return");
  });

  it("records every issue 34 criterion and its local run evidence", () => {
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
      .filter((line) => line.startsWith("| #34 AC"));

    expect(records).toHaveLength(11);
    expect(
      records.map((record) =>
        Number(
          record
            .split("|")[1]
            .trim()
            .match(/^#34 AC(\d+)\b/)[1],
        ),
      ),
    ).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }

    const evidence = readFileSync(
      path.resolve("../docs/evidence/phase-1/issue34/2026-09-26/README.md"),
      "utf8",
    );
    expect(evidence).toContain("#34 local run evidence");
    expect(evidence).toContain("Authentication case trace");
    expect(evidence).toContain("Open and unverified");
  });

  it("records every issue 35 criterion and its local run evidence", () => {
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
      .filter((line) => line.startsWith("| #35 AC"));

    expect(records).toHaveLength(11);
    expect(
      records.map((record) =>
        Number(
          record
            .split("|")[1]
            .trim()
            .match(/^#35 AC(\d+)\b/)[1],
        ),
      ),
    ).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }

    const evidence = readFileSync(
      path.resolve("../docs/evidence/phase-1/issue35/2026-09-26/README.md"),
      "utf8",
    );
    expect(evidence).toContain("#35 local run evidence");
    expect(evidence).toContain("Open and unverified");
  });

  it("records every issue 40 criterion and its local run evidence", () => {
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
      .filter((line) => line.startsWith("| #40 AC"));

    expect(records).toHaveLength(11);
    expect(
      records.map((record) =>
        Number(
          record
            .split("|")[1]
            .trim()
            .match(/^#40 AC(\d+)\b/)[1],
        ),
      ),
    ).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }

    const evidence = readFileSync(
      path.resolve("../docs/evidence/phase-1/issue40/2026-09-26/README.md"),
      "utf8",
    );
    expect(evidence).toContain("#40 local run evidence");
    expect(evidence).toContain("Open and unverified");
  });

  it("records every issue 41 criterion and its local run evidence", () => {
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
      .filter((line) => line.startsWith("| #41 AC"));

    expect(records).toHaveLength(11);
    expect(
      records.map((record) =>
        Number(
          record
            .split("|")[1]
            .trim()
            .match(/^#41 AC(\d+)\b/)[1],
        ),
      ),
    ).toEqual(Array.from({ length: 11 }, (_, index) => index + 1));
    for (const record of records) {
      const cells = record
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim());
      expect(cells).toHaveLength(headers.length);
      expect(cells.every(Boolean)).toBe(true);
    }

    const evidence = readFileSync(
      path.resolve("../docs/evidence/phase-1/issue41/2026-09-26/README.md"),
      "utf8",
    );
    expect(evidence).toContain("#41 local run evidence");
    expect(evidence).toContain("Open and unverified");
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
