import { expect, test } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { login, openAdmin, userRow } from "./approval-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const PASSWORD = "  회원 완주 비밀번호 AbC 1234  ";
const PUBLIC_APP_ID = "00000000-0000-4000-8000-000000000002";

test("registration and administrator approval activate as one bundle; future features stay closed", async ({
  request,
}) => {
  const { capabilities } = await (await request.get("/api/v1/meta")).json();
  for (const key of [
    "auth_register",
    "admin_users_read",
    "admin_approval",
    "admin_summary",
  ])
    expect(capabilities[key].enabled).toBe(prepared);
  for (const key of [
    "admin_reauth",
    "admin_password_reset",
    "admin_user_delete",
    "admin_apps_read",
    "admin_apps_manage",
    "apps_create",
    "apps_update_own",
    "apps_delete_own",
  ])
    expect(capabilities[key].enabled).toBe(false);
});

if (prepared)
  test("signup → initial pending → actual approval → login → refresh → logout; revocation cannot revive old S", async ({
    page,
    browser,
    context,
    request,
  }) => {
    // Includes two logins, logout, revoke/reapprove, and anonymous app reads.
    test.setTimeout(60000);
    await blockExternalRequests(context);
    await page.goto("/auth?mode=signup");
    await page
      .getByLabel("로그인 아이디 (필수)", { exact: true })
      .fill("lifecycle-member");
    await page.getByLabel("비밀번호 (필수)", { exact: true }).fill(PASSWORD);
    await page
      .getByLabel("비밀번호 확인 (필수)", { exact: true })
      .fill(PASSWORD);
    await page.getByLabel("별명 (필수)", { exact: true }).fill("완주 교사");
    await page
      .getByRole("button", { name: "가입 신청하기", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
    ).toBeVisible();
    await login(page, "lifecycle-member", PASSWORD);
    await expect(page.getByText(/승인 대기 중인 계정/)).toBeVisible();
    expect(
      query(
        "SELECT approval_status,account_version,first_approved_at FROM members WHERE login_id_key='lifecycle-member'",
      ),
    ).toEqual([["pending", 1, null]]);
    const [[memberId]] = query(
      "SELECT id FROM members WHERE login_id_key='lifecycle-member'",
    );
    query(`UPDATE apps SET owner_id='${memberId}' WHERE id='${PUBLIC_APP_ID}'`);
    const publicApp = await (
      await request.get(`/api/v1/apps/${PUBLIC_APP_ID}`)
    ).json();
    expect(publicApp.item.owner.id).toBe(memberId);
    const adminContext = await browser.newContext();
    await blockExternalRequests(adminContext);
    const adminPage = await adminContext.newPage();
    try {
      await openAdmin(adminPage);
      let row = userRow(adminPage, "lifecycle-member");
      await row.getByRole("button", { name: "승인하기", exact: true }).click();
      await row
        .getByRole("button", { name: "승인하기 확인", exact: true })
        .click();
      await expect(
        adminPage.getByText(/요청한 승인 상태가 확정/),
      ).toBeVisible();
      expect(
        query(
          "SELECT approval_status,account_version FROM members WHERE login_id_key='lifecycle-member'",
        ),
      ).toEqual([["approved", 2]]);
      await page.bringToFront();
      await login(page, "lifecycle-member", PASSWORD);
      await expect(
        page.getByRole("banner").getByText("완주 교사", { exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("banner").getByText("완주 교사", { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "로그아웃", exact: true }),
      ).toHaveCount(0);
      await expect(
        page
          .getByRole("banner")
          .getByRole("button", { name: "로그인", exact: true }),
      ).toBeVisible();
      await login(page, "lifecycle-member", PASSWORD);
      await expect(
        page.getByRole("banner").getByText("완주 교사", { exact: true }),
      ).toBeVisible();
      const oldCookies = await context.cookies();
      const oldFlow = await page.evaluate(() =>
        localStorage.getItem("eduvibe-auth-flow-v1"),
      );
      const oldSession = oldCookies.find((cookie) =>
        cookie.name.startsWith("eduvibe_session_dev_"),
      );
      expect(oldSession).toBeDefined();
      const oldSessionQuery = `SELECT revoked_at IS NOT NULL FROM sessions WHERE flow_id='${JSON.parse(oldFlow).flowId}' AND issued_seq='${oldSession.name.split("_").at(-1)}' AND kind='full'`;
      expect(query(oldSessionQuery)).toEqual([[0]]);
      await adminPage.bringToFront();
      await adminPage.reload();
      row = userRow(adminPage, "lifecycle-member");
      // This newly approved member sorts with the next page.
      if ((await row.count()) === 0)
        await adminPage
          .getByRole("button", { name: /추가 회원 불러오기/ })
          .click();
      await row.getByRole("button", { name: "승인 해제", exact: true }).click();
      await row
        .getByRole("button", { name: "승인 해제 확인", exact: true })
        .click();
      await expect(
        adminPage.getByText(/요청한 승인 상태가 확정/),
      ).toBeVisible();
      expect(
        query(
          "SELECT count(*) FROM sessions s JOIN members m ON s.member_id=m.id WHERE m.login_id_key='lifecycle-member' AND s.revoked_at IS NULL",
        ),
      ).toEqual([[0]]);
      expect(query(oldSessionQuery)).toEqual([[1]]);
      const revokedList = await (await request.get("/api/v1/apps")).json();
      expect(revokedList.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: PUBLIC_APP_ID,
            owner: expect.objectContaining({ id: memberId }),
          }),
        ]),
      );
      expect(
        (await (await request.get(`/api/v1/apps/${PUBLIC_APP_ID}`)).json())
          .item,
      ).toEqual(publicApp.item);
      await page.bringToFront();
      await page.reload();
      await expect(
        page.getByRole("banner").getByText("완주 교사", { exact: true }),
      ).toHaveCount(0);
      await adminPage.bringToFront();
      await adminPage.reload();
      row = userRow(adminPage, "lifecycle-member");
      await row.getByRole("button", { name: "승인하기", exact: true }).click();
      await row
        .getByRole("button", { name: "승인하기 확인", exact: true })
        .click();
      await expect(
        adminPage.getByText(/요청한 승인 상태가 확정/),
      ).toBeVisible();
      await context.clearCookies();
      await context.addCookies(oldCookies);
      await page.bringToFront();
      await page.evaluate(
        (value) => localStorage.setItem("eduvibe-auth-flow-v1", value),
        oldFlow,
      );
      await page.reload();
      await expect(
        page.getByRole("banner").getByText("완주 교사", { exact: true }),
      ).toHaveCount(0);
      expect(
        query(
          "SELECT approval_status,account_version FROM members WHERE login_id_key='lifecycle-member'",
        ),
      ).toEqual([["approved", 4]]);
      expect(query(oldSessionQuery)).toEqual([[1]]);
      const reapprovedList = await (await request.get("/api/v1/apps")).json();
      expect(reapprovedList.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: PUBLIC_APP_ID,
            owner: expect.objectContaining({ id: memberId }),
          }),
        ]),
      );
      expect(
        (await (await request.get(`/api/v1/apps/${PUBLIC_APP_ID}`)).json())
          .item,
      ).toEqual(publicApp.item);
      await expect(
        page.getByRole("link", { name: /^둘째 공개 앱,/ }),
      ).toBeVisible();
    } finally {
      await adminContext.close();
    }
  });
