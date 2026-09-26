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
    await form
      .getByRole("button", { name: "저장 결과 확인", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "저장 결과 확인 기간이 지나",
    );
    await expect(
      form.getByRole("button", { name: "같은 요청 다시 보내기", exact: true }),
    ).toHaveCount(0);
    await capture(page, "app-create-expired", viewport, testInfo);
  });

  test(`app edit form at ${tag}`, async ({ page }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page);
    await page.goto("/apps/00000000-0000-4000-8000-000000000091/edit");
    await expect(page).toHaveURL(/\/apps\/[^/]+\/edit$/);
    const form = page.getByRole("form", { name: "앱 수정 양식", exact: true });
    await expect(form).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "앱 정보 편집", exact: true }),
    ).toBeVisible();
    await expect(
      form.getByRole("textbox", {
        name: "어플리케이션 이름",
        exact: true,
      }),
    ).toHaveValue("과학 수행평가 루브릭 채점기");
    await expect(
      form.getByRole("switch", { name: "전체 공개", exact: true }),
    ).toHaveAttribute("aria-checked", "false");
    await expect(
      form.getByRole("button", { name: "테마 Niagara 선택", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await capture(page, "app-edit", viewport, testInfo, "13-edit.png");

    const name = form.getByRole("textbox", {
      name: "어플리케이션 이름",
      exact: true,
    });
    await name.fill("충돌 뒤에도 보존할 초안");
    const otherPage = await page.context().newPage();
    await otherPage.goto("/apps/00000000-0000-4000-8000-000000000091/edit");
    const otherForm = otherPage.getByRole("form", {
      name: "앱 수정 양식",
      exact: true,
    });
    await expect(otherForm).toBeVisible();
    await otherForm
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
      .fill("먼저 저장한 편집");
    await otherForm
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(
      otherPage.getByRole("heading", { name: "먼저 저장한 편집", exact: true }),
    ).toBeVisible();
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "앱이 다른 내용으로 수정되었어요",
    );
    await expect(name).toHaveValue("충돌 뒤에도 보존할 초안");
    await capture(page, "app-edit-version-conflict", viewport, testInfo);

    await setScenario(page, "auth_observation_error");
    await form
      .getByRole("button", { name: "최신 내용 불러오기", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "최신 내용을 불러오지 못했어요",
    );
    await expect(name).toHaveValue("충돌 뒤에도 보존할 초안");
    await capture(page, "app-edit-latest-unavailable", viewport, testInfo);
    await setScenario(page, "original");
    await form
      .getByRole("button", { name: "최신 내용 불러오기", exact: true })
      .click();
    await expect(name).toHaveValue("먼저 저장한 편집");
    await name.fill("");
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "표시된 항목을 확인해 주세요",
    );
    await capture(page, "app-edit-validation-error", viewport, testInfo);

    await name.fill("거절된 수정 내용");
    await setScenario(page, "app_update_failure");
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "앱을 수정하지 못했어요",
    );
    await capture(page, "app-edit-rejected", viewport, testInfo);

    await name.fill("응답 확인이 필요한 수정");
    await setScenario(page, "app_update_unknown");
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(
      form.getByRole("button", { name: "저장 결과 확인", exact: true }),
    ).toBeVisible();
    await capture(page, "app-edit-unknown", viewport, testInfo);
    await otherPage.close();
  });

  test(`conceals an unresolved create draft during auth checks at ${tag}`, async ({
    page,
  }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page);
    await page.goto("/apps/new");
    await expect(page).toHaveURL(/\/apps\/new$/);
    const form = await fillValidForm(page);
    await setScenario(page, "app_create_unresolved");
    await form
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await expect(
      form.getByRole("button", { name: "저장 결과 확인", exact: true }),
    ).toBeVisible();

    await setScenario(page, "auth_observation_error");
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    const status = page
      .getByRole("main")
      .getByText("로그인 상태를 확인할 수 없어요", { exact: true });
    await expect(status).toBeVisible();
    await expect(form).toBeHidden();
    await capture(page, "app-create-auth-concealed", viewport, testInfo);
  });

  test(`shows confirmed create when its target is later unavailable at ${tag}`, async ({
    page,
  }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page);
    await page.goto("/apps/new");
    await expect(page).toHaveURL(/\/apps\/new$/);
    const form = await fillValidForm(page);
    await setScenario(page, "app_create_unknown");
    await form
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await expect(
      form.getByRole("button", { name: "저장 결과 확인", exact: true }),
    ).toBeVisible();
    const appId = await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      const target = [...state.apps, ...state.private_apps].find(
        (app) => app.name === "시각 비교용 앱",
      );
      if (!target) return null;
      localStorage.setItem(
        key,
        JSON.stringify({
          ...state,
          apps: state.apps.filter((app) => app.id !== target.id),
          private_apps: state.private_apps.filter(
            (app) => app.id !== target.id,
          ),
        }),
      );
      return target.id;
    });
    expect(appId).toBeTruthy();
    await form
      .getByRole("button", { name: "저장 결과 확인", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/apps/${appId}$`));
    await expect(page.getByRole("alert")).toContainText(
      "아카이브 앱을 찾을 수 없어요",
    );
    await expect(
      page.getByText("앱을 등록했어요.", { exact: true }),
    ).toBeVisible();
    await capture(page, "app-create-target-missing", viewport, testInfo);
  });

  test(`private app detail after owner update at ${tag}`, async ({
    page,
  }, testInfo) => {
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.setViewportSize(viewport);
    await page.goto("/");
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await login(page);
    await page.goto("/apps/00000000-0000-4000-8000-000000000091");
    const detail = page.locator('[data-screen-label="비공개 앱 상세"]');
    await expect(detail).toBeVisible();
    await expect(
      detail.getByRole("link", { name: "앱 수정", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(viewport.width);
    await capture(
      page,
      "app-detail-private",
      viewport,
      testInfo,
      "12-detail-private.png",
    );
  });
}
