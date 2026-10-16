import { expect } from "@playwright/test";
import {
  blockExternalRequests,
  query,
  viewports,
  prepareViewportCapture,
} from "./helpers.js";
import {
  test,
  openAdmin,
  openDelete,
  login,
  PASSWORD,
  userRow,
  approvalHeaders,
} from "./user-delete-helpers.js";
import { deferred, holdLists, monitorList } from "./admin-apps-helpers.js";
test.use({ trace: "off", screenshot: "off", video: "off" });
const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.describe("account deletion over real HTTP", () => {
  test.skip(!prepared, "requires isolated prepared authentication");
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90000);
    await blockExternalRequests(context);
  });
  test("recent login deletes public/private apps without reauth, cancels safely, submits once and revokes old sessions", async ({
    page,
    owned,
  }) => {
    const targetContext = await owned.newContext();
    const targetPage = await targetContext.newPage();
    await blockExternalRequests(targetContext);
    await login(targetPage, owned.member.login, PASSWORD);
    await expect(
      targetPage
        .getByRole("banner")
        .getByText(owned.member.login, { exact: true }),
    ).toBeVisible();
    const oldHeaders = await approvalHeaders(targetPage);
    for (const id of owned.apps)
      expect(
        (
          await targetPage.request.get(`/api/v1/apps/${id}`, {
            headers: oldHeaders,
          })
        ).status(),
      ).toBe(200);
    const reauthVisits = [];
    let reauthRequests = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && /[?&]mode=reauth/.test(frame.url()))
        reauthVisits.push(frame.url());
    });
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/auth/reauth"))
        reauthRequests++;
    });
    await openAdmin(page, owned);
    const headers = await approvalHeaders(page);
    const before = await (
      await page.request.get("/api/v1/admin/users", { headers })
    ).json();
    let issues = 0,
      writes = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
      if (request.method() === "DELETE") writes++;
    });
    let panel = await openDelete(page, owned);
    await expect(panel).toContainText(owned.member.login);
    await expect(panel).toContainText("앱 2개도 함께 삭제");
    await panel.getByRole("button", { name: "취소", exact: true }).click();
    expect(issues).toBe(0);
    expect(writes).toBe(0);
    panel = await openDelete(page, owned);
    await panel
      .getByRole("button", { name: "삭제 확인", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await expect(panel).toContainText("삭제가 확정됐어요");
    await expect(panel).toHaveAttribute("aria-busy", "false");
    await expect(panel).not.toContainText("현재 대상을 불러오지 못했어요");
    await expect(
      panel.getByRole("button", { name: "닫기", exact: true }),
    ).toBeEnabled();
    await expect(userRow(page, owned.member.login)).toHaveCount(0);
    expect(issues).toBe(1);
    expect(writes).toBe(1);
    expect(reauthVisits).toEqual([]);
    expect(reauthRequests).toBe(0);
    const currentHeaders = await approvalHeaders(page);
    const after = await (
      await page.request.get("/api/v1/admin/users", { headers: currentHeaders })
    ).json();
    expect(after.stats.total_users).toBe(before.stats.total_users - 1);
    expect(after.stats.total_apps).toBe(before.stats.total_apps - 2);
    expect(after.stats.healthy_apps).toBe(before.stats.healthy_apps - 2);
    for (const [label, value] of [
      ["전체 사용자", after.stats.total_users],
      ["등록된 앱", after.stats.total_apps],
    ])
      await expect(
        page.getByText(label, { exact: true }).locator("..").locator("dd"),
      ).toHaveText(String(value));
    expect(
      (
        await targetPage.request.get("/api/v1/auth/me", { headers: oldHeaders })
      ).status(),
    ).toBe(401);
    const reloginContext = await owned.newContext();
    await blockExternalRequests(reloginContext);
    const reloginPage = await reloginContext.newPage();
    await login(reloginPage, owned.member.login, PASSWORD);
    await expect(
      reloginPage.getByText("로그인 아이디 또는 비밀번호를 확인해 주세요."),
    ).toBeVisible();
    for (const id of owned.apps)
      expect(
        (
          await page.request.get(`/api/v1/apps/${id}`, {
            headers: currentHeaders,
          })
        ).status(),
      ).toBe(404);
    const listing = await (
      await page.request.get(
        `/api/v1/apps?q=${encodeURIComponent(owned.member.login.split("-member")[0])}`,
      )
    ).json();
    expect(listing.items).toEqual([]);
    expect(listing.pagination.total).toBe(0);
    expect(
      query(`SELECT count(*) FROM members WHERE id='${owned.member.id}'`)[0][0],
    ).toBe(0);
    expect(
      query(
        `SELECT count(*) FROM apps WHERE owner_id='${owned.member.id}'`,
      )[0][0],
    ).toBe(0);
    await panel.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(panel).toHaveCount(0);
    await page.reload();
    await expect(userRow(page, owned.member.login)).toHaveCount(0);
    for (const id of owned.apps) {
      await page.goto(`/apps/${id}/edit`);
      await expect(
        page.getByText("앱을 수정할 수 없어요", { exact: false }),
      ).toBeVisible();
    }
  });
  test("zero-app and change-only members can be deleted with their old authority blocked", async ({
    page,
    owned,
  }) => {
    const targetContext = await owned.newContext();
    const targetPage = await targetContext.newPage();
    await blockExternalRequests(targetContext);
    await login(targetPage, owned.temporary.login, PASSWORD);
    await expect(
      targetPage.getByLabel("새 비밀번호 (필수)", { exact: true }),
    ).toBeVisible();
    const oldHeaders = await approvalHeaders(targetPage);
    await openAdmin(page, owned);
    for (const kind of ["zero", "temporary"]) {
      const before = await (
        await page.request.get("/api/v1/admin/users", {
          headers: await approvalHeaders(page),
        })
      ).json();
      const panel = await openDelete(page, owned, kind);
      await expect(panel).toContainText("앱 0개도 함께 삭제");
      await panel
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
      await expect(panel).toContainText("소유 앱 0개 삭제가 확정됐어요");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      await expect(panel).not.toContainText("현재 대상을 불러오지 못했어요");
      await expect(userRow(page, owned[kind].login)).toHaveCount(0);
      const after = await (
        await page.request.get("/api/v1/admin/users", {
          headers: await approvalHeaders(page),
        })
      ).json();
      expect(after.stats.total_users).toBe(before.stats.total_users - 1);
      expect(after.stats.total_apps).toBe(before.stats.total_apps);
      for (const [label, value] of [
        ["전체 사용자", after.stats.total_users],
        ["등록된 앱", after.stats.total_apps],
      ])
        await expect(
          page.getByText(label, { exact: true }).locator("..").locator("dd"),
        ).toHaveText(String(value));
      await expect(
        panel.getByRole("button", { name: "닫기", exact: true }),
      ).toBeEnabled();
      await panel.getByRole("button", { name: "닫기", exact: true }).click();
      await expect(panel).toHaveCount(0);
    }
    expect(
      (
        await targetPage.request.get("/api/v1/auth/me", { headers: oldHeaders })
      ).status(),
    ).toBe(401);
  });
  test("a Health Monitor loaded before a confirmed deletion never shows the deleted owner's apps again", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    // Hold the fresh target read while visiting the monitor. Returning to users
    // requires a fresh row click; the old response must not reopen its panel.
    const gate = deferred();
    let holding = true;
    await page.route(
      `**/api/v1/admin/users/${owned.member.id}`,
      async (route) => {
        if (route.request().method() !== "GET" || !holding)
          return route.continue();
        await gate.promise;
        await route.continue().catch(() => {});
      },
    );
    try {
      await openDelete(page, owned);
      const memberApps = ["app-0", "app-1"].map(
        (suffix) => `${owned.member.login.split("-member")[0]}-${suffix}`,
      );
      const monitorApp = (name) =>
        page.getByRole("button", { name: `앱 관리: ${name}` });
      await page.getByRole("tab", { name: "Health Monitor" }).click();
      await expect(monitorList(page)).toBeVisible();
      for (const name of memberApps)
        await expect(monitorApp(name)).toBeVisible();
      holding = false;
      gate.resolve();
      await page.getByRole("tab", { name: "사용자 관리" }).click();
      await expect(
        page.getByRole("region", { name: /계정.*삭제/ }),
      ).toHaveCount(0);
      const panel = await openDelete(page, owned);
      await panel
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
      await expect(panel).toContainText("삭제가 확정됐어요");
      await expect(panel).toHaveAttribute("aria-busy", "false");
      const release = deferred();
      const held = await holdLists(page, release);
      await page.getByRole("tab", { name: "Health Monitor" }).click();
      await expect.poll(() => held.contexts.length).toBeGreaterThan(0);
      for (const name of memberApps)
        await expect(monitorApp(name)).toHaveCount(0);
      release.resolve();
      await expect(monitorList(page)).toBeVisible();
      for (const name of memberApps)
        await expect(monitorApp(name)).toHaveCount(0);
      const monitor = await (
        await page.request.get("/api/v1/admin/apps?limit=100", {
          headers: await approvalHeaders(page),
        })
      ).json();
      expect(
        monitor.items.filter((item) => item.owner.id === owned.member.id),
      ).toEqual([]);
    } finally {
      gate.resolve();
    }
  });
});

test.describe("254 public header recovery", () => {
  test.skip(!prepared, "requires isolated prepared authentication");
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90000);
    await blockExternalRequests(context);
  });

  async function retainedRecord(page) {
    return page.evaluate(() => localStorage.getItem("eduvibe-auth-flow-v1"));
  }
  function monitor(page) {
    const counts = { creates: 0, logins: 0, resets: 0, writes: 0 };
    page.on("request", (request) => {
      if (!["POST", "PATCH", "DELETE"].includes(request.method())) return;
      const path = new URL(request.url()).pathname;
      if (path.endsWith("/auth/flows")) counts.creates++;
      else if (path.endsWith("/auth/login")) counts.logins++;
      else if (/\/auth\/.*(?:reset|recovery)/.test(path)) counts.resets++;
      else if (/\/(?:apps|write-operations)(?:\/|$)/.test(path))
        counts.writes++;
    });
    return counts;
  }
  async function assertRetained(page, record, counts) {
    expect(
      (await retainedRecord(page)) === record,
      "retained browser record",
    ).toBe(true);
    expect(counts).toEqual({ creates: 0, logins: 0, resets: 0, writes: 0 });
  }
  async function errorHeader(page, member) {
    const header = page.getByRole("banner");
    await expect(
      header.getByRole("button", { name: "인증 복구", exact: true }),
    ).toBeVisible();
    await expect(
      header.getByRole("button", { name: "다시 확인", exact: true }),
    ).toBeVisible();
    await expect(header.getByRole("button", { name: "로그아웃" })).toHaveCount(
      0,
    );
    await expect(header.getByText(member.login, { exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByPlaceholder("앱·작성자 검색")).toBeEnabled();
    return header;
  }
  async function recoveryScreen(page) {
    await expect(page).toHaveURL("/auth?mode=login&return_to=%2F");
    const main = page.getByRole("main");
    await expect(main).toContainText("로그인 상태를 확인할 수 없어요");
    await expect(
      main.getByRole("button", { name: "브라우저 인증 초기화", exact: true }),
    ).toBeVisible();
    return main;
  }
  async function loginReady(page, counts) {
    await expect(
      page.getByLabel("로그인 아이디", { exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("비밀번호", { exact: true })).toBeEnabled();
    await expect(
      page
        .getByRole("main")
        .getByRole("button", { name: "로그인", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("link", { name: /회원가입/ })).toBeVisible();
    expect(counts.creates).toBe(1);
    expect(counts.logins).toBe(0);
    expect(counts.writes).toBe(0);
    await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  }

  test("254 deleted member reaches explicit auth recovery from public header", async ({
    page,
    owned,
  }, testInfo) => {
    const memberContext = await owned.newContext();
    await blockExternalRequests(memberContext);
    const memberPage = await memberContext.newPage();
    await login(memberPage, owned.member.login, PASSWORD);
    await expect(
      memberPage.getByRole("button", { name: "로그아웃" }),
    ).toBeVisible();
    await memberPage.goto("/");
    await expect(
      memberPage.getByRole("button", { name: "로그아웃" }),
    ).toBeVisible();
    const record = await retainedRecord(memberPage);
    const counts = monitor(memberPage);
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(panel).toContainText("삭제가 확정됐어요");
    await memberPage.reload();
    const header = await errorHeader(memberPage, owned.member);
    await assertRetained(memberPage, record, counts);
    const geometry = [];
    for (const viewport of viewports) {
      await prepareViewportCapture(memberPage, viewport);
      const controls = [
        header.getByRole("link", { name: "EduVibe 아카이브 홈" }),
        header.getByRole("button", { name: "다시 확인", exact: true }),
        header.getByRole("button", { name: "인증 복구", exact: true }),
      ];
      const outer = await header.boundingBox();
      const boxes = await Promise.all(
        controls.map((control) => control.boundingBox()),
      );
      for (let index = 0; index < boxes.length; index++) {
        const box = boxes[index];
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y).toBeGreaterThanOrEqual(outer.y);
        expect(box.y + box.height).toBeLessThanOrEqual(outer.y + outer.height);
        if (index) {
          const lines = await controls[index].evaluate((button) => {
            const range = document.createRange();
            range.selectNodeContents(button);
            return [...range.getClientRects()].map((rect) => rect.top);
          });
          expect(new Set(lines).size).toBe(1);
        }
        for (const previous of boxes.slice(0, index))
          expect(previous.x + previous.width).toBeLessThanOrEqual(box.x);
      }
      await controls[1].focus();
      await memberPage.keyboard.press("Tab");
      await expect(controls[2]).toBeFocused();
      const outline = await controls[2].evaluate((button) => {
        const style = getComputedStyle(button);
        return {
          style: style.outlineStyle,
          width: parseFloat(style.outlineWidth),
          color: style.outlineColor,
        };
      });
      expect(outline.style).not.toBe("none");
      expect(outline.width).toBeGreaterThan(0);
      expect(outline.color).not.toBe("rgba(0, 0, 0, 0)");
      geometry.push({ viewport, boxes, outline });
      const shot = testInfo.outputPath(`header-recovery-${viewport.width}.png`);
      await header.screenshot({ path: shot });
      await testInfo.attach(`header-recovery-${viewport.width}`, {
        path: shot,
        contentType: "image/png",
      });
    }
    await testInfo.attach("header-geometry", {
      body: JSON.stringify(geometry),
      contentType: "application/json",
    });
    await memberPage.keyboard.press("Enter");
    const main = await recoveryScreen(memberPage);
    await expect(main).toContainText("이전 흐름이 종료됐어요");
    await expect(main).toBeFocused();
    await assertRetained(memberPage, record, counts);
    await main
      .getByRole("button", { name: "브라우저 인증 초기화", exact: true })
      .click();
    await loginReady(memberPage, counts);
    expect((await retainedRecord(memberPage)) !== record).toBe(true);
    expect(
      query(`SELECT count(*) FROM members WHERE id='${owned.member.id}'`),
    ).toEqual([[0]]);
    expect(
      query(`SELECT count(*) FROM apps WHERE owner_id='${owned.member.id}'`),
    ).toEqual([[0]]);
    await expect(userRow(page, owned.member.login)).toHaveCount(0);
  });

  test("254 active proof loss reaches recovery without bypass", async ({
    owned,
  }) => {
    const context = await owned.newContext();
    await blockExternalRequests(context);
    const page = await context.newPage();
    await login(page, owned.member.login, PASSWORD);
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
    const record = await retainedRecord(page);
    const counts = monitor(page);
    const eligible = [];
    page.on("response", async (response) => {
      if (response.url().endsWith("/restart-eligibility") && response.ok())
        eligible.push((await response.json()).restart_eligible);
    });
    await context.clearCookies();
    await page.reload();
    const header = await errorHeader(page, owned.member);
    await expect.poll(() => eligible.includes(false)).toBe(true);
    await assertRetained(page, record, counts);
    await header
      .getByRole("button", { name: "인증 복구", exact: true })
      .click();
    const main = await recoveryScreen(page);
    await expect(main).toContainText("증명");
    await assertRetained(page, record, counts);
    const reads = eligible.length;
    await main
      .getByRole("button", { name: "브라우저 인증 초기화", exact: true })
      .click();
    await expect.poll(() => eligible.length).toBeGreaterThan(reads);
    await expect(main).toContainText(
      "이전 흐름이 종료될 때까지 공개 열람만 가능합니다.",
    );
    await main.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(
      main.getByRole("button", { name: "브라우저 인증 초기화", exact: true }),
    ).toBeEnabled();
    await assertRetained(page, record, counts);
    await expect(page.getByLabel("로그인 아이디", { exact: true })).toHaveCount(
      0,
    );
    const flow = JSON.parse(record).flowId;
    query(
      `UPDATE auth_flows SET expires_at='2000-01-01T00:00:00Z' WHERE id='${flow}'`,
    );
    await main.getByRole("button", { name: "다시 확인", exact: true }).click();
    await expect(main).toContainText("이전 흐름이 종료됐어요");
    await expect.poll(() => eligible.includes(true)).toBe(true);
    await assertRetained(page, record, counts);
    await main
      .getByRole("button", { name: "브라우저 인증 초기화", exact: true })
      .click();
    await loginReady(page, counts);
    expect((await retainedRecord(page)) !== record).toBe(true);
  });
});
