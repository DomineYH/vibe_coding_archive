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
  const form = page.locator("form");
  await expect(form).toBeVisible();
  const loginIdInput = form.getByLabel("로그인 아이디", { exact: true });
  const passwordInput = form.getByLabel("비밀번호", { exact: true });
  await expect(loginIdInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await loginIdInput.fill(loginId);
  await passwordInput.fill(password);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
}

async function register(
  page,
  {
    loginId = "new-teacher-1",
    password = "correct horse battery staple",
    passwordConfirm = password,
    nickname = "새 교사",
    email = "",
    phone = "",
  } = {},
) {
  const form = page.locator("form");
  await expect(form).toBeVisible();
  await form.getByLabel(/^로그인 아이디/).fill(loginId);
  await form.getByLabel(/^비밀번호 \(필수\)$/).fill(password);
  await form.getByLabel(/^비밀번호 확인/).fill(passwordConfirm);
  await form.getByLabel(/^별명/).fill(nickname);
  await form.getByLabel(/^이메일/).fill(email);
  await form.getByLabel(/^연락처/).fill(phone);
  await form.getByRole("button", { name: "가입 신청하기" }).click();
}

async function reset(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
}

async function capture(
  page,
  state,
  viewport,
  testInfo,
  baseline = null,
  waitForFrames = true,
) {
  await page.evaluate(async (waitForFrames) => {
    await document.fonts.ready;
    if (waitForFrames) {
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
    }
  }, waitForFrames);
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
  const result = {
    state,
    viewport,
    baseline,
    screenshot: name,
    ...comparison,
  };
  results.push(result);
  writeFileSync(
    path.join(outputRoot, name.replace(/\.png$/, ".json")),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  writeFileSync(
    path.join(outputRoot, "visual-comparison.json"),
    `${JSON.stringify({ thresholdPixels: 0, results }, null, 2)}\n`,
  );
  await testInfo.attach(name, { body: actual, contentType: "image/png" });
  expect(comparison.width).toBe(viewport.width);
  if (baseline) {
    expect(comparison.comparisonStatus).toBe("compared");
    expect(comparison.differentPixels).toBe(0);
  }
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
    await page.goto("/auth?mode=signup");
    await expect(page.getByLabel("비밀번호 확인")).toBeVisible();
    await capture(page, "auth-signup", viewport, testInfo, "09-signup.png");

    await reset(page, viewport);
    await page.goto("/auth?mode=signup");
    await register(page, { passwordConfirm: "mismatch" });
    await expect(page.locator("#password-confirm-error")).toBeVisible();
    await capture(
      page,
      "auth-signup-confirm-error",
      viewport,
      testInfo,
      "10-signup-error.png",
    );

    await reset(page, viewport);
    await page.goto("/auth?mode=signup");
    await register(page, { loginId: "ADMIN" });
    await expect(page.locator("#login-id-error")).toBeVisible();
    await capture(page, "auth-signup-duplicate", viewport, testInfo);

    await reset(page, viewport);
    await page.goto("/auth?mode=signup");
    await register(page, {
      email: "teacher@example.invalid",
      phone: "+00 000-0000-0000",
    });
    await expect(page.locator("#email-error")).toBeVisible();
    await expect(page.locator("#phone-error")).toBeVisible();
    await capture(page, "auth-signup-collection-disabled", viewport, testInfo);

    await reset(page, viewport);
    await page.goto("/auth?mode=signup");
    await register(page);
    await expect(
      page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
    ).toBeVisible();
    await capture(page, "auth-signup-pending", viewport, testInfo);

    await page.getByRole("link", { name: "로그인 화면으로" }).click();
    await login(page, "new-teacher-1", "correct horse battery staple");
    await expect(page.getByRole("alert")).toContainText(
      "승인 대기 중인 계정입니다",
    );
    await capture(page, "auth-signup-login-pending", viewport, testInfo);

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
    const loginForm = page.locator("form");
    await expect(loginForm).toBeVisible();
    await loginForm
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(
      loginForm.getByLabel("로그인 아이디", { exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
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
    const lostResponseForm = page.locator('[data-screen-label="로그인"] form');
    await expect(lostResponseForm).toBeVisible();
    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "auth_response_lost" }),
      );
    });
    await lostResponseForm
      .getByLabel("로그인 아이디", { exact: true })
      .fill("교사김코딩");
    await lostResponseForm.getByLabel("비밀번호", { exact: true }).fill("1234");
    await lostResponseForm
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "인증 결과를 확인할 수 없어요",
    );
    await capture(page, "auth-result-unresolved", viewport, testInfo);

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    const missingSessionForm = page.locator(
      '[data-screen-label="로그인"] form',
    );
    await expect(missingSessionForm).toBeVisible();
    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "auth_session_cookie_lost" }),
      );
    });
    await missingSessionForm
      .getByLabel("로그인 아이디", { exact: true })
      .fill("교사김코딩");
    await missingSessionForm
      .getByLabel("비밀번호", { exact: true })
      .fill("1234");
    await missingSessionForm
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(
      page.getByRole("main").getByRole("button", {
        name: "받지 못한 세션 버리기",
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "auth-missing-session-cookie", viewport, testInfo);

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

    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "auth_delayed" }),
      );
    });
    const privateHeading = page.getByRole("heading", {
      name: "과학 수행평가 루브릭 채점기",
      exact: true,
    });
    const privateMain = page.getByRole("main");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(
      privateMain.getByRole("status").filter({
        hasText: "화면이 잠시 가려졌습니다",
      }),
    ).toBeVisible();
    await expect(privateHeading).toHaveCount(0);
    await capture(page, "private-detail-concealed", viewport, testInfo);

    await page.clock.pauseAt(new Date(Date.now() + 60_000));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      privateMain.getByRole("status").filter({
        hasText: "로그인 상태를 확인하고 있습니다",
      }),
    ).toBeVisible();
    await capture(
      page,
      "private-auth-checking",
      viewport,
      testInfo,
      null,
      false,
    );
    await page.clock.runFor(300);
    await page.clock.resume();
    await expect(privateHeading).toBeVisible();

    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "auth_observation_error" }),
      );
      window.dispatchEvent(new StorageEvent("storage", { key }));
    });
    await expect(
      privateMain.getByRole("alert").filter({
        hasText: "로그인 상태를 확인할 수 없습니다",
      }),
    ).toBeVisible();
    await expect(privateHeading).toHaveCount(0);
    await capture(page, "private-auth-error", viewport, testInfo);

    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(
        key,
        JSON.stringify({ ...state, scenario: "original" }),
      );
    });
    await privateMain
      .getByRole("button", { name: "다시 확인", exact: true })
      .click();
    await expect(privateHeading).toBeVisible();
    await capture(page, "private-detail-restored", viewport, testInfo);

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
      page.getByRole("heading", { name: "관리자 대시보드", exact: true }),
    ).toBeVisible();

    await reset(page, viewport);
    await page.goto("/auth?mode=login");
    const temporaryLoginForm = page.locator(
      '[data-screen-label="로그인"] form',
    );
    await expect(temporaryLoginForm).toBeVisible();
    await temporaryLoginForm.locator("#login-id").fill("임시교사38");
    await temporaryLoginForm
      .locator("#login-password")
      .fill("Temporary Demo Password 38");
    await temporaryLoginForm
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(page).toHaveURL(/mode=password-change/);
    const passwordChange = page.locator('[data-screen-label="비밀번호 변경"]');
    await expect(passwordChange).toBeVisible();
    await expect(passwordChange.locator("#new-password")).toBeVisible();
    await capture(page, "auth-password-change", viewport, testInfo);
  });
}
