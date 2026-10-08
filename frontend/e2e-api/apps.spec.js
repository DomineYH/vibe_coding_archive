import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blockExternalRequests,
  disableAutomaticPagination,
  loopbackHosts,
  prepareViewportCapture,
  viewports,
} from "./helpers.js";
const captureDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/evidence/phase-2/issue81/2026-09-29/visual/api-mode",
);
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

test("public API gallery filters, paginates, opens, refreshes, and restores real SQLite data", async ({
  page,
  context,
}) => {
  const requests = [];
  const writeRequests = [];
  const externalRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requests.push(url.pathname);
    if (url.pathname.startsWith("/api/v1/") && request.method() !== "GET")
      writeRequests.push(`${request.method()} ${url.pathname}`);
    if (!loopbackHosts.has(url.hostname)) externalRequests.push(url.hostname);
  });
  await blockExternalRequests(context);
  await disableAutomaticPagination(page);

  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  expect(
    await page.request
      .get("/api/v1/meta")
      .then((response) => response.status()),
  ).toBe(200);
  const privateDetail = await page.request.get(
    "/api/v1/apps/00000000-0000-4000-8000-000000000028",
  );
  expect(privateDetail.status()).toBe(404);
  expect(await privateDetail.text()).not.toContain("private-app-sentinel");
  for (const viewport of viewports) await capture(page, "gallery", viewport);

  await page
    .getByRole("group", { name: "과목 필터" })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  const grade = page.getByRole("combobox", { name: "학년 필터" });
  await grade.selectOption("초1");
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("추가 공개 앱");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toBeVisible();
  const secondPage = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("offset") === "24" &&
      response.status() === 200
    );
  });
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await secondPage;
  await expect(page.locator("a.card-r")).toHaveCount(25);

  for (const viewport of viewports) await capture(page, "filtered", viewport);

  await search.fill("조건없는 자료");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toHaveCount(
    0,
  );
  for (const viewport of viewports)
    await capture(page, "zero-results", viewport);

  await search.fill("추가 공개 앱");
  const app = page.getByRole("link", { name: /추가 공개 앱 27/ });
  await expect(app).toBeVisible();
  await app.click();
  await expect(
    page.getByRole("heading", { name: "추가 공개 앱 27" }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("공개 별명");
  await expect(page.getByText("미검사", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("검사 기록 없음", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "앱 열기" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  for (const viewport of viewports) await capture(page, "detail", viewport);

  await page.reload();
  await expect(
    page.getByRole("heading", { name: "추가 공개 앱 27" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "갤러리로" }).click();
  await expect(
    page.getByRole("textbox", { name: "앱·작성자 검색" }),
  ).toHaveValue("추가 공개 앱");
  await expect(grade).toHaveValue("초1");
  expect(requests).toContain("/api/v1/meta");
  expect(requests).toContain("/api/v1/apps");
  expect(requests.some((path) => path.startsWith("/api/v1/auth/"))).toBe(false);
  expect(requests.some((path) => path.includes("csrf"))).toBe(false);
  await expect
    .poll(() =>
      requests.includes(
        "/api/v1/apps/00000000-0000-4000-8000-000000000027/health",
      ),
    )
    .toBe(true);
  expect([
    ...new Set(
      requests.filter(
        (path) => path.startsWith("/api/v1/") && path.includes("health"),
      ),
    ),
  ]).toEqual(["/api/v1/apps/00000000-0000-4000-8000-000000000027/health"]);
  expect(writeRequests).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test("an API list failure stays visible until explicit retry reaches the server", async ({
  page,
  context,
}) => {
  let failedListRequests = 0;
  const requests = [];
  page.on("request", (request) =>
    requests.push(new URL(request.url()).pathname),
  );
  await blockExternalRequests(context);
  await page.route("**/api/v1/apps**", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/v1/apps") {
      await route.continue();
      return;
    }
    failedListRequests += 1;
    if (failedListRequests === 1) {
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
  await expect(page.getByRole("alert")).toContainText(
    "공개 아카이브를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(0);
  for (const viewport of viewports) await capture(page, "list-error", viewport);

  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  expect(failedListRequests).toBeGreaterThanOrEqual(2);
  expect(requests.some((path) => path.startsWith("/api/v1/auth/"))).toBe(false);
  expect(requests.some((path) => path.includes("csrf"))).toBe(false);
});
