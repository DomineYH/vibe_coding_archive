import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const catalog = createRequire(import.meta.url)("../../contracts/catalog.json");
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const viewports = [
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];

test("API metadata failure retries through the real server without enabling unavailable reads", async ({
  page,
  context,
}) => {
  const requests = [];
  const externalRequests = [];
  let metaCalls = 0;
  let allowRealMeta = false;
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (!LOOPBACK_HOSTS.has(url.hostname))
      externalRequests.push(url.hostname);
  });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return LOOPBACK_HOSTS.has(url.hostname)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.route("**/api/v1/meta", async (route) => {
    metaCalls += 1;
    if (!allowRealMeta) {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Public service error",
            request_id: "api-e2e",
          },
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  const externalFetchRejected = await page.evaluate(async () => {
    try {
      await fetch("https://outside.invalid/api");
      return false;
    } catch {
      return true;
    }
  });
  expect(externalFetchRejected).toBe(true);
  expect(externalRequests).toEqual(["outside.invalid"]);
  const failure = page.getByRole("alert");
  await expect(failure).toContainText("공개 아카이브를 불러오지 못했어요");
  const failedMetaCalls = metaCalls;
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toHaveAccessibleName("다시 시도");
  await retry.focus();
  const realMetaPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/meta") && response.status() === 200,
  );
  allowRealMeta = true;
  await page.keyboard.press("Enter");
  const loading = page
    .locator('[data-screen-label="갤러리"]')
    .getByRole("status");
  await expect(loading).toContainText("공개 아카이브를 불러오는 중이에요");
  await expect(page.locator('[data-screen-label="갤러리"]')).toBeFocused();
  const response = await realMetaPromise;
  const metadata = await response.json();

  expect(metadata.subjects).toEqual(catalog.subjects);
  expect(metadata.grades).toEqual(catalog.grades);
  expect(metadata.themes).toEqual(catalog.themes);
  expect(metadata.capabilities.apps_read).toEqual({
    enabled: false,
    reasons: ["not_implemented"],
  });
  await expect(page.getByRole("alert")).toContainText(
    "공개 아카이브를 현재 사용할 수 없어요.",
  );
  await expect(
    page.getByRole("textbox", { name: "앱·작성자 검색" }),
  ).toBeVisible();
  expect(metaCalls).toBe(failedMetaCalls + 1);
  expect(requests).toContain("/api/v1/meta");
  expect(requests).not.toContain("/api/v1/apps");
  expect(requests.some((path) => path.startsWith("/api/v1/auth/"))).toBe(false);
  expect(requests.some((path) => path.includes("csrf"))).toBe(false);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "앱·작성자 검색" }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
  }
});
