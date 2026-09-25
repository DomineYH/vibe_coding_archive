import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve("..");
const referenceRoot = path.join(
  root,
  "docs/evidence/basic-design-runtime-20260922/reference",
);
const outputRoot = path.resolve("test-results/visual/auth");
const memberApp = "/apps/00000000-0000-4000-8000-000000000091";
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];
const results = [];

async function login(page, loginId = "교사김코딩", password = "1234") {
  await page.getByLabel("로그인 아이디").fill(loginId);
  await page.getByLabel("비밀번호").fill(password);
  await page
    .getByRole("button", { name: "로그인", exact: true })
    .last()
    .click();
}

async function reset(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function capture(page, state, viewport, testInfo, baseline = null) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
  });
  await page.mouse.move(0, 0);
  const actual = await page.screenshot({
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  const tag = `${viewport.width}x${viewport.height}`;
  const name = `${state}-${tag}.png`;
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, name), actual);
  const expected = baseline
    ? readFileSync(path.join(referenceRoot, tag, baseline))
    : null;
  const comparison = await page.evaluate(
    async ({ actualData, expectedData }) => {
      const decode = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        return image;
      };
      const actualImage = await decode(actualData);
      const report = {
        width: actualImage.width,
        height: actualImage.height,
        comparisonStatus: expectedData ? "compared" : "product_only",
        expectedWidth: null,
        expectedHeight: null,
        differentPixels: null,
        maxChannelDelta: null,
        bounds: null,
      };
      if (!expectedData) return report;
      const expectedImage = await decode(expectedData);
      report.expectedWidth = expectedImage.width;
      report.expectedHeight = expectedImage.height;
      if (
        actualImage.width !== expectedImage.width ||
        actualImage.height !== expectedImage.height
      )
        report.comparisonStatus = "dimensions_mismatch";

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(actualImage.width, expectedImage.width);
      canvas.height = Math.max(actualImage.height, expectedImage.height);
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
          const offset = (y * actualImage.width + x) * 4;
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
      report.differentPixels = changed;
      report.maxChannelDelta = max;
      report.bounds = changed ? { left, top, right, bottom } : null;
      return report;
    },
    {
      actualData: actual.toString("base64"),
      expectedData: expected?.toString("base64") ?? null,
    },
  );
  expect(comparison.width).toBe(viewport.width);
  const result = {
    state,
    viewport,
    baseline,
    screenshot: name,
    ...comparison,
  };
  results.push(result);
  testInfo.attach(name, { body: actual, contentType: "image/png" });
}

test.beforeAll(async ({ browser }) => {
  expect(browser.version()).toBe("151.0.7922.34");
});

test.afterAll(() => {
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(
    path.join(outputRoot, "visual-comparison.json"),
    `${JSON.stringify({ thresholdPixels: 0, results }, null, 2)}\n`,
  );
});

for (const viewport of viewports) {
  const tag = `${viewport.width}x${viewport.height}`;
  test(`auth and private-read screens at ${tag}`, async ({
    page,
  }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    await expect(page.getByLabel("로그인 아이디")).toBeVisible();
    await capture(page, "auth-login", viewport, testInfo, "07-login.png");

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    await login(page, "교사김코딩", "incorrect");
    await expect(page.getByRole("alert")).toContainText(
      "로그인 아이디 또는 비밀번호를 확인해 주세요",
    );
    await capture(
      page,
      "auth-credentials-error",
      viewport,
      testInfo,
      "08-login-error.png",
    );

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    await page
      .getByRole("button", { name: "로그인", exact: true })
      .last()
      .click();
    await expect(page.getByLabel("로그인 아이디")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await capture(page, "auth-field-errors", viewport, testInfo);

    await reset(page, viewport);
    await page.goto("/");
    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "auth_network_error" }),
      );
    });
    await page.goto("/auth?mode=login");
    await login(page, "admin", "admin123");
    await expect(page.getByRole("alert")).toContainText(
      "로그인하지 못했어요. 연결을 확인해 주세요.",
    );
    await capture(page, "auth-network-error", viewport, testInfo);

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    await login(page);
    await page.goto(memberApp);
    await expect(
      page.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
    ).toBeVisible();
    await capture(
      page,
      "private-member-detail",
      viewport,
      testInfo,
      "12-detail-private.png",
    );

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    await login(page);
    await page.goto("/admin");
    await expect(page.getByRole("alert")).toContainText(
      "관리자 권한이 필요해요",
    );
    await capture(page, "member-admin-forbidden", viewport, testInfo);

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    await login(page, "admin", "admin123");
    await page.goto("/admin");
    await expect(
      page.getByText("관리자 작업은 아직 제공하지 않아요."),
    ).toBeVisible();
    await capture(page, "admin-placeholder", viewport, testInfo);
  });
}
