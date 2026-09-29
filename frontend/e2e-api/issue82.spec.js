import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  blockExternalRequests,
  prepareViewportCapture,
  viewports,
} from "./helpers.js";

const captureDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/evidence/phase-2/issue82/2026-09-29/visual/api-mode",
);

async function capture(page, state) {
  await mkdir(captureDirectory, { recursive: true });
  for (const viewport of viewports) {
    await prepareViewportCapture(page, viewport);
    await page.screenshot({
      path: path.join(
        captureDirectory,
        `${state}-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }
}

test("preserves an over-limit direct search query without requesting a wider list", async ({
  page,
  context,
}) => {
  const listRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps") listRequests.push(url.search);
  });
  await blockExternalRequests(context);

  await page.goto(`/?q=${encodeURIComponent("ß".repeat(51))}`);

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await expect(search).toHaveValue("ß".repeat(51));
  await expect(page.getByRole("alert")).toContainText("검색어가 너무 길어요");
  expect(listRequests).toEqual([]);
  await capture(page, "over-limit-search");

  await search.fill("추가 공개 앱 27");
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  expect(listRequests).toHaveLength(1);

  await search.fill("ß".repeat(51));
  await expect(search).toHaveValue("ß".repeat(51));
  await expect(page.getByRole("alert")).toContainText("검색어가 너무 길어요");
  await expect(page.locator("a.card-r")).toHaveCount(0);
  expect(listRequests).toHaveLength(1);
  await capture(page, "over-limit-typed-search");

  await search.fill("추가 공개 앱 27");
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
});

test("rejects malformed gallery queries with an explicit reset", async ({
  page,
  context,
}) => {
  const listRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps") listRequests.push(url.search);
  });
  await blockExternalRequests(context);

  for (const query of [
    "subject=전체",
    "subject=수학&subject=수학",
    "tracking=1",
    "q=%",
    "q=%FF",
  ]) {
    await page.goto(`/?${query}`);
    await expect(page.getByRole("alert")).toContainText(
      "검색 조건을 확인할 수 없어요",
    );
    await expect(
      page.getByRole("button", { name: "조건 초기화" }),
    ).toBeVisible();
    expect(listRequests).toEqual([]);
  }
  await capture(page, "invalid-query");

  await page.getByRole("button", { name: "조건 초기화" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  expect(listRequests).toHaveLength(1);
});

test("searches actual public names, nicknames, descriptions, symbols, and combined filters", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);

  const apps = await page.request.get("/api/v1/apps?limit=2&offset=0");
  const firstPage = await apps.json();
  expect(firstPage.items[0].url).toBe(firstPage.items[1].url);
  expect(firstPage.items[0].id).not.toBe(firstPage.items[1].id);
  for (const { id } of firstPage.items) {
    await expect(page.locator(`a.card-r[href="/apps/${id}"]`)).toHaveCount(1);
  }

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  const nicknameResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "공개 별명"
    );
  });
  await search.fill("공개 별명");
  expect((await (await nicknameResponse).json()).pagination.total).toBe(27);
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(search).toHaveValue("공개 별명");

  const descriptionResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "Description for 추가 공개 앱 27"
    );
  });
  await search.fill("Description for 추가 공개 앱 27");
  expect((await (await descriptionResponse).json()).pagination.total).toBe(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();

  const math = page.getByRole("button", { name: "수학", exact: true });
  const mathResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await math.click();
  await mathResponse;
  await page.getByRole("combobox", { name: "학년 필터" }).selectOption("초1");
  const combinedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱" &&
      url.searchParams.get("subject") === "수학" &&
      url.searchParams.get("grade") === "초1"
    );
  });
  await search.fill("추가 공개 앱");
  expect((await (await combinedResponse).json()).pagination.total).toBe(25);
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(25);
  await capture(page, "combined-filter");

  await search.fill("%_");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(math).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "학년 필터" })).toHaveValue(
    "초1",
  );
  await capture(page, "literal-symbol-zero-results");
});

test("keeps old gallery cards hidden after a refetch failure and retries by keyboard", async ({
  page,
  context,
}) => {
  let listRequests = 0;
  const listRequestQueries = [];
  let failRefetchUntilRetry = false;
  let failedRefetches = 0;
  let holdRetry = false;
  let releaseRetry;
  let retryStarted;
  const retryGate = new Promise((resolve) => (releaseRetry = resolve));
  const retryRequest = new Promise((resolve) => (retryStarted = resolve));
  let settleRetry;
  const retrySettledPromise = new Promise((resolve) => (settleRetry = resolve));
  await blockExternalRequests(context);
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
  });
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
      retryStarted();
      await retryGate;
      try {
        await route.fulfill({ response });
      } finally {
        settleRetry();
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
  const displayedIds = await page
    .locator("a.card-r")
    .evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("href").slice("/apps/".length)),
    );
  await page.locator("a.card-r").first().click();
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
  for (const id of displayedIds)
    await expect(page.locator(`a.card-r[href="/apps/${id}"]`)).toHaveCount(0);
  await capture(page, "refetch-error");

  failRefetchUntilRetry = false;
  const retry = page.getByRole("button", { name: "다시 시도" });
  const requestsBeforeRetry = listRequests;
  holdRetry = true;
  await retry.focus();
  await page.keyboard.press("Enter");
  await retryRequest;
  expect(listRequests).toBe(requestsBeforeRetry + 1);
  await expect(page.getByRole("main")).toBeFocused();
  await capture(page, "refetch-retry-loading");
  releaseRetry();
  await retrySettledPromise;
  await expect(page.locator("a.card-r")).toHaveCount(24);
  for (const id of displayedIds)
    await expect(page.locator(`a.card-r[href="/apps/${id}"]`)).toHaveCount(1);
  expect(listRequests).toBe(requestsBeforeRetry + 1);
});

test("uses the committed search during IME filter changes and debounces composition end", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("추가 공개 앱");

  const listRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps") listRequests.push(url.searchParams);
  });
  await search.dispatchEvent("compositionstart", { data: "추가 공개 앱 27" });
  await search.fill("추가 공개 앱 27");
  const mathResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await page.getByRole("button", { name: "수학", exact: true }).click();
  await mathResponse;
  expect(
    listRequests.some((params) => params.get("q") === "추가 공개 앱 27"),
  ).toBe(false);
  await capture(page, "ime-composition-filter");

  await search.dispatchEvent("compositionend", {
    data: "추가 공개 앱 27",
  });
  await page.clock.fastForward(299);
  expect(
    listRequests.some((params) => params.get("q") === "추가 공개 앱 27"),
  ).toBe(false);
  const committedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱 27" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await page.clock.fastForward(1);
  await committedResponse;
  await expect(page).toHaveURL(
    /q=%EC%B6%94%EA%B0%80\+%EA%B3%B5%EA%B0%9C\+%EC%95%B1\+27/,
  );
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(search).toHaveValue("추가 공개 앱 27");
});

test("hides old cards while a new API filter is loading", async ({
  page,
  context,
}) => {
  let releaseResponse;
  let signalRequestStarted;
  let signalRequestSettled;
  const responseGate = new Promise((resolve) => (releaseResponse = resolve));
  const requestStarted = new Promise(
    (resolve) => (signalRequestStarted = resolve),
  );
  const requestSettled = new Promise(
    (resolve) => (signalRequestSettled = resolve),
  );
  await blockExternalRequests(context);
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname !== "/api/v1/apps" ||
      url.searchParams.get("q") !== "추가 공개 앱 27"
    )
      return route.continue();
    const response = await route.fetch();
    signalRequestStarted();
    try {
      await responseGate;
      await route.fulfill({ response });
    } finally {
      signalRequestSettled();
    }
  });

  await page.goto("/");
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(24);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await expect(search).toHaveAccessibleName("앱·작성자 검색");
  await search.fill("추가 공개 앱 27");
  await requestStarted;

  await expect(cards).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({
      hasText: "공개 아카이브를 불러오는 중이에요",
    }),
  ).toContainText("공개 아카이브를 불러오는 중이에요");
  await expect(search).toBeVisible();
  await capture(page, "new-filter-loading");

  releaseResponse();
  await requestSettled;
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  await expect(cards).toHaveCount(1);
});

test("retains the current cards after next-page failure and stops on duplicate-only pages", async ({
  page,
  context,
}) => {
  let mode = "failure";
  let nextPageRequests = 0;
  let firstPageBody;
  await blockExternalRequests(context);
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
  });
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/v1/apps") return route.continue();
    const offset = url.searchParams.get("offset");
    if (offset === "0") {
      const response = await route.fetch();
      firstPageBody = await response.json();
      return route.fulfill({ response, json: firstPageBody });
    }
    if (offset !== "24") return route.continue();
    nextPageRequests += 1;
    if (mode === "failure") {
      mode = "duplicate";
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Public service error",
            request_id: "issue82-next-page",
          },
        }),
      });
    }
    const response = await route.fetch();
    const body = await response.json();
    if (mode === "duplicate") {
      mode = "done";
      body.items = firstPageBody.items.slice(0, 2);
      body.pagination = { ...body.pagination, total: 50, has_more: true };
      return route.fulfill({ response, json: body });
    }
    return route.fulfill({ response });
  });

  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(page.locator("a.card-r").first()).toHaveAttribute(
    "href",
    /\/apps\//,
  );
  await capture(page, "paged-gallery");

  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await capture(page, "next-page-error");

  const retry = page.getByRole("button", { name: "다시 시도" });
  await retry.click();
  await expect(
    page.getByRole("button", { name: "계속 불러오기" }),
  ).toBeVisible();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  expect(nextPageRequests).toBe(2);
  await capture(page, "duplicate-only-page");

  await page.getByRole("button", { name: "계속 불러오기" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toHaveCount(
    0,
  );
  expect(nextPageRequests).toBe(2);
});

test("stops and offers retry when a next page claims more data without progress", async ({
  page,
  context,
}) => {
  let nextPageRequests = 0;
  const nextPageOffsets = [];
  await blockExternalRequests(context);
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
  });
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname !== "/api/v1/apps" ||
      url.searchParams.get("offset") !== "24"
    )
      return route.continue();
    nextPageRequests += 1;
    nextPageOffsets.push(url.searchParams.get("offset"));
    if (nextPageRequests === 1) {
      const response = await route.fetch();
      const body = await response.json();
      body.items = [];
      body.pagination.has_more = true;
      return route.fulfill({ response, json: body });
    }
    return route.continue();
  });

  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
  expect(nextPageRequests).toBe(1);
  await capture(page, "no-progress-page-error");

  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(27);
  expect(nextPageRequests).toBe(2);
  expect(nextPageOffsets).toEqual(["24", "24"]);
});

test("does not let a late search response replace the newest query", async ({
  page,
  context,
}) => {
  let releaseOld;
  let oldStarted;
  let oldSettled;
  const oldGate = new Promise((resolve) => (releaseOld = resolve));
  const oldRequestStarted = new Promise((resolve) => (oldStarted = resolve));
  const oldRequestSettled = new Promise((resolve) => (oldSettled = resolve));
  const isOldSearch = (request) =>
    new URL(request.url()).searchParams.get("q") === "추가 공개 앱";
  await blockExternalRequests(context);
  page.on("requestfinished", (request) => {
    if (isOldSearch(request)) oldSettled();
  });
  page.on("requestfailed", (request) => {
    if (isOldSearch(request)) oldSettled();
  });
  await page.route("**/api/v1/apps**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱"
    ) {
      const response = await route.fetch();
      oldStarted();
      await oldGate;
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
  await oldRequestStarted;
  await search.fill("추가 공개 앱 27");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  releaseOld();
  await oldRequestSettled;
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
  let releaseRetry;
  let retryStarted;
  let retryHandled;
  const retryGate = new Promise((resolve) => (releaseRetry = resolve));
  const retryRequest = new Promise((resolve) => (retryStarted = resolve));
  const retryRequestHandled = new Promise(
    (resolve) => (retryHandled = resolve),
  );
  await blockExternalRequests(context);
  await page.addInitScript(() => {
    window.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
  });
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
    retryStarted();
    await retryGate;
    try {
      await route.fulfill({ response });
    } catch {
      // The current search may cancel the held request before it is released.
    } finally {
      retryHandled();
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
  await retryRequest;

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱 27");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  releaseRetry();
  await retryRequestHandled;
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
});
