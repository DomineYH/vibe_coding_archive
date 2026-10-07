import { expect } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { openMonitor, test } from "./admin-apps-helpers.js";

test.describe("connection checks over real API, queue and worker", () => {
  test.beforeEach(() => test.setTimeout(120000));
  test.skip(
    process.env.API_E2E_HEALTH !== "1",
    "requires the owned controlled-I/O worker",
  );

  test("anonymous inspection persists the observed result and reload creates no new job", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    const appId = owned.apps.find((app) => app.public).id;
    await page.goto(`/apps/${appId}`);
    const panel = page.locator("aside section").filter({
      has: page.getByRole("heading", { name: "연결 상태", exact: true }),
    });
    await expect(panel).toBeVisible();
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/apps/${appId}/health-checks`) &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    const admission = await response.json();
    expect(admission.disposition).toBe("created");
    await expect
      .poll(() =>
        query(
          "SELECT state,http_status FROM health_results WHERE app_id='" +
            appId +
            "'",
        ),
      )
      .toEqual([["healthy", 204]]);
    await expect(
      panel.getByText("검사 이력 없음", { exact: true }),
    ).toHaveCount(0);
    const job = admission.health.latest_job.id;
    expect(
      query("SELECT status,attempts FROM health_jobs WHERE id='" + job + "'"),
    ).toEqual([["completed", 1]]);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("검사 이력 없음", { exact: true }),
    ).toHaveCount(0);
    expect(
      query("SELECT count(*) FROM health_jobs WHERE app_id='" + appId + "'"),
    ).toEqual([[1]]);
  });
  test("administrator batch persists results and refreshes the monitor rows", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    await openMonitor(page, owned.admin);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/admin/health-check-batches") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "전체 재검사", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const admitted = await response.json();
    expect(admitted.disposition).toBe("created");
    const progress = page.getByRole("region", { name: "전체 검사 진행 상황" });
    await expect(progress).toContainText("전체 검사 완료");
    const batchId = admitted.batch.id;
    expect(
      query(
        "SELECT count(*) FROM health_batch_items WHERE batch_id='" +
          batchId +
          "' AND status<>'result_obtained'",
      ),
    ).toEqual([[0]]);
    expect(
      query(
        "SELECT count(*) FROM health_results WHERE state='healthy' AND http_status=204",
      )[0][0],
    ).toBeGreaterThan(0);
    const row = page
      .getByRole("list", { name: "전체 앱 목록" })
      .getByRole("listitem")
      .first();
    await expect(row).toContainText("정상");
    await page.reload();
    await expect(progress).toContainText("전체 검사 완료");
    expect(query("SELECT count(*) FROM health_batches")).toEqual([[1]]);
    await expect(
      page.getByText(
        "개발용 합성 시연이며 외부 사이트에 요청을 보내지 않습니다.",
        { exact: true },
      ),
    ).toHaveCount(0);
  });

  test("administrator row inspection updates in place", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    await openMonitor(page, owned.admin);
    const app = owned.apps.at(-1);
    const row = page
      .getByRole("list", { name: "전체 앱 목록" })
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", {
          name: `앱 관리: ${app.name}`,
          exact: true,
        }),
      });
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/apps/${app.id}/health-checks`) &&
        response.request().method() === "POST",
    );
    await row.getByRole("button", { name: "즉시 재검사", exact: true }).click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    await expect(row.getByRole("status")).toHaveText("검사 완료");
    expect(
      query(
        "SELECT state,http_status FROM health_results WHERE app_id='" +
          app.id +
          "'",
      ),
    ).toEqual([["healthy", 204]]);
    await expect(page).toHaveURL(/\/admin\?tab=health$/);
    await page.reload();
    await expect(row).toContainText("정상");
    expect(
      query("SELECT count(*) FROM health_jobs WHERE app_id='" + app.id + "'"),
    ).toEqual([[1]]);
  });
});
