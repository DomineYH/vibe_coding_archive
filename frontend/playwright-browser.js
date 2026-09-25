import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";

export function chromiumExecutable() {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (!configured)
    throw new Error(
      "Set PLAYWRIGHT_CHROMIUM_EXECUTABLE to the Chromium 151.0.7922.34 headless-shell executable.",
    );
  const executable = resolve(configured);
  try {
    accessSync(executable, constants.X_OK);
  } catch {
    throw new Error(
      `PLAYWRIGHT_CHROMIUM_EXECUTABLE is not executable: ${executable}`,
    );
  }
  return executable;
}
