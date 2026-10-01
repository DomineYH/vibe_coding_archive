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
  expect(meta.capabilities.admin_approval.enabled).toBe(false);
});

test.describe("real pending registration", () => {
  test.skip(!prepared, "ordinary runtime intentionally disables T04 until T05");
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
  });

  test("confirmation is browser-only, anonymous cookie unchanged, pending DB and exact credentials", async ({
    page,
    context,
  }) => {
    await signup(page, "register-member");
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
    const cookies = await context.cookies();
    const sent = page.waitForRequest("**/api/v1/auth/register");
    await submit(page);
    expect((await sent).postDataJSON()).toEqual({
      login_id: "register-member",
      password: PASSWORD,
      nickname: "같은 별명",
      email: "",
      phone: "",
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
      await expect(page.getByText(/실제 수집 기능은 비활성화/)).toBeVisible();
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
