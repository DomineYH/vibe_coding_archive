import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const checkDistScript = path.resolve("scripts/check-dist.mjs");

function checkDist(extraFiles = {}, arrange = () => {}) {
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
  arrange(dist, temp);
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

describe("release hardening", () => {
  it.each(
    ["index.html", "assets/main.js", "assets/main.css"].flatMap((file) =>
      [
        "admin123",
        "Temporary Demo Password 38",
        "Temporary Admin Password 38",
        "DEMO_ACCOUNTS",
        "TEMPORARY_DEMO_ACCOUNTS",
        "INITIAL_APPS",
        "INITIAL_USERS",
        "simulatePing",
        "TweaksPanel",
        "mockMeta",
      ].map((marker) => [file, marker]),
    ),
  )("rejects demo credentials in every text asset: %s %s", (file, marker) => {
    expect(checkDist({ [file]: marker }).status).not.toBe(0);
  });

  it.each(['password:"1234"', '"password": "1234"', "password: '1234'"])(
    "rejects the generic demo password record: %s",
    (record) => {
      expect(checkDist({ "assets/main.js": record }).status).not.toBe(0);
    },
  );
  it("accepts unrelated numeric literals", () => {
    expect(checkDist({ "assets/main.js": "const width = 1234" }).status).toBe(
      0,
    );
  });

  it.each(["file", "directory", "cycle", "root"])(
    "rejects symlinked files and directories: %s",
    (kind) => {
      const result = checkDist({}, (dist, temp) => {
        const outside = path.join(temp, "outside");
        mkdirSync(outside);
        writeFileSync(path.join(outside, "main.js"), "console.log('ready')");
        if (kind === "file") {
          rmSync(path.join(dist, "assets/main.js"));
          symlinkSync(
            path.join(outside, "main.js"),
            path.join(dist, "assets/main.js"),
          );
        } else if (kind === "root") {
          const physical = path.join(temp, "physical");
          mkdirSync(physical);
          mkdirSync(path.join(physical, "assets"));
          writeFileSync(path.join(physical, "index.html"), "EduVibe");
          writeFileSync(path.join(physical, "assets/main.js"), "ready");
          rmSync(dist, { recursive: true });
          symlinkSync(physical, dist);
        } else {
          rmSync(path.join(dist, "assets"), { recursive: true });
          symlinkSync(
            kind === "cycle" ? dist : outside,
            path.join(dist, "assets"),
          );
        }
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("symlink");
    },
  );

  it.each([
    ".env",
    ".git/config",
    "source.ts",
    "mock/data.js",
    "reference/capture.png",
    "evidence/proof.txt",
    "assets/private.sqlite3",
    "assets/private.sqlite3-wal",
    "assets/private.sqlite3-shm",
    "assets/private.db",
    "assets/private.db-wal",
    "assets/private.db-shm",
    "assets/backup.age",
    "assets/private.bak",
    "assets/private.key",
    "assets/main.js.map",
    "assets/.nested.js",
    "assets/mock.js",
    "assets/private.db.js",
    "assets/source.ts.js",
  ])("rejects operational and source artifacts: %s", (file) => {
    expect(
      checkDist({ [file]: "synthetic excluded artifact" }).status,
    ).not.toBe(0);
  });
});
