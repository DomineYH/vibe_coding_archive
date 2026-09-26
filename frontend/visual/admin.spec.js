import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const referenceRoot = path.resolve(
  "../docs/evidence/basic-design-runtime-20260922/reference",
);
const outputRoot = path.resolve("test-results/visual/admin");
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];
const comparisons = [];

async function login(page) {
  await page.goto("/auth?mode=login");
  const form = page.locator("form");
  await expect(page).toHaveURL(/\/auth\?mode=login/);
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill("admin");
  const passwordInput = form.getByLabel("비밀번호", { exact: true });
  await passwordInput.fill("admin123");
  await passwordInput.press("Enter");
  await expect(page).toHaveURL("/");
}

async function reset(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function comparePixels(page, actual, expected) {
  return await page.evaluate(
    async ({ actualData, expectedData }) => {
      const decode = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        return image;
      };
      const actualImage = await decode(actualData);
      const expectedImage = await decode(expectedData);
      const result = {
        width: actualImage.width,
        height: actualImage.height,
        expectedWidth: expectedImage.width,
        expectedHeight: expectedImage.height,
        comparisonStatus: "compared",
        differentPixels: null,
        maxChannelDelta: null,
        bounds: null,
      };
      if (
        actualImage.width !== expectedImage.width ||
        actualImage.height !== expectedImage.height
      ) {
        result.comparisonStatus = "dimensions_mismatch";
        return result;
      }
      const canvas = document.createElement("canvas");
      canvas.width = actualImage.width;
      canvas.height = actualImage.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Canvas 2D is unavailable");
      const pixels = (image) => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const actualPixels = pixels(actualImage);
      const expectedPixels = pixels(expectedImage);
      let changed = 0;
      let max = 0;
      let left = canvas.width;
      let top = canvas.height;
      let right = -1;
      let bottom = -1;
      for (let y = 0; y < canvas.height; y += 1) {
        for (let x = 0; x < canvas.width; x += 1) {
          const offset = (y * canvas.width + x) * 4;
          const delta = Math.max(
            Math.abs(actualPixels[offset] - expectedPixels[offset]),
            Math.abs(actualPixels[offset + 1] - expectedPixels[offset + 1]),
            Math.abs(actualPixels[offset + 2] - expectedPixels[offset + 2]),
            Math.abs(actualPixels[offset + 3] - expectedPixels[offset + 3]),
          );
          if (!delta) continue;
          changed += 1;
          max = Math.max(max, delta);
          left = Math.min(left, x);
          top = Math.min(top, y);
          right = Math.max(right, x);
          bottom = Math.max(bottom, y);
        }
      }
      result.differentPixels = changed;
      result.maxChannelDelta = max;
      result.bounds = changed ? { left, top, right, bottom } : null;
      return result;
    },
    {
      actualData: actual.toString("base64"),
      expectedData: expected.toString("base64"),
    },
  );
}

async function capture(page, state, viewport, testInfo, baseline = null) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.mouse.move(0, 0);
  const image = await page.screenshot({
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  const tag = `${viewport.width}x${viewport.height}`;
  const name = `${state}-${tag}.png`;
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, name), image);
  const comparison = baseline
    ? await comparePixels(
        page,
        image,
        readFileSync(path.join(referenceRoot, tag, baseline)),
      )
    : { comparisonStatus: "product_only" };
  expect(comparison.width ?? viewport.width).toBe(viewport.width);
  const record = { state, viewport, baseline, screenshot: name, ...comparison };
  comparisons.push(record);
  testInfo.attach(name, { body: image, contentType: "image/png" });
}

test.beforeAll(async ({ browser }) => {
  expect(browser.version()).toBe("151.0.7922.34");
});

test.afterAll(() => {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    path.join(outputRoot, "visual-comparison.json"),
    `${JSON.stringify(
      {
        pixelTolerance: 0,
        comparisonEnforced: false,
        review: "Human UI-D approval pending",
        results: comparisons,
      },
      null,
      2,
    )}\n`,
  );
});

for (const viewport of viewports) {
  const tag = `${viewport.width}x${viewport.height}`;
  test(`admin approval screen at ${tag}`, async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await reset(page, viewport);
    await login(page);
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "관리자 대시보드" }),
    ).toBeVisible();
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    await capture(
      page,
      "admin-users",
      viewport,
      testInfo,
      "18-admin-users.png",
    );

    const pendingRow = page
      .getByRole("listitem")
      .filter({ has: page.getByText("비기너개발자", { exact: true }) });
    await pendingRow
      .getByRole("button", { name: "승인하기", exact: true })
      .click();
    const confirm = page.getByRole("region", { name: /회원 승인 확인/ });
    await expect(confirm).toContainText("대상 버전: 1");
    await capture(page, "admin-approval-confirm", viewport, testInfo);
  });
}
