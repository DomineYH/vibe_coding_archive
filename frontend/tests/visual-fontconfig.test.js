// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertSubpixelRgb } from "../visual/render-precheck.js";

const repoConf = path.resolve("visual/fontconfig.conf");
const hasFcMatch = (() => {
  try {
    execFileSync("fc-match", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();
const dirs = [];
afterAll(() =>
  dirs.forEach((d) => rmSync(d, { recursive: true, force: true })),
);

// Host stub: real fonts.conf chain, then rgba forced to <hostRgba>; the repo conf
// is copied with its include pointed at the stub.
function confs(hostRgba) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fc-"));
  dirs.push(dir);
  const host = path.join(dir, "host.conf");
  writeFileSync(
    host,
    `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>
<include ignore_missing="yes">/etc/fonts/fonts.conf</include>
<match target="pattern"><edit name="rgba" mode="assign_replace"><const>${hostRgba}</const></edit></match></fontconfig>`,
  );
  const src = readFileSync(repoConf, "utf8");
  expect(src).toContain("/etc/fonts/fonts.conf");
  const repo = path.join(dir, "visual.conf");
  writeFileSync(repo, src.replace("/etc/fonts/fonts.conf", host));
  return { host, repo };
}

const fcMatch = (format, pattern, conf) =>
  execFileSync("fc-match", [`--format=${format}`, pattern], {
    encoding: "utf8",
    env: { ...process.env, FONTCONFIG_FILE: conf },
  }).trim();

describe.skipIf(!hasFcMatch && !process.env.CI)("visual fontconfig", () => {
  it.each(["none", "rgb"])(
    "forces rgba=rgb when the host sets rgba=%s",
    (host) => {
      expect(
        fcMatch("%{rgba}", "Noto Sans CJK JP:lang=ko", confs(host).repo),
      ).toBe("1");
    },
  );

  it("keeps Korean family selection", () => {
    expect(
      fcMatch("%{family[0]}", "monospace:lang=ko", confs("none").repo),
    ).toBe("Noto Sans CJK JP");
  });

  it("precheck fails with a fix message on a host-none conf", () => {
    expect(() =>
      assertSubpixelRgb({
        ...process.env,
        FONTCONFIG_FILE: confs("none").host,
      }),
    ).toThrow(/FONTCONFIG_FILE=/);
  });

  it("precheck passes with the repo conf on a host-none chain", () => {
    expect(() =>
      assertSubpixelRgb({
        ...process.env,
        FONTCONFIG_FILE: confs("none").repo,
      }),
    ).not.toThrow();
  });
});
