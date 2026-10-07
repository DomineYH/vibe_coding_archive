import { approvalHeaders } from "./approval-helpers.js";
import { expect, test } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import {
  adminDetail,
  createApp,
  editForm,
  openApp,
  signIn,
  signOut,
} from "./admin-apps-manage-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.skip(
  !prepared,
  "app management requires isolated prepared authentication",
);
test.beforeEach(async ({ context }) => {
  test.setTimeout(60000);
  await blockExternalRequests(context);
});

for (const [owner, publicApp] of [
  ["approval-24", true],
  ["approval-24", false],
  ["approval-admin", true],
  ["admin-user", false],
]) {
  test(`monitor edit visibility delete refresh (${owner}, public=${publicApp})`, async ({
    page,
    browser,
  }) => {
    const original = await createApp(
      page,
      owner,
      `관리 대상 168 ${owner} ${publicApp}`,
      publicApp,
    );
    await signOut(page);
    await signIn(page, "approval-admin");
    // App operations deliberately have no account-action recent-auth requirement.
    query(
      "UPDATE sessions SET recent_auth_until=NULL WHERE member_id='00000000-0000-4000-8000-000000000110'",
    );
    const before = query("SELECT count(*) FROM apps")[0][0];
    const ownerBefore = query(
      `SELECT count(*) FROM apps WHERE owner_id='${original.owner.id}'`,
    )[0][0];
    await openApp(page, original);
    const form = await editForm(page);
    const name = `${original.name} 편집 완료`;
    await form
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
      .fill(name);
    await form.getByRole("switch", { name: "전체 공개" }).click();
    await form.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page).toHaveURL("/admin?tab=health");
    const row = page.getByRole("listitem").filter({
      has: page.getByRole("button", { name: `앱 관리: ${name}` }),
    });
    await expect(row).toContainText("버전 2");
    await expect(row).toContainText(publicApp ? "비공개" : "공개");
    await expect(
      row.getByRole("button", { name: "즉시 재검사" }),
    ).toBeDisabled();
    const edited = await adminDetail(page, original.id);
    expect(edited.owner).toEqual(original.owner);
    expect(edited.version).toBe(2);
    expect(edited.is_public).toBe(!publicApp);
    const guest = await browser.newContext();
    try {
      const response = await guest.request.get(
        `http://localhost:5174/api/v1/apps/${original.id}`,
      );
      expect(response.status()).toBe(publicApp ? 404 : 200);
    } finally {
      await guest.close();
    }
    await row.getByRole("button", { name: "앱 관리", exact: true }).click();
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const result = page.waitForResponse(
      (response) =>
        response.request().method() === "DELETE" &&
        response.url().endsWith(`/apps/${original.id}`),
    );
    await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
    expect((await result).status()).toBe(204);
    await expect(page).toHaveURL("/admin?tab=health");
    await expect(
      page.getByRole("button", { name: `앱 관리: ${name}` }),
    ).toHaveCount(0);
    await expect(
      page
        .locator("dl > div")
        .filter({ has: page.locator("dt", { hasText: "등록된 앱" }) })
        .locator("dd"),
    ).toHaveText(String(before - 1));
    const member = await page.request.get(
      `/api/v1/admin/users/${original.owner.id}`,
      {
        headers: await approvalHeaders(page),
      },
    );
    expect((await member.json()).app_count).toBe(ownerBefore - 1);
    await page.reload();
    await expect(
      page.getByRole("list", { name: "전체 앱 목록" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: `앱 관리: ${name}` }),
    ).toHaveCount(0);
    await page.goto(`/apps/${original.id}`);
    await expect(
      page.getByText("아카이브 앱을 찾을 수 없어요", { exact: true }),
    ).toBeVisible();
  });
}
