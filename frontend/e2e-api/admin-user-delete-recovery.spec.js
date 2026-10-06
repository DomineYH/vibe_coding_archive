import { expect } from "@playwright/test";
import { blockExternalRequests, deferred, query } from "./helpers.js";
import {
  test,
  login,
  openAdmin,
  openDelete,
  PASSWORD,
  findRow,
} from "./user-delete-helpers.js";
const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.describe("account deletion recovery over real HTTP", () => {
  test.skip(!prepared, "requires isolated prepared authentication");
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90000);
    await blockExternalRequests(context);
  });
  test("lost committed response discovers success from the original key after target disappearance", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
    let issues = 0,
      writes = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route("**/api/v1/admin/users/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      writes++;
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      await route.abort("failed");
    });
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(panel).toContainText("삭제가 확정됐어요");
    expect(issues).toBe(1);
    expect(writes).toBe(1);
    expect(
      query(`SELECT count(*) FROM members WHERE id='${owned.member.id}'`)[0][0],
    ).toBe(0);
  });
  test("unknown then unresolved lookup requires latest target confirmation and same-key retry", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
    let issues = 0,
      writes = 0;
    const keys = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
      if (request.method() === "DELETE") {
        writes++;
        keys.push(request);
      }
    });
    await page.route("**/api/v1/admin/users/*", (route) =>
      route.request().method() === "DELETE"
        ? route.abort("failed")
        : route.continue(),
    );
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(
      panel.getByRole("button", {
        name: "현재 회원 정보 다시 확인",
        exact: true,
      }),
    ).toBeEnabled();
    await panel
      .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
      .click();
    await page.unroute("**/api/v1/admin/users/*");
    await panel
      .getByRole("button", { name: "같은 삭제 요청 다시 제출", exact: true })
      .click();
    await expect(panel).toContainText("삭제가 확정됐어요");
    expect(issues).toBe(1);
    expect(writes).toBe(2);
    const sentKeys = await Promise.all(
      keys.map((request) => request.headerValue("idempotency-key")),
    );
    expect(sentKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(sentKeys[0]).toBe(sentKeys[1]);
  });
  test("execution count conflict requires fresh explicit confirmation", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
    let issues = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route("**/api/v1/admin/users/*", async (route) => {
      if (route.request().method() === "DELETE")
        query(
          `UPDATE apps SET owner_id='${owned.zero.id}' WHERE id='${owned.apps[0]}'`,
        );
      await route.continue();
    });
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(panel).toContainText("소유 앱 수가 달라 삭제하지 않았어요");
    await page.unroute("**/api/v1/admin/users/*");
    await panel
      .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
      .click();
    await expect(panel).toContainText("앱 1개도 함께 삭제");
    expect(issues).toBe(1);
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(panel).toContainText("삭제가 확정됐어요");
    expect(issues).toBe(2);
  });
  test("expired lookup and target refresh keep original unknown history", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
    let issues = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route("**/api/v1/admin/users/*", (route) =>
      route.request().method() === "DELETE"
        ? route.abort("failed")
        : route.continue(),
    );
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(
      panel.getByRole("button", { name: "결과 확인", exact: true }),
    ).toBeEnabled();
    query(
      `UPDATE write_operations SET expires_at='2000-01-01T00:00:00Z' WHERE kind='user_delete' AND target_id='${owned.member.id}'`,
    );
    await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
    await panel
      .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
      .click();
    await expect(panel).toContainText(
      "작업 키가 만료되어 과거 결과를 확인할 수 없어요",
    );
    await expect(
      panel.getByRole("button", { name: "삭제 확인", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", {
        name: "같은 삭제 요청 다시 제출",
        exact: true,
      }),
    ).toHaveCount(0);
    expect(issues).toBe(1);
  });
  test("reauth returns to the original key before target read without automatic execution", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    let panel = await openDelete(page, owned);
    let writes = 0,
      issues = 0;
    page.on("request", (request) => {
      if (request.method() === "DELETE") writes++;
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route("**/api/v1/admin/users/*", (route) =>
      route.request().method() === "DELETE"
        ? route.abort("failed")
        : route.continue(),
    );
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await panel
      .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
      .click();
    await page.unroute("**/api/v1/admin/users/*");
    query(
      `UPDATE sessions SET recent_auth_until='2000-01-01T00:00:00Z' WHERE member_id='${owned.admin.id}'`,
    );
    await panel
      .getByRole("button", { name: "같은 삭제 요청 다시 제출", exact: true })
      .click();
    await expect(page.getByLabel("현재 관리자 비밀번호")).toBeVisible();
    const reads = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        /write-operations\/|admin\/users\//.test(request.url())
      )
        reads.push(request.url());
    });
    await page.getByLabel("현재 관리자 비밀번호").fill(PASSWORD);
    await page.getByRole("button", { name: "본인 확인", exact: true }).click();
    await findRow(page, owned.member.login);
    panel = page.getByRole("region", { name: /계정.*삭제/ });
    await expect(
      panel.getByRole("button", {
        name: "같은 삭제 요청 다시 제출",
        exact: true,
      }),
    ).toBeEnabled();
    expect(reads[0]).toContain("/write-operations/");
    expect(issues).toBe(1);
    expect(writes).toBe(2);
    await panel
      .getByRole("button", { name: "같은 삭제 요청 다시 제출", exact: true })
      .click();
    await expect(panel).toContainText("삭제가 확정됐어요");
    expect(issues).toBe(1);
  });
  test("late issuance on route departure never executes", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
    const entered = deferred(),
      release = deferred();
    let writes = 0;
    page.on("request", (request) => {
      if (request.method() === "DELETE") writes++;
    });
    await page.route("**/api/v1/write-operations", async (route) => {
      const response = await route.fetch();
      entered.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await entered.promise;
    await page
      .getByRole("link", { name: /갤러리|아카이브|EduVibe/ })
      .first()
      .click();
    release.resolve();
    await page.waitForTimeout(250);
    expect(writes).toBe(0);
    expect(
      query(`SELECT count(*) FROM members WHERE id='${owned.member.id}'`)[0][0],
    ).toBe(1);
  });
  test("same administrator login restores only the original key; explicit logout discards it", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    let panel = await openDelete(page, owned);
    let issues = 0;
    const keys = [],
      reads = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
      if (request.method() === "DELETE") keys.push(request);
      if (
        request.method() === "GET" &&
        request.url().includes("/write-operations/")
      )
        reads.push(request.url());
    });
    await page.route("**/api/v1/admin/users/*", (route) =>
      route.request().method() === "DELETE"
        ? route.abort("failed")
        : route.continue(),
    );
    const issued = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response.url().endsWith("/write-operations") &&
        response.status() === 201,
    );
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(panel).toContainText("삭제 결과가 아직 확정되지 않았어요");
    const originalKey = (await (await issued).json()).key;
    const submitted = keys.length;
    expect(submitted).toBeLessThanOrEqual(1);
    query(
      `UPDATE sessions SET revoked_at='2000-01-01T00:00:00Z' WHERE member_id='${owned.admin.id}'`,
    );
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      page.getByLabel("로그인 아이디", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("로그인 아이디", { exact: true })
      .fill(owned.admin.login);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await findRow(page, owned.member.login);
    panel = page.getByRole("region", { name: /계정.*삭제/ });
    await expect(panel).toContainText("삭제 결과가 아직 확정되지 않았어요");
    expect(originalKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(reads.at(-1)).toContain(originalKey);
    expect(keys).toHaveLength(submitted);
    expect(issues).toBe(1);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await page
      .getByLabel("로그인 아이디", { exact: true })
      .fill(owned.admin.login);
    await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await page.getByRole("link", { name: "관리자", exact: true }).click();
    await findRow(page, owned.member.login);
    await expect(page.getByRole("region", { name: /계정.*삭제/ })).toHaveCount(
      0,
    );
    expect(issues).toBe(1);
    expect(keys).toHaveLength(submitted);
  });

  test("positive proof of another account discards deletion history before the administrator returns", async ({
    page,
    owned,
  }) => {
    await openAdmin(page, owned);
    const panel = await openDelete(page, owned);
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
    await page.route("**/api/v1/admin/users/*", (route) =>
      route.request().method() === "DELETE"
        ? route.abort("failed")
        : route.continue(),
    );
    await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(panel).toContainText("삭제 결과가 아직 확정되지 않았어요");
    const originalCookies = await page.context().cookies();
    const originalFlow = await page.evaluate(() =>
      localStorage.getItem("eduvibe-auth-flow-v1"),
    );
    const otherContext = await owned.newContext();
    await blockExternalRequests(otherContext);
    const otherPage = await otherContext.newPage();
    await login(otherPage, owned.zero.login, PASSWORD);
    await expect(
      otherPage
        .getByRole("banner")
        .getByText(owned.zero.login, { exact: true }),
    ).toBeVisible();
    const otherCookies = await otherContext.cookies();
    const otherFlow = await otherPage.evaluate(() =>
      localStorage.getItem("eduvibe-auth-flow-v1"),
    );
    async function install(cookies, value) {
      await page.context().clearCookies();
      await page.context().addCookies(cookies);
      await page.evaluate((newValue) => {
        window.dispatchEvent(new Event("blur"));
        const key = "eduvibe-auth-flow-v1",
          oldValue = localStorage.getItem(key);
        localStorage.setItem(key, newValue);
        window.dispatchEvent(
          new StorageEvent("storage", { key, oldValue, newValue }),
        );
        window.dispatchEvent(new Event("focus"));
      }, value);
    }
    await install(otherCookies, otherFlow);
    await expect(
      page.getByText("관리자 권한이 필요해요", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("banner").getByText(owned.zero.login, { exact: true }),
    ).toBeVisible();
    await install(originalCookies, originalFlow);
    await findRow(page, owned.member.login);
    await expect(page.getByRole("region", { name: /계정.*삭제/ })).toHaveCount(
      0,
    );
    expect(issues).toBe(1);
    expect(writes).toBe(1);
  });
});
