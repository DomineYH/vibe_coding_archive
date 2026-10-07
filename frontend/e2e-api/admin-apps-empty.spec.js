import { expect } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";
import {
  collectLists,
  monitorList,
  readHeaders,
  signIn,
  test,
} from "./admin-apps-helpers.js";

// Runs only in the dedicated zero-app database group (API_E2E_EMPTY_APPS=1).
test.describe("administrator app list on an empty archive over real HTTP", () => {
  test.skip(
    process.env.API_E2E_EMPTY_APPS !== "1" ||
      process.env.API_E2E_AUTH_BOUNDARY !== "prepared",
    "requires the dedicated zero-app database group",
  );
  test.beforeEach(async ({ context }) => {
    test.setTimeout(60000);
    await blockExternalRequests(context);
  });

  test("an empty archive is a normal 200 with the empty monitor state", async ({
    page,
    owned,
  }) => {
    expect(owned.baseline).toBe(0);
    expect(owned.apps).toHaveLength(0);
    const lists = collectLists(page);
    await signIn(page, owned.admin);
    await page.goto("/admin?tab=health");
    await expect(page.getByText("표시할 앱이 없어요.")).toBeVisible();
    await expect(monitorList(page)).toHaveCount(0);
    await expect.poll(() => lists.length).toBe(1);
    expect(lists[0].status).toBe(200);
    expect(JSON.parse(await lists[0].body)).toMatchObject({
      items: [],
      pagination: { limit: 24, offset: 0, total: 0, has_more: false },
    });
    await expect(
      page
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: "등록된 앱" }) })
        .locator("dd"),
    ).toHaveText("0");
    const beyond = await page.request.get("/api/v1/admin/apps?offset=100", {
      headers: await readHeaders(page),
    });
    expect(beyond.status()).toBe(200);
    expect((await beyond.json()).pagination).toEqual({
      limit: 24,
      offset: 100,
      total: 0,
      has_more: false,
    });
  });
});
