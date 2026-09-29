import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  disableAutomaticPagination,
} from "./helpers.js";
import { captureGalleryState } from "./gallery-helpers.js";

test("retains the current cards after next-page failure and stops on duplicate-only pages", async ({
  page,
  context,
}) => {
  let mode = "failure";
  let nextPageRequests = 0;
  let firstPageBody;
  await blockExternalRequests(context);
  await disableAutomaticPagination(page);
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
  await captureGalleryState(page, "paged-gallery");

  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await captureGalleryState(page, "next-page-error");

  const retry = page.getByRole("button", { name: "다시 시도" });
  await retry.click();
  await expect(
    page.getByRole("button", { name: "계속 불러오기" }),
  ).toBeVisible();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  expect(nextPageRequests).toBe(2);
  await captureGalleryState(page, "duplicate-only-page");

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
  await disableAutomaticPagination(page);
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
  await captureGalleryState(page, "no-progress-page-error");

  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(27);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toHaveCount(
    0,
  );
  expect(nextPageRequests).toBe(2);
  expect(nextPageOffsets).toEqual(["24", "24"]);
});
