import { expect, test } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("..");
const baselineRoot = path.join(
  root,
  "docs/evidence/basic-design-runtime-20260922/reference",
);
const stateBaselineRoot = path.join(
  root,
  "docs/evidence/phase-1/issue31/2026-09-25/visual-state-baselines",
);
const outputRoot = path.resolve("test-results/visual/captures");
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];
const components = [
  {
    state: "gallery-component",
    viewport: viewports[0],
    screen: "gallery",
    selector: "a.card-r",
    baseline: path.join(baselineRoot, "1440x1000/01-gallery-component.png"),
  },
  {
    state: "detail-component",
    viewport: viewports[0],
    screen: "detail",
    selector: "aside",
    baseline: path.join(
      baselineRoot,
      "1440x1000/04-detail-public-component.png",
    ),
  },
];
const addedStates = [
  "gallery-loading",
  "gallery-empty",
  "gallery-failure",
  "corrupt-storage-recovery",
];
const states = ["gallery", "detail", ...addedStates];
test.beforeAll(async ({ browser }) => {
  expect(browser.version()).toBe("151.0.7922.34");
});

async function compareInPage(page, actual, expected) {
  return page.evaluate(
    async ({ actualData, expectedData }) => {
      const decode = async (source) => {
        const image = new Image();
        image.src = `data:image/png;base64,${source}`;
        await image.decode();
        return image;
      };
      const [actualImage, expectedImage] = await Promise.all([
        decode(actualData),
        decode(expectedData),
      ]);
      const report = {
        width: actualImage.width,
        height: actualImage.height,
        expectedWidth: expectedImage.width,
        expectedHeight: expectedImage.height,
        differentPixels: null,
        maxChannelDelta: null,
        bounds: null,
      };
      if (
        actualImage.width !== expectedImage.width ||
        actualImage.height !== expectedImage.height
      )
        return report;
      const canvas = document.createElement("canvas");
      canvas.width = actualImage.width;
      canvas.height = actualImage.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is unavailable");
      const read = (image) => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const a = read(actualImage);
      const b = read(expectedImage);
      let changed = 0;
      let max = 0;
      let left = actualImage.width;
      let top = actualImage.height;
      let right = -1;
      let bottom = -1;
      for (let offset = 0; offset < a.length; offset += 4) {
        const delta = Math.max(
          Math.abs(a[offset] - b[offset]),
          Math.abs(a[offset + 1] - b[offset + 1]),
          Math.abs(a[offset + 2] - b[offset + 2]),
          Math.abs(a[offset + 3] - b[offset + 3]),
        );
        if (delta === 0) continue;
        changed += 1;
        max = Math.max(max, delta);
        const pixel = offset / 4;
        const x = pixel % actualImage.width;
        const y = Math.floor(pixel / actualImage.width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
      report.differentPixels = changed;
      report.maxChannelDelta = max;
      report.bounds = changed ? { left, top, right, bottom } : null;
      return report;
    },
    {
      actualData: actual.toString("base64"),
      expectedData: expected.toString("base64"),
    },
  );
}

async function captureAndCompare(
  page,
  state,
  viewport,
  baselinePath,
  testInfo,
  componentSelector,
) {
  await page.setViewportSize(viewport);
  const captureTime = new Date("2026-09-22T00:12:00.000Z");
  if (state === "gallery-loading") await page.clock.pauseAt(captureTime);
  else await page.clock.install({ time: captureTime });
  const scenarios = {
    "gallery-loading": { scenario: "list_delayed", apps: [] },
    "gallery-empty": { scenario: "empty", apps: [] },
    "gallery-failure": { scenario: "list_failure", apps: [] },
    "corrupt-storage-recovery": { scenario: "original", apps: [{}] },
  };
  const savedState = scenarios[state];
  if (savedState) {
    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
      {
        key: "eduvibe-archive-mock-v1",
        value: { version: 1, generation: 0, ...savedState },
      },
    );
  }
  const detailState = state === "detail" || state === "detail-component";
  await page.goto(
    detailState
      ? "/apps/00000000-0000-4000-8000-000000000001"
      : state === "corrupt-storage-recovery"
        ? "/__dev/mock-reset"
        : "/",
  );
  if (state === "gallery" || state === "gallery-component")
    await expect(page.locator("a.card-r")).toHaveCount(16);
  else if (detailState)
    await expect(
      page.getByRole("heading", { name: "분수 피자 가게" }),
    ).toBeVisible();
  else if (state === "gallery-loading")
    await expect(page.getByRole("status")).toContainText(
      "공개 아카이브를 불러오는 중이에요",
    );
  else if (state === "gallery-empty")
    await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  else if (state === "gallery-failure") {
    await expect(page.getByRole("alert")).toContainText(
      "공개 아카이브를 불러오지 못했어요",
    );
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  } else if (state === "corrupt-storage-recovery") {
    await expect(page.getByRole("alert")).toContainText(
      "저장된 mock을 읽지 못했습니다",
    );
    await expect(
      page.getByRole("button", { name: "기본 fixture로 명시적 초기화" }),
    ).toBeVisible();
  }
  if (state === "gallery-loading")
    await page.evaluate(() => document.fonts.ready);
  else
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    });
  if (state === "gallery-loading")
    await expect(page.getByRole("status")).toContainText(
      "공개 아카이브를 불러오는 중이에요",
    );
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const actual = componentSelector
    ? await page.locator(componentSelector).first().screenshot({
        animations: "disabled",
        caret: "hide",
      })
    : await page.screenshot({
        fullPage: true,
        animations: "disabled",
        caret: "hide",
      });
  if (
    process.env.VISUAL_BASELINE_CAPTURE === "1" &&
    addedStates.includes(state) &&
    state !== "gallery-empty"
  ) {
    mkdirSync(path.dirname(baselinePath), { recursive: true });
    writeFileSync(baselinePath, actual);
  }
  const expected = readFileSync(baselinePath);
  const comparison = await compareInPage(page, actual, expected);
  const name = `${state}-${viewport.width}x${viewport.height}.png`;
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, name), actual);
  const result = {
    state,
    viewport,
    baseline: path.relative(root, baselinePath),
    screenshot: name,
    ...comparison,
  };
  writeFileSync(
    path.join(outputRoot, `${state}-${viewport.width}x${viewport.height}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  testInfo.attach(name, { body: actual, contentType: "image/png" });
  expect(comparison.width).toBe(comparison.expectedWidth);
  expect(comparison.height).toBe(comparison.expectedHeight);
  expect(comparison.differentPixels).toBe(0);
}

test.afterAll(() => {
  mkdirSync(outputRoot, { recursive: true });
  const paths = viewports
    .flatMap((viewport) =>
      states.map((state) =>
        path.join(
          outputRoot,
          `${state}-${viewport.width}x${viewport.height}.json`,
        ),
      ),
    )
    .concat(
      components.map((item) =>
        path.join(
          outputRoot,
          `${item.state}-${item.viewport.width}x${item.viewport.height}.json`,
        ),
      ),
    );
  if (!paths.every(existsSync)) return;
  const results = viewports
    .flatMap((viewport) =>
      states.map((state) =>
        JSON.parse(
          readFileSync(
            path.join(
              outputRoot,
              `${state}-${viewport.width}x${viewport.height}.json`,
            ),
            "utf8",
          ),
        ),
      ),
    )
    .concat(
      components.map((item) =>
        JSON.parse(
          readFileSync(
            path.join(
              outputRoot,
              `${item.state}-${item.viewport.width}x${item.viewport.height}.json`,
            ),
            "utf8",
          ),
        ),
      ),
    );
  writeFileSync(
    path.join(outputRoot, "visual-comparison.json"),
    `${JSON.stringify({ thresholdPixels: 0, results }, null, 2)}\n`,
  );
});

for (const viewport of viewports) {
  const tag = `${viewport.width}x${viewport.height}`;
  test(`gallery matches the original at ${tag}`, async ({ page }, testInfo) => {
    await captureAndCompare(
      page,
      "gallery",
      viewport,
      path.join(baselineRoot, tag, "01-gallery.png"),
      testInfo,
    );
  });
  test(`public detail matches the original at ${tag}`, async ({
    page,
  }, testInfo) => {
    await captureAndCompare(
      page,
      "detail",
      viewport,
      path.join(baselineRoot, tag, "04-detail-public.png"),
      testInfo,
    );
  });
}

for (const state of addedStates) {
  for (const viewport of viewports) {
    const tag = `${viewport.width}x${viewport.height}`;
    const baselinePath =
      state === "gallery-empty"
        ? path.join(baselineRoot, tag, "03-gallery-empty.png")
        : path.join(stateBaselineRoot, `${state}-${tag}.png`);
    test(`${state} matches its baseline at ${tag}`, async ({
      page,
    }, testInfo) => {
      await captureAndCompare(page, state, viewport, baselinePath, testInfo);
    });
  }
}

for (const item of components) {
  test(`${item.screen} key component matches its original capture`, async ({
    page,
  }, testInfo) => {
    await captureAndCompare(
      page,
      item.state,
      item.viewport,
      item.baseline,
      testInfo,
      item.selector,
    );
  });
}
