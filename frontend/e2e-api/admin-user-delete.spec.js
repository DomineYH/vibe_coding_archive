import { expect } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import {
  test,
  openAdmin,
  openDelete,
  login,
  PASSWORD,
  userRow,
  approvalHeaders,
} from "./user-delete-helpers.js";
const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.describe("account deletion over real HTTP", () => {
  test.skip(!prepared, "requires isolated prepared authentication");
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90000);
    await blockExternalRequests(context);
  });
  test("inline public/private deletion cancels safely, submits once, revokes old sessions and refreshes counts", async ({
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
    await expect(userRow(page, owned.member.login)).toHaveCount(0);
    expect(issues).toBe(1);
    expect(writes).toBe(1);
    const currentHeaders = await approvalHeaders(page);
    const after = await (
      await page.request.get("/api/v1/admin/users", { headers: currentHeaders })
    ).json();
    expect(after.stats.total_users).toBe(before.stats.total_users - 1);
    expect(after.stats.total_apps).toBe(before.stats.total_apps - 2);
    expect(after.stats.healthy_apps).toBe(before.stats.healthy_apps - 2);
    expect(
      (
        await targetPage.request.get("/api/v1/auth/me", { headers: oldHeaders })
      ).status(),
    ).toBe(401);
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
      const panel = await openDelete(page, owned, kind);
      await expect(panel).toContainText("앱 0개도 함께 삭제");
      await panel
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
      await expect(panel).toContainText("삭제가 확정됐어요");
      await panel.getByRole("button", { name: "닫기", exact: true }).click();
    }
    expect(
      (
        await targetPage.request.get("/api/v1/auth/me", { headers: oldHeaders })
      ).status(),
    ).toBe(401);
  });
});
