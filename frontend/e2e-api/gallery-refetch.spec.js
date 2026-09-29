import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  deferred,
  disableAutomaticPagination,
} from "./helpers.js";
import { captureGalleryState } from "./gallery-helpers.js";

test("keeps old gallery cards hidden after a refetch failure and retries by keyboard", async ({
  page,
  context,
}) => {
  let listRequests = 0;
  const listRequestQueries = [];
  let failRefetchUntilRetry = false;
  let failedRefetches = 0;
  let holdRetry = false;
  const retryGate = deferred();
  const retryRequest = deferred();
  const retrySettled = deferred();
  await blockExternalRequests(context);
  await disableAutomaticPagination(page);
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/apps") return route.continue();
    listRequests += 1;
    listRequestQueries.push(url.searchParams);
    if (failRefetchUntilRetry) {
      failedRefetches += 1;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Public service error",
            request_id: "issue82-refetch",
          },
        }),
      });
    }
    if (holdRetry) {
      holdRetry = false;
      const response = await route.fetch();
      retryRequest.resolve();
      await retryGate.promise;
      try {
        await route.fulfill({ response });
      } finally {
        retrySettled.resolve();
      }
      return;
    }
    return route.continue();
  });

  await page.goto(
    `/?q=${encodeURIComponent("추가 공개 앱")}&subject=${encodeURIComponent("수학")}&grade=${encodeURIComponent("초1")}`,
  );
  await expect(page.locator("a.card-r")).toHaveCount(24);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  const subject = page.getByRole("button", { name: "수학", exact: true });
  const grade = page.getByRole("combobox", { name: "학년 필터" });
  await expect(search).toHaveValue("추가 공개 앱");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  await expect(grade).toHaveValue("초1");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  const positionBeforeDetail = await page.evaluate(() => window.scrollY);
  const displayedIds = await page
    .locator("a.card-r")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("href").slice("/apps/".length)),
    );
  await page.locator(`a.card-r[href="/apps/${displayedIds.at(-1)}"]`).click();
  await expect(page.getByRole("button", { name: "갤러리로" })).toBeVisible();
  const requestsBeforeReturn = listRequests;
  failRefetchUntilRetry = true;
  await page.getByRole("button", { name: "갤러리로" }).click();
  await expect.poll(() => failedRefetches).toBeGreaterThan(0);
  const failedRefetchQueries = listRequestQueries.slice(requestsBeforeReturn);
  expect(failedRefetchQueries).toHaveLength(failedRefetches);
  for (const query of failedRefetchQueries) {
    expect(query.get("q")).toBe("추가 공개 앱");
    expect(query.get("subject")).toBe("수학");
    expect(query.get("grade")).toBe("초1");
    expect(query.get("offset")).toBe("0");
  }
  await expect(search).toHaveValue("추가 공개 앱");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  await expect(grade).toHaveValue("초1");
  await expect(page.getByRole("alert")).toContainText(
    "공개 아카이브를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  for (const id of displayedIds)
    await expect(page.locator(`a.card-r[href="/apps/${id}"]`)).toHaveCount(0);
  await captureGalleryState(page, "refetch-error");

  failRefetchUntilRetry = false;
  const retry = page.getByRole("button", { name: "다시 시도" });
  const requestsBeforeRetry = listRequests;
  holdRetry = true;
  await retry.focus();
  await page.keyboard.press("Enter");
  await retryRequest.promise;
  expect(listRequests).toBe(requestsBeforeRetry + 1);
  await expect(page.getByRole("main")).toBeFocused();
  await captureGalleryState(page, "refetch-retry-loading");
  retryGate.resolve();
  await retrySettled.promise;
  await expect(page.locator("a.card-r")).toHaveCount(24);
  for (const id of displayedIds)
    await expect(page.locator(`a.card-r[href="/apps/${id}"]`)).toHaveCount(1);
  expect(listRequests).toBe(requestsBeforeRetry + 1);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBe(positionBeforeDetail);
});

test("hides old cards while a new API filter is loading", async ({
  page,
  context,
}) => {
  const responseGate = deferred();
  const requestStarted = deferred();
  const requestSettled = deferred();
  await blockExternalRequests(context);
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname !== "/api/v1/apps" ||
      url.searchParams.get("q") !== "추가 공개 앱 27"
    )
      return route.continue();
    const response = await route.fetch();
    requestStarted.resolve();
    try {
      await responseGate.promise;
      await route.fulfill({ response });
    } finally {
      requestSettled.resolve();
    }
  });

  await page.goto("/");
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(24);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await expect(search).toHaveAccessibleName("앱·작성자 검색");
  await search.fill("추가 공개 앱 27");
  await requestStarted.promise;

  await expect(cards).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({
      hasText: "공개 아카이브를 불러오는 중이에요",
    }),
  ).toContainText("공개 아카이브를 불러오는 중이에요");
  await expect(search).toBeVisible();
  await captureGalleryState(page, "new-filter-loading");

  responseGate.resolve();
  await requestSettled.promise;
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  await expect(cards).toHaveCount(1);
});
