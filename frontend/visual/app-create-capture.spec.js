import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { capture } from "./app-create-capture.js";
import { PNG } from "pngjs";

// The production capture path owns comparison, evidence persistence and verdict.
for (const scenario of [
  {
    name: "height",
    expectedWidth: 8,
    expectedHeight: 8,
    height: 9,
    status: "dimensions_mismatch",
    pixels: null,
    fails: true,
  },
  {
    name: "width",
    expectedWidth: 9,
    expectedHeight: 8,
    height: 8,
    status: "dimensions_mismatch",
    pixels: null,
    fails: true,
  },
  {
    name: "one-pixel",
    expectedWidth: 8,
    expectedHeight: 8,
    height: 8,
    status: "compared",
    pixels: 1,
    fails: true,
  },
  {
    name: "identical",
    expectedWidth: 8,
    expectedHeight: 8,
    height: 9,
    status: "compared",
    pixels: 0,
    fails: false,
  },
  {
    name: "product-only",
    expectedWidth: null,
    expectedHeight: null,
    height: 9,
    status: "product_only",
    pixels: null,
    fails: false,
  },
]) {
  test(`capture verdict and retained evidence: ${scenario.name}`, async ({
    page,
  }, testInfo) => {
    const viewport = { width: 8, height: 8 };
    await page.setViewportSize(viewport);
    await page.setContent(
      `<style>html,body{margin:0;background:white}body{height:${scenario.height}px}</style>${scenario.name === "one-pixel" ? '<div style="position:absolute;width:1px;height:1px;background:red"></div>' : ""}`,
    );
    const referenceRoot = testInfo.outputPath("references");
    const outputRoot = testInfo.outputPath("captures");
    const baseline = scenario.status === "product_only" ? null : "expected.png";
    if (baseline) {
      const encoded = await page.evaluate(
        ({ width, height }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.fillStyle = "white";
          context.fillRect(0, 0, width, height);
          return canvas.toDataURL("image/png").split(",")[1];
        },
        {
          width: scenario.expectedWidth,
          height: scenario.name === "identical" ? 9 : scenario.expectedHeight,
        },
      );
      mkdirSync(path.join(referenceRoot, "8x8"), { recursive: true });
      writeFileSync(
        path.join(referenceRoot, "8x8", baseline),
        Buffer.from(encoded, "base64"),
      );
    }
    const results = [];
    const captured = capture(
      page,
      scenario.name,
      viewport,
      testInfo,
      baseline,
      { referenceRoot, outputRoot, results },
    );
    if (scenario.fails) await expect(captured).rejects.toThrow();
    else await captured;
    expect(results).toMatchObject([
      {
        width: 8,
        height: scenario.height,
        expectedWidth: scenario.expectedWidth,
        expectedHeight:
          scenario.name === "identical" ? 9 : scenario.expectedHeight,
        comparisonStatus: scenario.status,
        differentPixels: scenario.pixels,
      },
    ]);
    expect(
      JSON.parse(
        readFileSync(path.join(outputRoot, "visual-comparison.json"), "utf8"),
      ),
    ).toEqual({ thresholdPixels: 0, results });
    expect(
      JSON.parse(
        readFileSync(
          path.join(outputRoot, `${scenario.name}-8x8.json`),
          "utf8",
        ),
      ),
    ).toEqual(results[0]);
    expect(
      readFileSync(path.join(outputRoot, `${scenario.name}-8x8.png`)).length,
    ).toBeGreaterThan(0);
    expect(
      testInfo.attachments.some(
        (attachment) => attachment.contentType === "image/png",
      ),
    ).toBe(true);
  });
}

for (const scenario of ["never-stabilizes", "screenshot-error"]) {
  test(`polling failure retains cause and evidence: ${scenario}`, async ({
    page,
  }, testInfo) => {
    const viewport = { width: 8, height: 8 };
    await page.setViewportSize(viewport);
    await page.setContent(
      "<style>html,body{margin:0;background:white}</style>",
    );
    const first = await page.screenshot();
    const changed = PNG.sync.read(first);
    changed.data[0] = 0;
    const second = PNG.sync.write(changed);
    const screenshotError = new Error("page.screenshot: Target page closed");
    let calls = 0;
    let last = first;
    const fakePage = {
      evaluate: (...args) => page.evaluate(...args),
      mouse: page.mouse,
      screenshot: async () => {
        calls += 1;
        if (calls > 1 && scenario === "screenshot-error") throw screenshotError;
        last = calls % 2 ? first : second;
        return last;
      },
    };
    const outputRoot = testInfo.outputPath("captures");
    const results = [];
    let failure;
    try {
      await capture(fakePage, scenario, viewport, testInfo, null, {
        referenceRoot: testInfo.outputPath("references"),
        outputRoot,
        results,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toContain(
      scenario === "screenshot-error"
        ? "screenshot/page error"
        : "never stabilized",
    );
    if (scenario === "screenshot-error")
      expect(failure.cause).toBe(screenshotError);
    else expect(failure.cause).toBeInstanceOf(Error);
    expect(calls).toBeGreaterThan(1);
    expect(results[0].captureStatus).toBe("unstable");
    expect(readFileSync(path.join(outputRoot, `${scenario}-8x8.png`))).toEqual(
      last,
    );
    expect(
      JSON.parse(
        readFileSync(path.join(outputRoot, `${scenario}-8x8.json`), "utf8"),
      ),
    ).toEqual(results[0]);
    expect(
      JSON.parse(
        readFileSync(path.join(outputRoot, "visual-comparison.json"), "utf8"),
      ),
    ).toEqual({ thresholdPixels: 0, results });
    expect(
      testInfo.attachments.some(
        (attachment) => attachment.name === `${scenario}-8x8.png`,
      ),
    ).toBe(true);
  });
}
