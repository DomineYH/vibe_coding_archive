import { expect } from "@playwright/test";
import { PNG } from "pngjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

// Decode without repainting the page.
export function compare(actual, expected) {
  const actualImage = PNG.sync.read(actual);
  const result = {
    width: actualImage.width,
    height: actualImage.height,
    expectedWidth: null,
    expectedHeight: null,
    comparisonStatus: expected ? "compared" : "product_only",
    differentPixels: null,
    maxChannelDelta: null,
  };
  if (!expected) return result;
  const expectedImage = PNG.sync.read(expected);
  result.expectedWidth = expectedImage.width;
  result.expectedHeight = expectedImage.height;
  if (
    actualImage.width !== expectedImage.width ||
    actualImage.height !== expectedImage.height
  )
    return { ...result, comparisonStatus: "dimensions_mismatch" };
  let differentPixels = 0;
  let maxChannelDelta = 0;
  for (let offset = 0; offset < actualImage.data.length; offset += 4) {
    const delta = Math.max(
      Math.abs(actualImage.data[offset] - expectedImage.data[offset]),
      Math.abs(actualImage.data[offset + 1] - expectedImage.data[offset + 1]),
      Math.abs(actualImage.data[offset + 2] - expectedImage.data[offset + 2]),
      Math.abs(actualImage.data[offset + 3] - expectedImage.data[offset + 3]),
    );
    if (delta) differentPixels += 1;
    maxChannelDelta = Math.max(maxChannelDelta, delta);
  }
  return { ...result, differentPixels, maxChannelDelta };
}

export async function capture(
  page,
  state,
  viewport,
  testInfo,
  baseline,
  { referenceRoot, outputRoot, results },
) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.mouse.move(0, 0);
  const expected = baseline
    ? readFileSync(
        path.join(
          referenceRoot,
          `${viewport.width}x${viewport.height}`,
          baseline,
        ),
      )
    : null;
  const screenshotOptions = {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  };
  let actual = await page.screenshot(screenshotOptions);
  let comparison = compare(actual, expected);
  let captureStatus =
    baseline &&
    comparison.comparisonStatus === "compared" &&
    comparison.differentPixels === 0
      ? "expected_match"
      : "unstable";
  let pollingError;
  let screenshotError;
  // Match the runner: accept an exact first frame, otherwise settle before verdict.
  if (captureStatus !== "expected_match") {
    await expect
      .poll(async () => {
        screenshotError = undefined;
        const previous = actual;
        try {
          actual = await page.screenshot(screenshotOptions);
        } catch (error) {
          screenshotError = error;
          throw error;
        }
        if (actual.equals(previous)) captureStatus = "stable";
        return captureStatus === "stable";
      })
      .toBe(true)
      // Preserve the last PNG/metrics before the explicit verdict rejects it.
      .catch((error) => {
        pollingError = error;
      });
    comparison = compare(actual, expected);
  }
  const screenshot = `${state}-${viewport.width}x${viewport.height}.png`;
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, screenshot), actual);
  const result = {
    state,
    viewport,
    baseline,
    screenshot,
    captureStatus,
    ...comparison,
  };
  results.push(result);
  writeFileSync(
    path.join(outputRoot, screenshot.replace(/\.png$/, ".json")),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, "visual-comparison.json"),
    `${JSON.stringify({ thresholdPixels: 0, results }, null, 2)}\n`,
  );
  await testInfo.attach(screenshot, { body: actual, contentType: "image/png" });
  if (pollingError)
    throw new Error(
      screenshotError
        ? "Full-page PNG screenshot/page error during polling"
        : "Full-page PNG never stabilized",
      { cause: screenshotError ?? pollingError },
    );
  expect(captureStatus, "Full-page PNG never stabilized").not.toBe("unstable");
  expect(comparison.width).toBe(viewport.width);
  if (baseline) {
    expect(comparison.width).toBe(comparison.expectedWidth);
    expect(comparison.height).toBe(comparison.expectedHeight);
    expect(comparison.comparisonStatus).toBe("compared");
    expect(comparison.differentPixels).toBe(0);
  } else {
    expect(comparison.comparisonStatus).toBe("product_only");
    expect(comparison.differentPixels).toBeNull();
  }
  return comparison;
}
