import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const appId = "00000000-0000-4000-8000-000000000091";
const referenceRoot = path.resolve(
  "../docs/evidence/basic-design-runtime-20260922/reference",
);
const outputRoot = path.resolve("test-results/visual/app-delete");
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

async function openOwnerDetail(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await login(page);
  await page.goto(`/apps/${appId}`);
  await expect(page).toHaveURL(new RegExp(`/apps/${appId}$`));
  const detail = page.locator('[data-screen-label="비공개 앱 상세"]');
  await expect(detail).toBeVisible();
  return detail;
}

async function setScenario(page, scenario) {
  await page.evaluate((nextScenario) => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: nextScenario }),
    );
  }, scenario);
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
  const screenshot = `${state}-${viewport.width}x${viewport.height}.png`;
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(path.join(outputRoot, screenshot), actual);
  results.push({ state, viewport, baseline, screenshot, ...comparison });
  writeFileSync(
    path.join(outputRoot, screenshot.replace(/\.png$/, ".json")),
    `${JSON.stringify(results.at(-1), null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, "visual-comparison.json"),
    `${JSON.stringify({ thresholdPixels: 0, results }, null, 2)}\n`,
  );
  await testInfo.attach(screenshot, { body: actual, contentType: "image/png" });
  expect(comparison.width).toBe(viewport.width);
  if (baseline) {
    expect(comparison.comparisonStatus).toBe("compared");
    expect(comparison.differentPixels).toBe(0);
  }
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
  test(`owner app deletion flow at ${tag}`, async ({ page }, testInfo) => {
    test.setTimeout(180000);
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.setViewportSize(viewport);
    const deletionToast = page.getByRole("status").filter({
      hasText: /^앱을 삭제했어요\.$/,
    });
    let detail = await openOwnerDetail(page);
    await capture(
      page,
      "delete-cancel",
      viewport,
      testInfo,
      "15-delete-cancel.png",
    );

    await detail.getByRole("button", { name: "삭제", exact: true }).click();
    let prompt = page.locator(
      '[aria-labelledby="app-delete-confirmation-title"]',
    );
    await expect(prompt).toBeVisible();
    await capture(
      page,
      "delete-confirm",
      viewport,
      testInfo,
      "14-delete-confirm.png",
    );
    await prompt.getByRole("button", { name: "취소", exact: true }).click();
    await expect(prompt).toHaveCount(0);

    await setScenario(page, "app_key_issue_failure");
    await detail.getByRole("button", { name: "삭제", exact: true }).click();
    prompt = page.locator('[aria-labelledby="app-delete-confirmation-title"]');
    await expect(prompt).toBeVisible();
    await prompt
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제 작업을 준비하지 못했어요",
    );
    await capture(page, "delete-key-rejected", viewport, testInfo);
    await prompt.getByRole("button", { name: "취소", exact: true }).click();

    await setScenario(page, "app_delete_unresolved");
    await detail.getByRole("button", { name: "삭제", exact: true }).click();
    prompt = page.locator('[aria-labelledby="app-delete-confirmation-title"]');
    await expect(prompt).toBeVisible();
    await prompt
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제 결과를 확인할 수 없어요",
    );
    await prompt
      .getByRole("button", { name: "삭제 결과 확인", exact: true })
      .click();
    await expect(
      prompt.getByRole("button", {
        name: "같은 삭제 요청 다시 보내기",
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "delete-unresolved", viewport, testInfo);
    await setScenario(page, "original");
    await prompt
      .getByRole("button", { name: "같은 삭제 요청 다시 보내기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(deletionToast).toBeVisible();

    detail = await openOwnerDetail(page);
    await setScenario(page, "app_delete_pending_confirmation");
    await detail.getByRole("button", { name: "삭제", exact: true }).click();
    prompt = page.locator('[aria-labelledby="app-delete-confirmation-title"]');
    await expect(prompt).toBeVisible();
    await prompt
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제는 반영되었고 결과 확인을 기다리고 있어요",
    );
    await capture(page, "delete-pending-confirmation", viewport, testInfo);
    await prompt
      .getByRole("button", { name: "삭제 결과 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제 결과 확인을 기다리고 있어요",
    );
    await capture(page, "delete-confirming", viewport, testInfo);
    await prompt
      .getByRole("button", { name: "같은 삭제 요청 다시 보내기", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(deletionToast).toBeVisible();

    detail = await openOwnerDetail(page);
    await setScenario(page, "app_delete_unknown");
    await detail.getByRole("button", { name: "삭제", exact: true }).click();
    prompt = page.locator('[aria-labelledby="app-delete-confirmation-title"]');
    await expect(prompt).toBeVisible();
    await prompt
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제 결과를 확인할 수 없어요",
    );
    await capture(page, "delete-unknown", viewport, testInfo);
    await prompt
      .getByRole("button", { name: "삭제 결과 확인", exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await expect(deletionToast).toBeVisible();

    detail = await openOwnerDetail(page);
    await setScenario(page, "app_delete_unknown");
    await detail.getByRole("button", { name: "삭제", exact: true }).click();
    prompt = page.locator('[aria-labelledby="app-delete-confirmation-title"]');
    await prompt
      .getByRole("button", { name: "삭제 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제 결과를 확인할 수 없어요",
    );
    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({
          ...state,
          mock_now: "2026-09-24T00:12:00.000Z",
          principal_session: {
            ...state.principal_session,
            expires_at: "2026-09-25T00:12:00.000Z",
          },
        }),
      );
    });
    await prompt
      .getByRole("button", { name: "삭제 결과 확인", exact: true })
      .click();
    await expect(prompt.getByRole("alert")).toContainText(
      "삭제 결과 확인 기간이 지나",
    );
    await expect(
      prompt.getByRole("button", {
        name: "같은 삭제 요청 다시 보내기",
        exact: true,
      }),
    ).toHaveCount(0);
    await capture(page, "delete-expired", viewport, testInfo);
  });
}
