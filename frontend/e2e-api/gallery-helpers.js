import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareViewportCapture, viewports } from "./helpers.js";

const captureDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/evidence/phase-2/issue82/2026-09-29/visual/api-mode",
);

export async function captureGalleryState(page, state) {
  await mkdir(captureDirectory, { recursive: true });
  for (const viewport of viewports) {
    await prepareViewportCapture(page, viewport);
    await page.screenshot({
      path: path.join(
        captureDirectory,
        `${state}-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
}
