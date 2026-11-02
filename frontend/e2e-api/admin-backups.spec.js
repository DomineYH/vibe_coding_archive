import { expect } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { signIn, test } from "./admin-apps-helpers.js";

const DONE = "로컬 완료 · 원격 미확인";

test.describe("administrator backups over the real API", () => {
  test.beforeEach(async ({ context }) => {
    test.setTimeout(120000);
    await blockExternalRequests(context);
  });
  // Every other run group (including the unprepared catch-all) has no backup root.
  test.skip(
    process.env.API_E2E_BACKUP_GROUP !== "1",
    "requires the backup run group",
  );
  test.skip(
    process.env.API_E2E_BACKUPS !== "1" && process.env.CI !== "true",
    "NOT RUN: requires real age and a configured backup root",
  );

  test("a configured development run completes locally and appears in the list", async ({
    page,
    owned,
  }) => {
    expect(
      process.env.API_E2E_BACKUPS,
      "real age backup run is mandatory in CI",
    ).toBe("1");
    await signIn(page, owned.admin);
    await page.goto("/admin?tab=backups");
    const panel = page.getByRole("tabpanel", { name: "백업" });
    const run = panel.getByRole("button", { name: "백업 실행", exact: true });
    const items = panel
      .getByRole("list", { name: "백업 목록" })
      .getByRole("listitem");
    await expect(run).toBeEnabled();
    const before = await items.count();

    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/admin/backups") &&
        response.request().method() === "POST",
    );
    await run.click();
    expect((await accepted).status()).toBe(202);
    // No disabled-state assertion here: a small real backup may finish before it is observed.
    await expect(panel.getByRole("status")).toContainText(DONE, {
      timeout: 60000,
    });
    await expect(items).toHaveCount(before + 1);
    await expect(items.first()).toContainText(DONE);
    await expect(panel).not.toContainText("성공");
    await expect(run).toBeEnabled();
    // The owned cleanup deletes this row with the owned administrator's audit rows.
    expect(
      query(
        `SELECT outcome FROM audit_logs WHERE action='backup_create' AND actor_id='${owned.admin.id}'`,
      ),
    ).toEqual([["local_only"]]);
  });
});
