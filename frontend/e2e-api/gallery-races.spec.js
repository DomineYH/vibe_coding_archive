import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  deferred,
  disableAutomaticPagination,
} from "./helpers.js";

test("does not let a late search response replace the newest query", async ({
  page,
  context,
}) => {
  const oldGate = deferred();
  const oldRequestStarted = deferred();
  const oldRequestSettled = deferred();
  const isOldSearch = (request) =>
    new URL(request.url()).searchParams.get("q") === "추가 공개 앱";
  await blockExternalRequests(context);
  page.on("requestfinished", (request) => {
    if (isOldSearch(request)) oldRequestSettled.resolve();
  });
  page.on("requestfailed", (request) => {
    if (isOldSearch(request)) oldRequestSettled.resolve();
  });
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱"
    ) {
      const response = await route.fetch();
      oldRequestStarted.resolve();
      await oldGate.promise;
      try {
        await route.fulfill({ response });
      } catch {
        // The current search may cancel the held request before it is released.
      }
      return;
    }
    return route.continue();
  });

  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱");
  await oldRequestStarted.promise;
  await search.fill("추가 공개 앱 27");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  oldGate.resolve();
  await oldRequestSettled.promise;
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
});

test("ignores a late retry response after changing the active search", async ({
  page,
  context,
}) => {
  let nextCalls = 0;
  const retryGate = deferred();
  const retryRequest = deferred();
  const retryRequestHandled = deferred();
  await blockExternalRequests(context);
  await disableAutomaticPagination(page);
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname !== "/api/v1/apps" ||
      url.searchParams.get("offset") !== "24"
    )
      return route.continue();
    nextCalls += 1;
    if (nextCalls === 1)
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Public service error",
            request_id: "issue82-stale-retry",
          },
        }),
      });
    const response = await route.fetch();
    retryRequest.resolve();
    await retryGate.promise;
    try {
      await route.fulfill({ response });
    } catch {
      // The current search may cancel the held request before it is released.
    } finally {
      retryRequestHandled.resolve();
    }
  });

  await page.goto("/?q=%EC%B6%94%EA%B0%80%20%EA%B3%B5%EA%B0%9C%20%EC%95%B1");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toBeVisible();
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.getByRole("button", { name: "다시 시도" }).click();
  await retryRequest.promise;

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱 27");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  retryGate.resolve();
  await retryRequestHandled.promise;
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
});

test("ignores a late ordinary next page after changing the active search", async ({
  page,
  context,
}) => {
  const pageGate = deferred();
  const pageStarted = deferred();
  const pageSettled = deferred();
  await blockExternalRequests(context);
  await disableAutomaticPagination(page);
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname !== "/api/v1/apps" ||
      url.searchParams.get("offset") !== "24" ||
      url.searchParams.has("q")
    )
      return route.continue();
    const response = await route.fetch();
    pageStarted.resolve();
    try {
      await pageGate.promise;
      await route.fulfill({ response });
    } catch {
      // The changed search can cancel the held page before it is released.
    } finally {
      pageSettled.resolve();
    }
  });

  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await pageStarted.promise;

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱 27");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();

  pageGate.resolve();
  await pageSettled.promise;
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
});
