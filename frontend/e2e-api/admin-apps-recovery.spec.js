import { expect } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";
import {
  LIST_URL,
  appNames,
  collectLists,
  collectWrites,
  deferred,
  failLists,
  fixture,
  holdLists,
  monitorList,
  openMonitor,
  signIn,
  test,
} from "./admin-apps-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const offset = (value) => (url) => url.searchParams.get("offset") === value;

async function logout(page, owned) {
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("banner").getByText(owned.admin.login, { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
}

test.describe("administrator app list recovery over real HTTP", () => {
  test.skip(
    !prepared || process.env.API_E2E_EMPTY_APPS === "1",
    "requires isolated prepared authentication and the owned-app database",
  );
  test.beforeEach(async ({ context }) => {
    test.setTimeout(120000);
    await blockExternalRequests(context);
  });

  test("a failed first page offers an explicit retry that reads the backend again", async ({
    page,
    owned,
  }) => {
    const failing = await failLists(page, { match: offset("0") });
    const lists = collectLists(page);
    await signIn(page, owned.admin);
    await page.goto("/admin?tab=health");
    await expect(page.getByText("앱 목록을 불러오지 못했어요.")).toBeVisible();
    expect(failing.served.length).toBeGreaterThan(0);
    expect(failing.served.every((status) => status === 200)).toBe(true);
    await expect(monitorList(page)).toHaveCount(0);
    failing.stop();
    await page.getByRole("button", { name: "다시 시도" }).click();
    await expect(monitorList(page)).toBeVisible();
    expect(await appNames(page)).toHaveLength(24);
    expect(lists.map((list) => list.status)).toEqual([200]);
    expect(lists[0].url.search).toBe("?limit=24&offset=0");
  });

  test("a failed additional page keeps the rows and retries the same offset", async ({
    page,
    owned,
  }) => {
    await openMonitor(page, owned.admin);
    const before = await appNames(page);
    const failing = await failLists(page, { match: offset("24") });
    const lists = collectLists(page);
    const writes = collectWrites(page);
    await page.getByRole("button", { name: /추가 앱 불러오기/ }).click();
    await expect(
      page.getByText("추가 앱을 불러오지 못했어요. 표시된 목록은 유지됩니다."),
    ).toBeVisible();
    expect(failing.served.length).toBeGreaterThan(0);
    expect(failing.served.every((status) => status === 200)).toBe(true);
    expect(await appNames(page)).toEqual(before);
    failing.stop();
    await page.getByRole("button", { name: "추가 앱 다시 불러오기" }).click();
    await expect(monitorList(page).getByRole("listitem").nth(24)).toBeVisible();
    expect(lists.map((list) => list.url.search)).toEqual([
      "?limit=24&offset=24",
    ]);
    const names = await appNames(page);
    expect(names.slice(0, before.length)).toEqual(before);
    expect(new Set(names).size).toBe(names.length);
    expect(writes).toEqual([]);
  });

  test("a response completing after logout and account switch never fills the new screen", async ({
    page,
    owned,
  }) => {
    await signIn(page, owned.admin);
    const barrier = deferred();
    owned.onCleanup(barrier.resolve);
    const held = await holdLists(page, barrier);
    await page.goto("/admin?tab=health");
    await held.reached.promise;
    await logout(page, owned);
    // A private app: the public gallery after logout legitimately lists public ones.
    const stale = owned.apps.at(-1).name;
    barrier.resolve();
    await expect(monitorList(page)).toHaveCount(0);
    await expect(page.getByText(stale)).toHaveCount(0);
    await page.waitForTimeout(500);
    await expect(page.getByText(stale)).toHaveCount(0);
    await page.unroute(LIST_URL);
    const lists = collectLists(page);
    await signIn(page, owned.admin2);
    await page.goto("/admin?tab=health");
    await expect(monitorList(page)).toBeVisible();
    await expect.poll(() => lists.length).toBe(1);
    expect(held.contexts.length).toBeGreaterThan(0);
    expect(held.contexts).not.toContain(lists[0].context);
    expect(await appNames(page)).toHaveLength(24);
  });

  test("rows already shown are removed on logout and absent after returning", async ({
    page,
    owned,
  }) => {
    await openMonitor(page, owned.admin);
    const names = await appNames(page);
    expect(names.length).toBeGreaterThan(0);
    await logout(page, owned);
    await expect(monitorList(page)).toHaveCount(0);
    await expect(page.getByText(owned.apps.at(-1).name)).toHaveCount(0);
    await page.goto("/admin?tab=health");
    await expect(monitorList(page)).toHaveCount(0);
    await expect(page.getByText(owned.apps.at(-1).name)).toHaveCount(0);
    await signIn(page, owned.admin2);
    await page.goto("/admin?tab=health");
    await expect(monitorList(page)).toBeVisible();
  });

  test("losing administrator authority clears the rows and the next read is refused", async ({
    page,
    owned,
  }) => {
    await openMonitor(page, owned.admin);
    expect(await appNames(page)).toHaveLength(24);
    const lists = collectLists(page);
    fixture("mutate", [
      "UPDATE members SET is_admin=0 WHERE id=?",
      [owned.admin.id],
    ]);
    await page.getByRole("button", { name: /추가 앱 불러오기/ }).click();
    await expect.poll(() => lists.length).toBe(1);
    expect(lists[0].status).toBe(403);
    expect(await lists[0].body).not.toContain('"items"');
    await expect(monitorList(page)).toHaveCount(0);
    await expect(page.getByText(owned.apps.at(-1).name)).toHaveCount(0);
    await expect(
      page.getByText("추가 앱을 불러오지 못했어요. 표시된 목록은 유지됩니다."),
    ).toHaveCount(0);
  });
});
