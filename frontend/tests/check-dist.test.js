import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const checkDistScript = path.resolve("scripts/check-dist.mjs");

function checkDist(extraFiles = {}) {
  const temp = mkdtempSync(path.join(os.tmpdir(), "eduvibe-dist-"));
  const dist = path.join(temp, "dist");
  mkdirSync(path.join(dist, "assets"), { recursive: true });
  writeFileSync(path.join(dist, "index.html"), "<main>EduVibe</main>");
  writeFileSync(path.join(dist, "assets/main.js"), "console.log('ready')");
  for (const [name, contents] of Object.entries(extraFiles)) {
    const file = path.join(dist, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  try {
    return spawnSync(process.execPath, [checkDistScript], {
      cwd: temp,
      encoding: "utf8",
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

describe("API static output guard", () => {
  it("accepts the declared static output", () => {
    expect(checkDist().status).toBe(0);
  });

  it("rejects environment files", () => {
    expect(
      checkDist({ ".env": "DATABASE_URL=sqlite:///private.db" }).status,
    ).not.toBe(0);
  });

  it("rejects unapproved static assets", () => {
    expect(
      checkDist({ "assets/reference.png": "source capture" }).status,
    ).not.toBe(0);
  });

  it("checks HTML and styles for mock fixture content", () => {
    expect(
      checkDist({ "assets/main.css": "/* 분수 피자 가게 */" }).status,
    ).not.toBe(0);
  });

  it("rejects the mock reset route and page in API output", () => {
    expect(
      checkDist({ "assets/main.js": 'path:"/__dev/mock-reset"' }).status,
    ).not.toBe(0);
    expect(
      checkDist({
        "assets/main.js": '"mock reset은 개발 모드에서만 사용할 수 있어요"',
      }).status,
    ).not.toBe(0);
  });
});
