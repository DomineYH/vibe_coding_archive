import { expect } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import {
  SENTINEL,
  appNames,
  collectLists,
  collectWrites,
  fixture,
  monitorList,
  openMonitor,
  readHeaders,
  signIn,
  test,
} from "./admin-apps-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const ITEM_KEYS = [
  "created_at",
  "health",
  "id",
  "is_public",
  "name",
  "owner",
  "theme_id",
  "url",
  "url_version",
  "version",
];

test.describe("administrator app list over real HTTP", () => {
  test.skip(
    !prepared || process.env.API_E2E_EMPTY_APPS === "1",
    "requires isolated prepared authentication and the owned-app database",
  );
  test.beforeEach(async ({ context }) => {
    test.setTimeout(120000);
    await blockExternalRequests(context);
  });

  test("the Health Monitor reads every owner's public and private apps with default and additional pages", async ({
    page,
    owned,
  }) => {
    const lists = collectLists(page);
    const writes = collectWrites(page);
    await signIn(page, owned.admin);
    writes.length = 0;
    await page.goto("/admin?tab=health");
    await expect(monitorList(page)).toBeVisible();
    const total = owned.baseline + owned.apps.length;
    expect(total).toBeGreaterThan(24);
    await expect.poll(() => lists.length).toBe(1);
    const first = lists[0];
    expect(first.url.search).toBe("?limit=24&offset=0");
    expect(first.status).toBe(200);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    const firstText = await first.body;
    expect(firstText).not.toContain(SENTINEL);
    const firstPage = JSON.parse(firstText);
    expect(Object.keys(firstPage).sort()).toEqual([
      "items",
      "pagination",
      "server_time",
    ]);
    expect(firstPage.pagination).toEqual({
      limit: 24,
      offset: 0,
      total,
      has_more: true,
    });
    for (const item of firstPage.items) {
      expect(Object.keys(item).sort()).toEqual(ITEM_KEYS);
      expect(Object.keys(item.owner).sort()).toEqual(["id", "nickname"]);
      expect(Object.keys(item.health).sort()).toEqual([
        "checked_at",
        "fresh_until",
        "state",
      ]);
    }
    expect(await appNames(page)).toHaveLength(24);
    const more = page.getByRole("button", { name: /추가 앱 불러오기/ });
    await more.click();
    await expect.poll(() => lists.length).toBe(2);
    expect(lists[1].url.search).toBe("?limit=24&offset=24");
    expect(lists[1].status).toBe(200);
    expect(await lists[1].body).not.toContain(SENTINEL);
    for (let guard = 0; guard < 10; guard++) {
      const next = page.getByRole("button", { name: /추가 앱 불러오기/ });
      if (!(await next.count())) break;
      await next.click();
      await expect.poll(() => lists.length).toBeGreaterThan(2 + guard);
    }
    await expect(
      page.getByRole("button", { name: /추가 앱 불러오기/ }),
    ).toHaveCount(0);
    const names = await appNames(page);
    expect(names).toHaveLength(total);
    expect(new Set(names).size).toBe(total);
    for (const app of owned.apps)
      expect(
        names.filter((name) => name === `앱 관리: ${app.name}`),
      ).toHaveLength(1);
    // Three owners, both visibilities, in the rendered rows.
    for (const [kind, app] of [
      ["member", owned.apps[0]],
      ["member2", owned.apps[1]],
      ["admin", owned.apps[5]],
    ]) {
      const row = monitorList(page)
        .getByRole("listitem")
        .filter({
          has: page.getByRole("button", { name: `앱 관리: ${app.name}` }),
        });
      await expect(row).toContainText(`작성자 ${owned[kind].login}`);
      await expect(row).toContainText(app.public ? "공개" : "비공개");
    }
    await expect(page.locator("body")).not.toContainText(SENTINEL);
    // The four statistic cards come from the server aggregate, not the rows.
    await expect(
      page
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: "등록된 앱" }) })
        .locator("dd"),
    ).toHaveText(String(total));
    expect(writes).toEqual([]);
  });

  test("offset paging across inserts and deletes keeps unique rows and reconciles on refresh", async ({
    page,
    owned,
  }) => {
    await openMonitor(page, owned.admin);
    expect(await appNames(page)).toHaveLength(24);
    const newest = owned.apps.at(-1);
    fixture("delete_apps", [newest.id, owned.apps.at(-2).id]);
    const added = fixture("add_app", [owned.member.id, "e162-inserted", true]);
    const lists = collectLists(page);
    await page.getByRole("button", { name: /추가 앱 불러오기/ }).click();
    await expect.poll(() => lists.length).toBe(1);
    const second = JSON.parse(await lists[0].body);
    expect(second.pagination.offset).toBe(24);
    await expect(monitorList(page).getByRole("listitem").nth(24)).toBeVisible();
    const names = await appNames(page);
    expect(new Set(names).size).toBe(names.length);
    await page.reload();
    await expect(monitorList(page)).toBeVisible();
    const refreshed = await appNames(page);
    expect(refreshed[0]).toBe(`앱 관리: ${added.name}`);
    for (const gone of [newest.name, owned.apps.at(-2).name])
      expect(refreshed).not.toContain(`앱 관리: ${gone}`);
    expect(fixture("count", null).apps).toBe(
      owned.baseline + owned.apps.length - 2 + 1,
    );
  });

  test("reading is CSRF-free, needs no recent authentication and writes nothing", async ({
    page,
    owned,
  }) => {
    await openMonitor(page, owned.admin);
    const meta = await (await page.request.get("/api/v1/meta")).json();
    expect(meta.capabilities.admin_apps_read).toEqual({
      enabled: true,
      reasons: [],
    });
    expect(meta.capabilities.admin_apps_manage).toEqual({
      enabled: true,
      reasons: [],
    });
    for (const key of ["health_read", "health_check", "health_batch"])
      expect(meta.capabilities[key].enabled).toBe(false);
    fixture("mutate", [
      "UPDATE sessions SET recent_auth_until=NULL WHERE member_id=?",
      [owned.admin.id],
    ]);
    const headers = await readHeaders(page);
    const tables = `SELECT (SELECT count(*) FROM write_operations),(SELECT count(*) FROM audit_logs),(SELECT count(*) FROM auth_flows),(SELECT count(*) FROM auth_retired_credentials),(SELECT count(*) FROM rate_limit_events)`;
    const session = `SELECT * FROM sessions WHERE member_id='${owned.admin.id}'`;
    const before = [query(tables), query(session)];
    const result = await page.request.get("/api/v1/admin/apps?limit=3", {
      headers,
    });
    expect(result.status()).toBe(200);
    expect(result.headers()["cache-control"]).toBe("private, no-store");
    expect((await result.json()).items).toHaveLength(3);
    expect([query(tables), query(session)]).toEqual(before);
    const writes = collectWrites(page);
    await page.reload();
    await expect(monitorList(page)).toBeVisible();
    const rows = monitorList(page).getByRole("listitem");
    const check = rows.first().getByRole("button", { name: "즉시 재검사" });
    await expect(check).toBeDisabled();
    expect(
      await page.getByRole("button", { name: "즉시 재검사" }).count(),
    ).toBe(await rows.count());
    await page.getByRole("button", { name: /추가 앱 불러오기/ }).click();
    await expect(rows.nth(24)).toBeVisible();
    expect(writes).toEqual([]);
  });

  test("anonymous, headerless, ordinary-member and de-privileged requests never receive the list", async ({
    page,
    owned,
  }) => {
    await openMonitor(page, owned.admin);
    const headers = await readHeaders(page);
    expect(
      (await page.request.get("/api/v1/admin/apps", { headers })).status(),
    ).toBe(200);
    const bare = await page.request.get("/api/v1/admin/apps");
    expect([401, 422]).toContain(bare.status());
    expect(await bare.text()).not.toContain('"items"');
    const memberContext = await owned.newContext();
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, owned.member);
    const memberHeaders = await readHeaders(memberPage);
    const denied = await memberPage.request.get("/api/v1/admin/apps", {
      headers: memberHeaders,
    });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).error.code).toBe("FORBIDDEN");
    expect(await denied.text()).not.toContain('"items"');
    fixture("mutate", [
      "UPDATE members SET is_admin=0 WHERE id=?",
      [owned.admin.id],
    ]);
    const revoked = await page.request.get("/api/v1/admin/apps", { headers });
    expect(revoked.status()).toBe(403);
    expect(await revoked.text()).not.toContain('"items"');
  });

  test("recorded health results with other freshness windows are listed, not rejected", async ({
    page,
    owned,
  }) => {
    // Fixture apps 21 (healthy) and 23 (http_error) sit on the first page.
    const recorded = [owned.apps[21], owned.apps[23]];
    for (const app of recorded)
      fixture("mutate", [
        "UPDATE health_results SET fresh_until=strftime('%Y-%m-%dT%H:%M:%S', checked_at, '+3600 seconds') || substr(checked_at, 20) WHERE app_id=?",
        [app.id],
      ]);
    const lists = collectLists(page);
    await openMonitor(page, owned.admin);
    await expect.poll(() => lists.length).toBe(1);
    expect(lists[0].status).toBe(200);
    const items = JSON.parse(await lists[0].body).items;
    const states = [];
    for (const app of recorded) {
      const { health } = items.find((item) => item.id === app.id);
      expect(
        Date.parse(health.fresh_until) - Date.parse(health.checked_at),
      ).toBe(3600 * 1000);
      states.push(health.state);
    }
    expect(states).toEqual(["healthy", "http_error"]);
    expect(await appNames(page)).toHaveLength(24);
    for (const app of recorded)
      await expect(
        page.getByRole("button", { name: `앱 관리: ${app.name}` }),
      ).toBeVisible();
    await expect(page.getByText("앱 목록을 불러오지 못했어요.")).toHaveCount(0);
  });
});
