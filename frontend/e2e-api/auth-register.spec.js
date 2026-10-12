import { spawnSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  deferred,
  prepareViewportCapture,
  query,
  viewports,
} from "./helpers.js";
const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const PASSWORD = "  가입 비밀번호 보존 AbC 1234  ";

async function signup(page, id, nickname = "같은 별명") {
  await page.goto("/auth?mode=signup");
  await page.getByLabel("로그인 아이디 (필수)", { exact: true }).fill(id);
  await page.getByLabel("비밀번호 (필수)", { exact: true }).fill(PASSWORD);
  await page.getByLabel("비밀번호 확인 (필수)", { exact: true }).fill(PASSWORD);
  await page.getByLabel("별명 (필수)", { exact: true }).fill(nickname);
}
async function submit(page) {
  await page
    .getByRole("button", { name: "가입 신청하기", exact: true })
    .click();
}
async function login(page, id, password = PASSWORD) {
  await page.goto("/auth?mode=login");
  await page.getByLabel("로그인 아이디", { exact: true }).fill(id);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
}

test("registration stays off in ordinary runs and on only in the prepared boundary", async ({
  request,
}) => {
  const meta = await (await request.get("/api/v1/meta")).json();
  expect(meta.capabilities.auth_register.enabled).toBe(prepared);
  expect(meta.capabilities.email_collection.enabled).toBe(false);
  expect(meta.capabilities.phone_collection.enabled).toBe(false);
  expect(meta.support).toEqual({
    email: null,
    service_url: null,
    announcement_url: null,
  });
  expect(meta.capabilities.admin_approval.enabled).toBe(prepared);
});

test.describe("real pending registration", () => {
  test.skip(!prepared, "ordinary runtime intentionally disables T04 until T05");
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
  });

  let ownedBefore;
  test.beforeEach(() => {
    ownedBefore = Object.fromEntries(
      ["members", "auth_flows", "rate_limit_events"].map((table) => [
        table,
        query(`SELECT id FROM ${table}`).map(([id]) => id),
      ]),
    );
  });
  test.afterEach(async ({ context }) => {
    await context.close();
    const cleanup = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        `import json, os, sqlite3, sys
previous = json.load(sys.stdin)
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    db.execute('PRAGMA foreign_keys=ON')
    for flow, in db.execute('SELECT id FROM auth_flows').fetchall():
        if flow not in previous['auth_flows']:
            for table in ('auth_transitions', 'recovery_credentials', 'auth_retired_credentials', 'sessions'):
                db.execute(f'DELETE FROM {table} WHERE flow_id=?', (flow,))
            db.execute('DELETE FROM auth_flows WHERE id=?', (flow,))
    for member, in db.execute('SELECT id FROM members').fetchall():
        if member not in previous['members']:
            db.execute('DELETE FROM members WHERE id=?', (member,))
    for event, in db.execute('SELECT id FROM rate_limit_events').fetchall():
        if event not in previous['rate_limit_events']:
            db.execute('DELETE FROM rate_limit_events WHERE id=?', (event,))
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
`,
      ],
      {
        cwd: "../backend",
        env: process.env,
        input: JSON.stringify(ownedBefore),
        encoding: "utf8",
      },
    );
    expect(cleanup.status, "registration-owned rows and limiter cleanup").toBe(
      0,
    );
  });

  test("signup rejects raw format characters, preserves fields and accepts a corrected nickname", async ({
    page,
  }) => {
    await signup(page, "nickname-teacher");
    for (const nickname of ["교\u200b사", "\ufeff교사", "교사\ufeff"]) {
      await page.locator("#nickname").fill(nickname);
      const response = page.waitForResponse("**/api/v1/auth/register");
      await submit(page);
      const rejected = await response;
      expect(rejected.status()).toBe(422);
      expect(rejected.request().postDataJSON().nickname).toBe(nickname);
      expect((await rejected.json()).error).toMatchObject({
        code: "VALIDATION_ERROR",
        fields: {
          nickname: "별명은 제어문자 없이 보이는 문자로 2~20자 입력해 주세요.",
        },
      });
      await expect(page.locator("#nickname-error")).toHaveText(
        "별명은 제어문자 없이 보이는 문자로 2~20자 입력해 주세요.",
      );
      await expect(page.locator("#nickname")).toBeFocused();
      await expect(page.locator("#nickname")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await expect(page.locator("#nickname")).toHaveAttribute(
        "aria-describedby",
        "nickname-error",
      );
      for (const [selector, value] of [
        ["#nickname", nickname],
        ["#login-id", "nickname-teacher"],
        ["#login-password", PASSWORD],
        ["#password-confirm", PASSWORD],
      ])
        await expect(page.locator(selector)).toHaveValue(value);
      expect(
        query(
          "SELECT count(*) FROM members WHERE login_id_key='nickname-teacher'",
        ),
      ).toEqual([[0]]);
    }
    await page.locator("#nickname").fill(" e\u0301😀 ");
    await submit(page);
    await expect(
      page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
    ).toBeVisible();
    expect(
      query(
        "SELECT nickname FROM members WHERE login_id_key='nickname-teacher'",
      ),
    ).toEqual([["é😀"]]);
  });

  test("confirmation is browser-only, anonymous cookie unchanged, pending DB and exact credentials", async ({
    page,
    context,
  }) => {
    await signup(page, "register-member");
    await expect(
      page.getByRole("link", { name: /이메일 문의|서비스 문의|공지사항/ }),
    ).toHaveCount(0);
    let writes = 0;
    page.on("request", (req) => {
      if (req.url().endsWith("/auth/register")) writes++;
    });
    await page
      .getByLabel("비밀번호 확인 (필수)", { exact: true })
      .fill("wrong confirmation");
    await submit(page);
    await expect(
      page.getByText("비밀번호 확인이 일치하지 않습니다."),
    ).toBeVisible();
    expect(writes).toBe(0);
    await page
      .getByLabel("비밀번호 확인 (필수)", { exact: true })
      .fill(PASSWORD);
    await page.locator("#email").fill("synthetic@example.test");
    await page.locator("#phone").fill("synthetic phone");
    await submit(page);
    await expect(page.locator("#email-error")).toHaveText(
      "현재 선택 정보는 수집하지 않습니다. 비워 주세요.",
    );
    await expect(page.locator("#phone-error")).toHaveText(
      "현재 선택 정보는 수집하지 않습니다. 비워 주세요.",
    );
    await expect(page.locator("#email")).toBeFocused();
    expect(writes).toBe(0);
    await page.locator("#email").fill("");
    await page.locator("#phone").fill("");
    const cookies = await context.cookies();
    const sent = page.waitForRequest("**/api/v1/auth/register");
    await submit(page);
    const registration = await sent;
    expect(registration.postDataJSON()).toEqual({
      login_id: "register-member",
      password: PASSWORD,
      nickname: "같은 별명",
    });
    await expect(
      page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
    ).toBeVisible();
    await expect(page.getByText(/자동 로그인되지/)).toBeVisible();
    await expect(page.getByText(/가입일부터 90일/)).toBeVisible();
    await expect(
      page.getByText(/운영 문의 주소는 현재 설정되지/),
    ).toBeVisible();
    expect(await context.cookies()).toEqual(cookies);
    // A direct HTTP client still receives the defensive server field contract.
    const headers = await registration.allHeaders();
    for (const key of ["host", "content-length", "connection"])
      delete headers[key];
    const refused = await page.request.post("/api/v1/auth/register", {
      headers,
      data: {
        ...registration.postDataJSON(),
        login_id: "register-contact-refused",
        email: "synthetic@example.test",
        phone: "synthetic phone",
      },
    });
    expect(refused.status()).toBe(422);
    expect((await refused.json()).error).toMatchObject({
      code: "VALIDATION_ERROR",
      fields: {
        email: "현재 선택 정보는 수집하지 않습니다. 비워 주세요.",
        phone: "현재 선택 정보는 수집하지 않습니다. 비워 주세요.",
      },
    });
    expect(
      query(
        "SELECT count(*) FROM members WHERE login_id_key='register-contact-refused'",
      ),
    ).toEqual([[0]]);
    expect(
      query(
        "SELECT approval_status,is_admin,first_approved_at,email,phone FROM members WHERE login_id_key='register-member'",
      ),
    ).toEqual([["pending", 0, null, null, null]]);
    expect(
      query(
        "SELECT count(*) FROM sessions s JOIN members m ON s.member_id=m.id WHERE m.login_id_key='register-member'",
      ),
    ).toEqual([[0]]);
    await login(page, "register-member", PASSWORD + "!");
    await expect(
      page.getByText("로그인 아이디 또는 비밀번호를 확인해 주세요."),
    ).toBeVisible();
    await login(page, "register-member");
    await expect(page.getByText(/승인 대기 중인 계정/)).toBeVisible();
    await signup(page, "register-other");
    await submit(page);
    await expect(
      page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
    ).toBeVisible();
    expect(
      query("SELECT count(*) FROM members WHERE nickname='같은 별명'"),
    ).toEqual([[2]]);
    await signup(page, "REGISTER-MEMBER");
    await submit(page);
    await expect(
      page.getByText("이미 사용 중인 로그인 아이디입니다."),
    ).toBeVisible();
    await expect(page.locator("#login-id")).toBeFocused();
    await expect(page.locator("#login-id")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  test("duplicate click is blocked and a committed lost reply retains DB state without member cookies", async ({
    page,
    context,
  }) => {
    await signup(page, "register-lost");
    const attemptsBefore = query(
      "SELECT count(*) FROM rate_limit_events WHERE purpose='register'",
    )[0][0];
    const cookies = await context.cookies();
    const entered = deferred(),
      release = deferred();
    let writes = 0;
    await page.route("**/api/v1/auth/register", async (route) => {
      writes++;
      const request = route.request();
      const headers = await request.allHeaders();
      for (const key of ["host", "content-length", "connection"])
        delete headers[key];
      const result = await fetch(request.url(), {
        method: "POST",
        headers,
        body: request.postData(),
      });
      expect(result.status).toBe(201);
      expect(result.headers.get("set-cookie")).toBeNull();
      entered.resolve();
      await release.promise;
      await route.abort("failed");
    });
    await submit(page);
    await entered.promise;
    await expect(
      page.getByRole("button", { name: "가입 신청 중…", exact: true }),
    ).toBeDisabled();
    await page
      .locator("form")
      .evaluate((form) =>
        form.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
      );
    expect(writes).toBe(1);
    expect(
      query(
        "SELECT approval_status FROM members WHERE login_id_key='register-lost'",
      ),
    ).toEqual([["pending"]]);
    expect(
      query(
        "SELECT count(*) FROM sessions s JOIN members m ON s.member_id=m.id WHERE m.login_id_key='register-lost'",
      ),
    ).toEqual([[0]]);
    release.resolve();
    await expect(page.getByText(/가입 결과를 확인할 수 없어요/)).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect(writes).toBe(1);
    expect(
      query("SELECT count(*) FROM rate_limit_events WHERE purpose='register'"),
    ).toEqual([[attemptsBefore + 1]]);
    expect(
      query("SELECT count(*) FROM members WHERE login_id_key='register-lost'"),
    ).toEqual([[1]]);
    expect(await context.cookies()).toEqual(cookies);
    await page.unroute("**/api/v1/auth/register");
    await login(page, "register-lost");
    await expect(page.getByText(/승인 대기 중인 계정/)).toBeVisible();
  });

  for (const viewport of viewports)
    test(`registration cards at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      await page.clock.setFixedTime(new Date("2026-10-01T00:00:00Z"));
      await page.setViewportSize(viewport);
      await signup(page, `capture-${viewport.width}`);
      let writes = 0;
      page.on("request", (request) => {
        if (request.url().endsWith("/auth/register")) writes++;
      });
      await expect(page.getByText(/실제 수집 기능은 비활성화/)).toBeVisible();
      await expect(page.getByText(/개발용|mock|가짜 비밀번호/)).toHaveCount(0);
      await expect(page.locator("#contact-hint")).toHaveText(
        "이메일·연락처는 선택이며 공개 화면에 표시되지 않습니다. 실제 수집 기능은 비활성화되어 있습니다.",
      );
      for (const selector of ["#email", "#phone"]) {
        await expect(page.locator(selector)).toHaveAttribute(
          "aria-describedby",
          "contact-hint",
        );
      }
      const fields = [
        "#login-id",
        "#login-password",
        "#password-confirm",
        "#nickname",
        "#email",
        "#phone",
      ];
      await page.locator(fields[0]).focus();
      for (const selector of fields.slice(1)) {
        await page.keyboard.press("Tab");
        await expect(page.locator(selector)).toBeFocused();
      }
      await prepareViewportCapture(page, viewport);
      await page.screenshot({
        path: test.info().outputPath("signup.png"),
        fullPage: true,
        animations: "disabled",
      });
      await page.locator("#email").fill("synthetic@example.test");
      await submit(page);
      await expect(
        page.getByText("현재 선택 정보는 수집하지 않습니다. 비워 주세요."),
      ).toBeVisible();
      await expect(page.locator("#email")).toBeFocused();
      await expect(page.locator("#email")).toHaveAttribute(
        "aria-describedby",
        "email-error",
      );
      await expect(page.locator("#email")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(writes).toBe(0);
      await page.locator("#email").fill("");
      await prepareViewportCapture(page, viewport);
      await page.screenshot({
        path: test.info().outputPath("collection-error.png"),
        fullPage: true,
        animations: "disabled",
      });
      await page.locator("#email").fill("");
      await submit(page);
      await expect(
        page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
      ).toBeVisible();
      await prepareViewportCapture(page, viewport);
      await page.screenshot({
        path: test.info().outputPath("pending.png"),
        fullPage: true,
        animations: "disabled",
      });
    });
});
