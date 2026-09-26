import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const referenceRoot = path.resolve(
  "../docs/evidence/basic-design-runtime-20260922/reference",
);
const mockStorageKey = "eduvibe-archive-mock-v1";
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

    const member = page
      .getByRole("listitem")
      .filter({ has: page.getByText("교사김코딩", { exact: true }) });
    await member
      .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
      .click();
    await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
    await expect(
      page.locator('[data-screen-label="관리자 재인증"]'),
    ).toBeVisible();
    await capture(page, "admin-reauth", viewport, testInfo);

    const reauth = page.locator('[data-screen-label="관리자 재인증"]');
    const reauthForm = reauth.locator("form");
    await reauth
      .getByLabel("현재 관리자 비밀번호", { exact: true })
      .fill("wrong admin password");
    await reauthForm
      .getByRole("button", { name: "본인 확인", exact: true })
      .click();
    await expect(reauth.getByRole("alert")).toContainText(
      "현재 로그인은 유지됩니다",
    );
    await capture(page, "admin-reauth-invalid", viewport, testInfo);

    await reauth
      .getByLabel("현재 관리자 비밀번호", { exact: true })
      .fill("admin123");
    await reauthForm
      .getByRole("button", { name: "본인 확인", exact: true })
      .click();
    await expect(page).toHaveURL("/admin");
    const resetPanel = page.getByRole("region", {
      name: /임시 비밀번호 초기화 확인/,
    });
    await expect(
      resetPanel.getByLabel("임시 비밀번호", { exact: true }),
    ).toBeVisible();
    await capture(page, "admin-password-reset-form", viewport, testInfo);

    const temporaryPassword = "Visual temporary password for issue 44!";
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "admin_write_unresolved" }),
      );
    }, mockStorageKey);
    await resetPanel
      .getByLabel("임시 비밀번호", { exact: true })
      .fill(temporaryPassword);
    await resetPanel
      .getByLabel("임시 비밀번호 확인", { exact: true })
      .fill(temporaryPassword);
    await resetPanel
      .getByRole("button", { name: "초기화 확인", exact: true })
      .click();
    await expect(resetPanel.getByRole("status")).toContainText(
      "처리 결과가 아직 확정되지 않았어요",
    );
    await capture(page, "admin-password-reset-unknown", viewport, testInfo);
    await resetPanel
      .getByRole("button", { name: "초기화 요청 취소", exact: true })
      .click();
    await expect(resetPanel.getByRole("status")).toContainText(
      "초기화 요청 취소가 확정됐어요",
    );
    await capture(page, "admin-password-reset-cancelled", viewport, testInfo);
    await resetPanel.getByRole("button", { name: "닫기", exact: true }).click();
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "original" }),
      );
    }, mockStorageKey);

    await member
      .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
      .click();
    await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
    const secondReauth = page.locator('[data-screen-label="관리자 재인증"]');
    const secondForm = secondReauth.locator("form");
    await expect(secondForm).toBeVisible();
    await secondReauth
      .getByLabel("현재 관리자 비밀번호", { exact: true })
      .fill("admin123");
    await secondForm
      .getByRole("button", { name: "본인 확인", exact: true })
      .click();
    await expect(page).toHaveURL("/admin");
    await expect(
      resetPanel.getByLabel("임시 비밀번호", { exact: true }),
    ).toBeVisible();
    await resetPanel
      .getByLabel("임시 비밀번호", { exact: true })
      .fill(temporaryPassword);
    await resetPanel
      .getByLabel("임시 비밀번호 확인", { exact: true })
      .fill(temporaryPassword);
    await resetPanel
      .getByRole("button", { name: "초기화 확인", exact: true })
      .click();
    await expect(resetPanel.getByRole("status")).toContainText(
      "임시 비밀번호 설정이 확정됐어요",
    );
    await capture(page, "admin-password-reset-success", viewport, testInfo);
  });
}
