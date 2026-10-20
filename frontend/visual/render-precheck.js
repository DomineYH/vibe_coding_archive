import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Host fontconfig rgba (e.g. Debian's sub-pixel-none) changes glyph edges vs the baselines.
export function assertSubpixelRgb(env = process.env) {
  const rgba = (e) =>
    execFileSync("fc-match", ["--format=%{rgba}", "Noto Sans CJK JP:lang=ko"], {
      encoding: "utf8",
      env: e,
    }).trim();
  const effective = rgba(env);
  const systemEnv = { ...env };
  delete systemEnv.FONTCONFIG_FILE;
  const system = rgba(systemEnv);
  console.log(
    `fontconfig rgba effective=${effective} (FONTCONFIG_FILE=${env.FONTCONFIG_FILE ?? "unset"}) system-only=${system}; 1=rgb expected`,
  );
  if (effective !== "1") {
    const conf = fileURLToPath(new URL("./fontconfig.conf", import.meta.url));
    throw new Error(
      `Visual baselines need subpixel rgba=1 (rgb) but fontconfig gave ${effective || "unset"} (system-only: ${system || "unset"}). Run with FONTCONFIG_FILE=${conf}.`,
    );
  }
}
