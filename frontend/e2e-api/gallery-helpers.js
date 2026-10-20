import { test } from "@playwright/test";
import { prepareViewportCapture, viewports } from "./helpers.js";

export async function captureGalleryState(page, state, testInfo = test.info()) {
  for (const viewport of viewports) {
    await prepareViewportCapture(page, viewport);
    const name = `${state}-${viewport.width}x${viewport.height}`;
    const file = testInfo.outputPath(`${name}.png`);
    await page.screenshot({
      path: file,
      fullPage: true,
      animations: "disabled",
    });
    await testInfo.attach(name, { path: file, contentType: "image/png" });
  }
}
