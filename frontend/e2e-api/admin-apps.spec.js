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

  test("operational notices describe disabled admin actions at mobile and desktop widths", async ({
    page,
    owned,
  }, testInfo) => {
    const resetNote =
      "비밀번호 초기화 운영 준비가 확인되지 않아 임시 비밀번호를 설정할 수 없어요.";
    const healthNote =
      "연결 검사 운영 준비가 확인되지 않아 새 검사를 접수할 수 없어요. 기존 연결 결과는 확인할 수 있어요.";
    let restricted = true;
    await page.route("**/api/v1/meta", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const key of [
        "admin_password_reset",
        "health_check",
        "health_batch",
      ])
        body.capabilities[key] = {
          enabled: !restricted,
          reasons: restricted ? ["operational_restriction"] : [],
        };
      await route.fulfill({ response, json: body });
    });
    await signIn(page, owned.admin);
    const writes = collectWrites(page);
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
      { width: 360, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const [tab, copy, actions] of [
        ["users", resetNote, ["임시 비밀번호 설정"]],
        ["health", healthNote, ["전체 재검사", "즉시 재검사"]],
      ]) {
        await page.goto(tab === "users" ? "/admin" : "/admin?tab=health");
        await expect(
          page.getByRole("list", {
            name: tab === "users" ? "회원 목록" : "전체 앱 목록",
          }),
        ).toBeVisible();
        const note = page.getByText(copy, { exact: true });
        await expect(note).toBeVisible();
        for (const action of actions) {
          const buttons = page.getByRole("button", {
            name: action,
            exact: true,
          });
          expect(await buttons.count()).toBeGreaterThan(0);
          for (const button of await buttons.all()) {
            await expect(button).toBeDisabled();
            await expect(button).toHaveAccessibleDescription(copy);
            await button.evaluate((element) => element.click());
          }
        }
        for (const row of await page
          .getByRole("listitem")
          .filter({ hasText: "보호된 계정" })
          .all())
          await expect(
            row.getByRole("button", { name: "임시 비밀번호 설정" }),
          ).toHaveCount(0);
        expect(
          await page.evaluate(() => {
            const ids = [...document.querySelectorAll("[id]")].map(
              (element) => element.id,
            );
            return (
              new Set(ids).size === ids.length &&
              [...document.querySelectorAll("[aria-describedby]")].every(
                (element) =>
                  element
                    .getAttribute("aria-describedby")
                    .split(/\s+/)
                    .every((id) => document.getElementById(id)),
              )
            );
          }),
        ).toBe(true);
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBeLessThanOrEqual(viewport.width);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await page.screenshot({
          path: testInfo.outputPath(
            `admin-${tab}-operational-${viewport.width}x${viewport.height}.png`,
          ),
          fullPage: true,
          animations: "disabled",
        });
      }
    }
    expect(writes).toEqual([]);
    restricted = false;
    await page.reload();
    await expect(monitorList(page)).toBeVisible();
    await expect(page.getByText(healthNote, { exact: true })).toHaveCount(0);
    for (const action of ["전체 재검사", "즉시 재검사"])
      for (const button of await page
        .getByRole("button", { name: action, exact: true })
        .all()) {
        await expect(button).toBeEnabled();
        await expect(button).not.toHaveAccessibleDescription(healthNote);
      }
    await page.goto("/admin");
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    await expect(page.getByText(resetNote, { exact: true })).toHaveCount(0);
    for (const button of await page
      .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
      .all()) {
      await expect(button).toBeEnabled();
      await expect(button).not.toHaveAttribute("aria-describedby");
    }
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
    await expect(
      page.getByText(
        "개발용 합성 시연이며 외부 사이트에 요청을 보내지 않습니다.",
      ),
    ).toHaveCount(0);
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
    expect(meta.capabilities.health_read).toEqual({
      enabled: true,
      reasons: [],
    });
    for (const key of ["health_check", "health_batch"])
      expect(meta.capabilities[key]).toEqual({
        enabled: false,
        reasons: ["operational_restriction"],
      });
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
    const { items } = await result.json();
    expect(items).toHaveLength(3);
    // The monitor list keeps its minimal result; the authorized snapshot owns measurements.
    const snapshot = await page.request.get(
      `/api/v1/apps/${items[0].id}/health`,
      { headers },
    );
    expect(snapshot.status()).toBe(200);
    expect(snapshot.headers()["cache-control"]).toBe("private, no-store");
    const body = await snapshot.json();
    expect(Object.keys(body).sort()).toEqual([
      "app_id",
      "health",
      "server_time",
      "url_version",
    ]);
    expect(body.app_id).toBe(items[0].id);
    expect(body.url_version).toBe(items[0].url_version);
    expect(body.health).toEqual({
      result: {
        ...items[0].health,
        http_status: null,
        response_ms: null,
        error_kind: null,
        error_stage: null,
      },
      latest_job: null,
      next_check_at: null,
    });
    expect([query(tables), query(session)]).toEqual(before);
    const writes = collectWrites(page);
    await page.reload();
    await expect(monitorList(page)).toBeVisible();
    const rows = monitorList(page).getByRole("listitem");
    const check = rows.first().getByRole("button", { name: "즉시 재검사" });
    await expect(check).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "전체 재검사" }),
    ).toBeDisabled();
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
