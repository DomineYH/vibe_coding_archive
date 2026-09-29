import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blockExternalRequests, loopbackHosts } from "./helpers.js";

const catalog = createRequire(import.meta.url)("../../contracts/catalog.json");

const viewports = [
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 900 },
  { width: 1440, height: 1000 },
];
const captureDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/evidence/phase-2/issue81/2026-09-29/visual/api-mode",
);

async function inspectViewport(page, viewport, state, testInfo) {
  await page.setViewportSize(viewport);
  const status =
    state === "loading"
      ? page.locator('[data-screen-label="갤러리"]').getByRole("status")
      : page.getByRole("alert");
  const expectedText = {
    failure: "공개 아카이브를 불러오지 못했어요",
    loading: "공개 아카이브를 불러오는 중이에요",
    unavailable: "공개 아카이브를 현재 사용할 수 없어요.",
  }[state];
  await expect(status).toContainText(expectedText);
  if (state !== "loading")
    await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "앱·작성자 검색" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport.width);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });

  const name = `${state}-${viewport.width}x${viewport.height}`;
  await mkdir(captureDirectory, { recursive: true });
  await page.screenshot({
    path: path.join(captureDirectory, `${name}-full.png`),
    fullPage: true,
    animations: "disabled",
  });
  await status.screenshot({
    path: path.join(captureDirectory, `${name}-status.png`),
    animations: "disabled",
  });
  await testInfo.attach(`${name}-full`, {
    path: path.join(captureDirectory, `${name}-full.png`),
    contentType: "image/png",
  });
}

test("API metadata failure retries through the real server before public reads", async ({
  page,
  context,
}) => {
  const requests = [];
  const externalRequests = [];
  let metaCalls = 0;
  let allowRealMeta = false;
  let releaseRealMeta = () => {};
  const realMetaGate = new Promise((resolve) => {
    releaseRealMeta = resolve;
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (!loopbackHosts.has(url.hostname)) externalRequests.push(url.hostname);
  });
  await blockExternalRequests(context);
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
    await realMetaGate;
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

  for (const viewport of viewports)
    await inspectViewport(page, viewport, "failure", test.info());

  await retry.focus();
  const realMetaPromise = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/meta") && response.status() === 200,
  );
  allowRealMeta = true;
  const loading = page
    .locator('[data-screen-label="갤러리"]')
    .getByRole("status");
  try {
    await page.keyboard.press("Enter");
    await expect(loading).toContainText("공개 아카이브를 불러오는 중이에요");
    await expect(page.locator('[data-screen-label="갤러리"]')).toBeFocused();
    for (const viewport of viewports)
      await inspectViewport(page, viewport, "loading", test.info());
  } finally {
    releaseRealMeta();
  }

  const response = await realMetaPromise;
  const metadata = await response.json();

  expect(metadata.subjects).toEqual(catalog.subjects);
  expect(metadata.grades).toEqual(catalog.grades);
  expect(metadata.themes).toEqual(catalog.themes);
  expect(metadata.capabilities.apps_read).toEqual({
    enabled: true,
    reasons: [],
  });
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(
    page.getByRole("textbox", { name: "앱·작성자 검색" }),
  ).toBeVisible();
  expect(metaCalls).toBe(failedMetaCalls + 1);
  expect(requests).toContain("/api/v1/meta");
  expect(requests).toContain("/api/v1/apps");
  expect(requests.some((path) => path.startsWith("/api/v1/auth/"))).toBe(false);
  expect(requests.some((path) => path.includes("csrf"))).toBe(false);
});
