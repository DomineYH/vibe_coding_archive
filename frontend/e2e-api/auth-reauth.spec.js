import { expect, test } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import {
  admit as admitDirect,
  anonymous,
  request as requestDirect,
  state as directState,
} from "./auth-race-helpers.js";
const PASSWORD = "합성 로그인 비밀번호 1234";
const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";

async function login(page) {
  await page.goto("/auth?mode=login&return_to=%2Fadmin");
  await page.getByLabel("로그인 아이디", { exact: true }).fill("admin-user");
  await page.getByLabel("비밀번호", { exact: true }).fill(PASSWORD);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
}
async function verify(page, password = PASSWORD) {
  await page.getByLabel("현재 관리자 비밀번호").fill(password);
  await page.getByRole("button", { name: "본인 확인", exact: true }).click();
}
function sessions(flow) {
  return query(
    `SELECT token_hash,csrf_token,absolute_expires_at,recent_auth_until,revoked_at FROM sessions WHERE flow_id='${flow}' AND kind='full' ORDER BY rowid`,
  );
}
async function flow(page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")).flowId,
  );
}

test("admin reauth follows the prepared capability boundary", async ({
  request,
}) => {
  const meta = await request.get("/api/v1/meta");
  const { capabilities } = await meta.json();
  expect(capabilities.admin_reauth.enabled).toBe(prepared);
  for (const key of [
    "admin_password_reset",
    "admin_user_delete",
    "admin_apps_read",
    "admin_apps_manage",
  ])
    expect(capabilities[key].enabled).toBe(false);
});

test.describe("existing administrator card over real cookies", () => {
  test.skip(!prepared, "requires isolated prepared authentication");
  test.beforeEach(async ({ page }) => {
    test.setTimeout(60000);
    await blockExternalRequests(page);
  });
  test("login grants recent auth; card rotates only this device and returns without a sensitive write", async ({
    page,
    browser,
  }) => {
    const other = await browser.newContext();
    await blockExternalRequests(other);
    const second = await other.newPage();
    await login(second);
    const otherFlow = await flow(second);
    const otherRows = sessions(otherFlow);
    await login(page);
    const currentFlow = await flow(page);
    const before = sessions(currentFlow);
    expect(before[0][3]).not.toBeNull();
    const versions = query(
      "SELECT account_version FROM members WHERE login_id='admin-user'",
    );
    let writes = 0;
    page.on("request", (r) => {
      if (
        r.method() === "POST" &&
        /admin\/users|write-operations/.test(r.url())
      )
        writes++;
    });
    await page.goto("/auth?mode=reauth&return_to=%2Fadmin");
    await expect(
      page.getByRole("heading", { name: "관리자 본인 확인" }),
    ).toBeVisible();
    const request = page.waitForRequest("**/api/v1/auth/reauth");
    await verify(page);
    expect((await request).postDataJSON()).toEqual({ password: PASSWORD });
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    const after = sessions(currentFlow);
    expect(after).toHaveLength(2);
    expect(after[0][4]).not.toBeNull();
    expect(after[1][0]).not.toBe(before[0][0]);
    expect(after[1][1]).not.toBe(before[0][1]);
    expect(after[1][2]).toBe(before[0][2]);
    expect(after[1][3]).not.toBeNull();
    expect(sessions(otherFlow)).toEqual(otherRows);
    expect(
      query("SELECT account_version FROM members WHERE login_id='admin-user'"),
    ).toEqual(versions);
    expect(writes).toBe(0);
    const stored = await page.evaluate(() =>
      JSON.stringify([
        { ...localStorage },
        { ...sessionStorage },
        history.state,
      ]),
    );
    expect(stored).not.toContain(PASSWORD);
    await other.close();
  });
  test("wrong password and cancellation keep administrator reads", async ({
    page,
  }) => {
    await login(page);
    const currentFlow = await flow(page);
    const before = sessions(currentFlow);
    await page.goto("/auth?mode=reauth&return_to=%2Fadmin");
    await verify(page, "wrong synthetic password 1234");
    await expect(
      page.getByText(
        "관리자 비밀번호를 확인해 주세요. 현재 로그인은 유지됩니다.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("현재 관리자 비밀번호")).toHaveValue("");
    expect(sessions(currentFlow)).toEqual(before);
    await page.getByRole("link", { name: "취소하고 돌아가기" }).click();
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
  });
  test("lost committed body is confirmed without repeating password verification", async ({
    page,
    context,
  }) => {
    await login(page);
    await page.goto("/auth?mode=reauth&return_to=%2Fadmin");
    let executions = 0;
    await page.route("**/api/v1/auth/reauth", async (route) => {
      executions++;
      const reply = await route.fetch();
      expect(reply.status()).toBe(200);
      // APIRequestContext receives the real committed cookie; only the body is lost.
      const cookie = reply.headers()["set-cookie"].split(";")[0];
      const equals = cookie.indexOf("=");
      await context.addCookies([
        {
          name: cookie.slice(0, equals),
          value: cookie.slice(equals + 1),
          url: "http://localhost:5174",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await route.abort("failed");
    });
    await verify(page);
    await expect(
      page.getByRole("button", { name: "결과 확인", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "결과 확인", exact: true }).click();
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    expect(executions).toBe(1);
  });
});

test("late real reauth success cannot replace a different member or navigate its screen", async ({
  page,
  context,
}) => {
  test.skip(!prepared, "requires prepared authentication");
  test.setTimeout(90000);
  await blockExternalRequests(context);
  await login(page);
  await page.goto("/auth?mode=reauth&return_to=%2Fadmin");
  let release;
  let entered;
  const committed = new Promise((resolve) => {
    entered = resolve;
  });
  let executions = 0;
  await page.route("**/api/v1/auth/reauth", async (route) => {
    executions++;
    const reply = await route.fetch();
    expect(reply.status()).toBe(200);
    const cookie = reply.headers()["set-cookie"].split(";")[0];
    const equals = cookie.indexOf("=");
    await context.addCookies([
      {
        name: cookie.slice(0, equals),
        value: cookie.slice(equals + 1),
        url: "http://localhost:5174",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const wait = new Promise((resolve) => {
      release = resolve;
    });
    entered();
    await wait;
    await route.fulfill({ response: reply });
  });
  await verify(page);
  await committed;
  // The first tab intentionally holds the Web Lock until its body arrives.
  // Real HTTP commits model a competing client that does not share that lock.
  try {
    const logout = await admitDirect(page, "logout");
    expect(
      (await requestDirect(page, "/api/v1/auth/logout", {}, logout.headers))
        .status,
    ).toBe(204);
    await anonymous(page);
    const login = await admitDirect(page, "login");
    const result = await requestDirect(
      page,
      "/api/v1/auth/login",
      { login_id: "member-a", password: PASSWORD },
      login.headers,
    );
    expect(result.status).toBe(200);
    expect(result.body.user.role).toBe("user");
    const latest = (await directState(page)).body;
    await page.evaluate(
      ({ flowId, revision }) => {
        localStorage.setItem(
          "eduvibe-auth-flow-v1",
          JSON.stringify({ flowId, revision }),
        );
      },
      { flowId: latest.flow_id, revision: latest.revision },
    );
  } finally {
    release();
  }
  await page.bringToFront();
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/auth");
  await expect(
    page
      .getByRole("alert")
      .getByText("현재 로그인한 관리자가 필요해요", { exact: true }),
  ).toBeVisible();
  expect(executions).toBe(1);
});
