import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const referenceRoot = path.resolve(
  "../docs/evidence/basic-design-runtime-20260922/reference",
);
const outputRoot = path.resolve("test-results/visual/app-create");
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];
const results = [];

async function login(page) {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill("교사김코딩");
  await form.getByLabel("비밀번호", { exact: true }).fill("1234");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function fillValidForm(page) {
  const form = page.getByRole("form", {
    name: "새 앱 등록 양식",
    exact: true,
  });
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill("시각 비교용 앱");
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://visual.example.org/class");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("시각 비교용 프롬프트");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("시각 비교용 설명");
  await form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "초3", exact: true })
    .click();
  return form;
}

async function setScenario(page, scenario) {
  await page.evaluate(
    ({ scenario }) => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...state, scenario }));
    },
    { scenario },
  );
}

async function compare(page, actual, expected) {
  return page.evaluate(
    async ({ actualData, expectedData }) => {
      const decode = async (data) => {
        const image = new Image();
        image.src = `data:image/png;base64,${data}`;
        await image.decode();
        return image;
      };
      const actualImage = await decode(actualData);
      const result = {
        width: actualImage.width,
        height: actualImage.height,
        expectedWidth: null,
        expectedHeight: null,
        comparisonStatus: expectedData ? "compared" : "product_only",
        differentPixels: null,
        maxChannelDelta: null,
      };
      if (!expectedData) return result;
      const expectedImage = await decode(expectedData);
      result.expectedWidth = expectedImage.width;
      result.expectedHeight = expectedImage.height;
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
      const read = (image) => {
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height).data;
      };
      const actualPixels = read(actualImage);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const expectedPixels = read(expectedImage);
      let differentPixels = 0;
      let maxChannelDelta = 0;
      for (let offset = 0; offset < actualPixels.length; offset += 4) {
        const delta = Math.max(
          Math.abs(actualPixels[offset] - expectedPixels[offset]),
          Math.abs(actualPixels[offset + 1] - expectedPixels[offset + 1]),
          Math.abs(actualPixels[offset + 2] - expectedPixels[offset + 2]),
          Math.abs(actualPixels[offset + 3] - expectedPixels[offset + 3]),
        );
        if (delta) differentPixels += 1;
        maxChannelDelta = Math.max(maxChannelDelta, delta);
      }
      return { ...result, differentPixels, maxChannelDelta };
    },
    {
      actualData: actual.toString("base64"),
      expectedData: expected?.toString("base64") ?? null,
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
  const actual = await page.screenshot({
    fullPage: true,
    animations: "disabled",
    caret: "hide",
  });
  const expected = baseline
    ? readFileSync(
        path.join(
          referenceRoot,
          `${viewport.width}x${viewport.height}`,
          baseline,
        ),
      )
    : null;
  const comparison = await compare(page, actual, expected);
  expect(comparison.width).toBe(viewport.width);
  const screenshot = `${state}-${viewport.width}x${viewport.height}.png`;
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, screenshot), actual);
  results.push({ state, viewport, baseline, screenshot, ...comparison });
  testInfo.attach(screenshot, { body: actual, contentType: "image/png" });
}

test.beforeAll(async ({ browser }) => {
  expect(browser.version()).toBe("151.0.7922.34");
  const fontPath = execFileSync(
    "fc-match",
    ["--format=%{file}", "Noto Sans CJK JP"],
    { encoding: "utf8" },
  ).trim();
  expect(
    createHash("sha256").update(readFileSync(fontPath)).digest("hex"),
  ).toBe("b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a");
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
  test(`app registration form at ${tag}`, async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page);
    await page.goto("/apps/new");
    await expect(page).toHaveURL(/\/apps\/new$/);
    const form = page.getByRole("form", {
      name: "새 앱 등록 양식",
      exact: true,
    });
    await expect(form).toBeVisible();
    await expect(
      form.getByRole("textbox", { name: "어플리케이션 이름", exact: true }),
    ).toBeVisible();
    await expect(
      form.getByRole("button", { name: "테마 Niagara 선택", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      form.getByRole("switch", { name: "전체 공개", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await capture(page, "app-create", viewport, testInfo, "16-submit.png");

    await form
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "표시된 항목을 확인해 주세요",
    );
    await capture(
      page,
      "app-create-validation-error",
      viewport,
      testInfo,
      "17-submit-error.png",
    );

    await fillValidForm(page);
    await setScenario(page, "app_create_failure");
    await form
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "앱을 등록하지 못했어요",
    );
    await capture(page, "app-create-rejected", viewport, testInfo);

    await setScenario(page, "app_create_unresolved");
    await form
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "저장 결과 확인", exact: true }),
    ).toBeVisible();
    await capture(page, "app-create-unknown", viewport, testInfo);
  });
}
