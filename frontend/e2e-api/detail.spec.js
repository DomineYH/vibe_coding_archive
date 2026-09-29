import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blockExternalRequests,
  deferred,
  loopbackHosts,
  prepareViewportCapture,
  viewports,
} from "./helpers.js";

const detailId = "00000000-0000-4000-8000-000000000001";
const privateId = "00000000-0000-4000-8000-000000000028";
const missingId = "00000000-0000-4000-8000-000000000099";
const expectedName = "긴 공개 수업 도구 ".repeat(7).trim();
const expectedNickname = `공개 별명 ${"초등 수학 탐구 연구자 ".repeat(7).trim()}`;
const expectedUrl =
  `https://example.test/${"classroom-resource/".repeat(12)}` +
  "?lesson=fractions&mode=teacher#chapter-2";
const expectedStack = {
  database: "PostgreSQL · Neon",
  backend: "FastAPI · SQLAlchemy",
  frontend: "React · Vite",
  hosting: "Cloudflare Pages",
};
const captureDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/evidence/phase-2/issue83/2026-09-29/visual/api-mode",
);
const expectedDescription = [
  "첫째 줄  앞 공백",
  "",
  "둘째 줄\t들여쓰기",
  '<img src=x onerror="window.issue83Injected=true">',
  ...Array.from({ length: 24 }, (_, index) =>
    `긴 설명 경계 줄 ${String(index).padStart(2, "0")} - 활용 안내 `.repeat(4),
  ),
  "마지막 줄  ",
].join("\n");
const expectedPrompt = [
  "프롬프트 첫 줄  ",
  "  둘째 줄",
  "",
  "<script>window.issue83Injected=true</script>",
  ...Array.from(
    { length: 40 },
    (_, index) =>
      `긴 프롬프트 경계 줄 ${String(index).padStart(2, "0")} - ` +
      "활용 안내 ".repeat(18),
  ),
  "마지막 프롬프트 줄\t",
].join("\n");

async function capture(page, state, viewport) {
  await prepareViewportCapture(page, viewport);
  await mkdir(captureDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(
      captureDirectory,
      `${state}-${viewport.width}x${viewport.height}.png`,
    ),
    fullPage: true,
    animations: "disabled",
  });
}

test("reads the real long detail, rejects query input, and reloads without private calls", async ({
  page,
  context,
}) => {
  const requests = [];
  const externalRequests = [];
  const writeRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (url.pathname.startsWith("/api/v1/") && request.method() !== "GET")
      writeRequests.push(`${request.method()} ${url.pathname}`);
    if (!loopbackHosts.has(url.hostname)) externalRequests.push(url.hostname);
  });
  await blockExternalRequests(context);

  const response = await page.request.get(`/api/v1/apps/${detailId}`);
  expect(response.status()).toBe(200);
  const responseBody = await response.text();
  for (const sentinel of [
    "private-login-sentinel",
    "email-sentinel",
    "phone-sentinel",
    "password-hash-sentinel",
  ])
    expect(responseBody).not.toContain(sentinel);
  const { item } = JSON.parse(responseBody);
  expect(item.name).toBe(expectedName);
  expect(item.owner.nickname).toBe(expectedNickname);
  expect(item.description).toBe(expectedDescription);
  expect(item.prompt).toBe(expectedPrompt);
  expect(item.url).toBe(expectedUrl);
  expect(item.stack_db).toBe(expectedStack.database);
  expect(item.stack_backend).toBe(expectedStack.backend);
  expect(item.stack_frontend).toBe(expectedStack.frontend);
  expect(item.stack_hosting).toBe(expectedStack.hosting);
  expect(item.health).toEqual({
    result: { state: "unchecked", checked_at: null, fresh_until: null },
    latest_job: null,
    next_check_at: null,
  });

  await page.goto(`/apps/${detailId}?tracking=1`);
  await expect(page.getByRole("alert")).toContainText(
    "검색 조건을 확인할 수 없어요",
  );
  expect(requests).not.toContain(`/api/v1/apps/${detailId}`);
  for (const viewport of viewports)
    await capture(page, "invalid-detail-query", viewport);

  const clearQuery = page.getByRole("button", { name: "조건 초기화" });
  await clearQuery.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(`/apps/${detailId}`);
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(expectedNickname);

  const description = page
    .locator("main section")
    .filter({
      has: page.getByRole("heading", { name: "상세 설명 · 활용 매뉴얼" }),
    })
    .locator("p");
  const prompt = page.locator("main pre");
  expect(await description.textContent()).toBe(item.description);
  expect(await prompt.textContent()).toBe(item.prompt);
  expect(await prompt.textContent()).toBe(expectedPrompt);
  expect(await description.textContent()).toBe(expectedDescription);
  const stack = page
    .locator("main aside section")
    .filter({ has: page.getByRole("heading", { name: "기술 스택" }) });
  for (const value of Object.values(expectedStack))
    await expect(stack).toContainText(value);
  await expect(page.getByText("초2", { exact: true })).toBeVisible();
  await expect(page.getByText("중1", { exact: true })).toBeVisible();
  await expect(page.locator("main img")).toHaveCount(0);
  await expect(page.locator("main script")).toHaveCount(0);
  expect(await page.evaluate(() => window.issue83Injected)).toBeUndefined();

  const externalLink = page.getByRole("link", { name: "앱 열기" });
  await expect(externalLink).toHaveAttribute("href", expectedUrl);
  await expect(externalLink).toHaveAttribute("target", "_blank");
  await expect(externalLink).toHaveAttribute("rel", "noopener noreferrer");
  await expect(page.getByText("2026-09-29", { exact: true })).toBeVisible();
  await expect(page.getByText("미검사", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("검사 이력 없음", { exact: true })).toBeVisible();
  await expect(
    page.getByText("검사 기록 없음", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(
    "private-login-sentinel",
  );
  await expect(page.locator("main")).not.toContainText("email-sentinel");
  await expect(page.locator("main")).not.toContainText("phone-sentinel");
  await expect(page.locator("main")).not.toContainText(
    "password-hash-sentinel",
  );
  for (const viewport of viewports) await capture(page, "detail", viewport);

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByRole("main")).not.toContainText(
    "private-login-sentinel",
  );
  const backgroundTab = await context.newPage();
  await backgroundTab.goto("about:blank");
  await page.bringToFront();
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  await backgroundTab.close();

  expect(requests).toContain("/api/v1/meta");
  expect(requests).toContain(`/api/v1/apps/${detailId}`);
  const apiRequests = requests.filter((route) => route.startsWith("/api/v1/"));
  expect(apiRequests.some((route) => route.startsWith("/api/v1/auth/"))).toBe(
    false,
  );
  expect(apiRequests.some((route) => route.includes("csrf"))).toBe(false);
  expect(apiRequests.some((route) => route.includes("health"))).toBe(false);
  expect(apiRequests.some((route) => route.includes("admin"))).toBe(false);
  expect(apiRequests).not.toContain("/api/v1/apps");
  expect(writeRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
  const stored = await page.evaluate(() =>
    JSON.stringify(Object.entries(localStorage)),
  );
  expect(stored).not.toContain("eduvibe-archive-mock-v1");
  expect(stored).not.toContain(expectedName);
  expect(stored).not.toContain("private-login-sentinel");
  expect(stored).not.toContain("password-hash-sentinel");
});

test("renders one not-found state for private, missing, and malformed details", async ({
  page,
  context,
}) => {
  const detailRequests = [];
  const authRequests = [];
  await blockExternalRequests(context);
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/apps/")) detailRequests.push(pathname);
    if (pathname.startsWith("/api/v1/auth/")) authRequests.push(pathname);
  });

  const privateResponse = await page.request.get(`/api/v1/apps/${privateId}`);
  const missingResponse = await page.request.get(`/api/v1/apps/${missingId}`);
  expect(privateResponse.status()).toBe(404);
  expect(missingResponse.status()).toBe(404);
  expect(await privateResponse.json()).toEqual(await missingResponse.json());

  await page.goto("/apps/not-a-uuid");
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  expect(detailRequests).toEqual([]);
  for (const viewport of viewports)
    await capture(page, "detail-not-found", viewport);

  await page.goto(`/apps/${privateId}`);
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await page.goto(`/apps/${missingId}`);
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  expect(detailRequests).toEqual([
    `/api/v1/apps/${privateId}`,
    `/api/v1/apps/${missingId}`,
  ]);

  await page.goto("/auth?mode=login&return_to=%2F%2Fevil.example");
  await expect(page.getByRole("alert")).toContainText(
    "로그인 주소를 확인해 주세요",
  );
  expect(detailRequests).toHaveLength(2);
  await page.goto("/admin?tab=health");
  await expect(page.locator("main").getByRole("status")).toContainText(
    "관리자 기능은 아직 준비 중이에요",
  );
  expect(authRequests).toEqual([]);
});

test("keeps detail transport failure visible until keyboard retry reaches the server", async ({
  page,
  context,
}) => {
  let detailCalls = 0;
  await blockExternalRequests(context);
  await page.route(`**/api/v1/apps/${detailId}`, (route) => {
    detailCalls += 1;
    return detailCalls === 1 ? route.abort("failed") : route.continue();
  });

  await page.goto(`/apps/${detailId}`);
  await expect(page.getByRole("alert")).toContainText(
    "상세 정보를 불러오지 못했어요",
  );
  await expect(page.getByRole("heading", { name: expectedName })).toHaveCount(
    0,
  );
  const retry = page.getByRole("button", { name: "다시 시도" });
  await expect(retry).toHaveAccessibleName("다시 시도");
  for (const viewport of viewports)
    await capture(page, "detail-network-error", viewport);

  await retry.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  expect(detailCalls).toBe(2);
});

test("keeps malformed detail responses as an explicit error until a real retry succeeds", async ({
  page,
  context,
}) => {
  let detailCalls = 0;
  const requests = [];
  await blockExternalRequests(context);
  page.on("request", (request) =>
    requests.push(new URL(request.url()).pathname),
  );
  await page.route(`**/api/v1/apps/${detailId}`, async (route) => {
    detailCalls += 1;
    if (detailCalls === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          item: { id: detailId },
          server_time: "2026-09-29T12:00:00.000Z",
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto(`/apps/${detailId}`);
  await expect(page.getByRole("alert")).toContainText(
    "상세 정보를 불러오지 못했어요",
  );
  await expect(page.getByRole("heading", { name: expectedName })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "다시 시도" }),
  ).toHaveAccessibleName("다시 시도");
  for (const viewport of viewports)
    await capture(page, "detail-contract-error", viewport);

  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  expect(detailCalls).toBe(2);
  expect(
    requests.filter((route) => route === `/api/v1/apps/${detailId}`),
  ).toHaveLength(2);
  expect(requests.some((route) => route.startsWith("/api/v1/auth/"))).toBe(
    false,
  );
  expect(requests.some((route) => route.includes("csrf"))).toBe(false);
  expect(
    requests.some(
      (route) => route.startsWith("/api/v1/") && route.includes("health"),
    ),
  ).toBe(false);
});

test("copies a real detail prompt through the fallback and restores selection and focus", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("permission denied")),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => true,
    });
  });

  await page.goto(`/apps/${detailId}`);
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  const copyButton = page.getByRole("button", { name: "복사하기" });
  await page.evaluate(() => {
    const text = document.querySelector("main pre").firstChild;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 6);
    document.getSelection().addRange(range);
  });
  expect(await page.evaluate(() => document.getSelection().toString())).toBe(
    "프롬프트 첫",
  );
  await copyButton.focus();
  await page.keyboard.press("Enter");

  const copiedButton = page.getByRole("button", { name: "복사됨" });
  await expect(copiedButton).toBeFocused();
  expect(await page.evaluate(() => document.getSelection().toString())).toBe(
    "프롬프트 첫",
  );
  await expect(page.locator("main textarea")).toHaveCount(0);
  await expect(page.locator("main").getByRole("status")).toHaveText("복사됨");
  for (const viewport of viewports)
    await capture(page, "detail-copy-success", viewport);
});

test("shows manual copy guidance when both clipboard methods fail", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("permission denied")),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: () => false,
    });
  });

  await page.goto(`/apps/${detailId}`);
  await expect(page.getByRole("heading", { name: expectedName })).toBeVisible();
  const copyButton = page.getByRole("button", { name: "복사하기" });
  await copyButton.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toHaveText(
    "복사하지 못했어요. 프롬프트를 선택해 직접 복사해 주세요.",
  );
  await expect(copyButton).toBeFocused();
  await expect(page.getByRole("button", { name: "복사됨" })).toHaveCount(0);
  await expect(page.getByText("복사됨", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("main").getByRole("status")).toHaveCount(0);
  await expect(page.locator("main textarea")).toHaveCount(0);
  for (const viewport of viewports)
    await capture(page, "detail-copy-failure", viewport);
});

test("ignores a late detail response after history returns to a different app", async ({
  page,
  context,
}) => {
  const heldResponse = deferred();
  const releaseResponse = deferred();
  let firstDetailSettled;
  const firstSettled = new Promise((resolve) => {
    firstDetailSettled = resolve;
  });
  await blockExternalRequests(context);
  await page.route(`**/api/v1/apps/${detailId}`, async (route) => {
    const response = await route.fetch();
    heldResponse.resolve();
    try {
      await releaseResponse.promise;
      await route.fulfill({ response });
    } catch {
      // The history transition may cancel this request before it is released.
    } finally {
      firstDetailSettled();
    }
  });

  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.locator(`a.card-r[href="/apps/${detailId}"]`).click();
  await heldResponse.promise;
  await page.goBack();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page
    .locator('a.card-r[href="/apps/00000000-0000-4000-8000-000000000002"]')
    .click();
  await expect(
    page.getByRole("heading", { name: "둘째 공개 앱" }),
  ).toBeVisible();

  releaseResponse.resolve();
  await firstSettled;
  await expect(
    page.getByRole("heading", { name: "둘째 공개 앱" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: expectedName })).toHaveCount(
    0,
  );
});
