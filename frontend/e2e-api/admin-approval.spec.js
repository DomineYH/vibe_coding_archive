import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  deferred,
  prepareViewportCapture,
  query,
  viewports,
} from "./helpers.js";
import { approvalHeaders, openAdmin, userRow } from "./approval-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";

test("ordinary runtime rejects direct administrator APIs", async ({
  request,
}) => {
  const result = await request.get("/api/v1/admin/users");
  expect(result.status()).toBe(prepared ? 422 : 503);
  expect((await result.json()).error.code).toBe(
    prepared ? "VALIDATION_ERROR" : "FEATURE_UNAVAILABLE",
  );
});

if (prepared)
  test.describe("current administrator approval over real HTTP", () => {
    test.beforeEach(async ({ context }) => {
      await blockExternalRequests(context);
    });

    test("real paging and aggregate stats; reset enabled; list error preserves explicit retry", async ({
      page,
    }) => {
      await openAdmin(page);
      expect(await page.getByRole("listitem").count()).toBe(24);
      await expect(
        page.getByRole("button", { name: "임시 비밀번호 설정" }).first(),
      ).toBeEnabled();
      await expect(
        page.getByRole("button", { name: "삭제", exact: true }).first(),
      ).toBeDisabled();
      await expect(
        page.getByRole("tab", { name: "Health Monitor" }),
      ).toBeDisabled();
      await page.getByRole("button", { name: /추가 회원 불러오기/ }).click();
      await expect
        .poll(() => page.getByRole("listitem").count())
        .toBeGreaterThan(24);
      const headers = await approvalHeaders(page);
      const result = await page.request.get("/api/v1/admin/users?limit=1", {
        headers,
      });
      expect(result.status()).toBe(200);
      const body = await result.json();
      expect(body.stats.total_users).toBe(
        query("SELECT count(*) FROM members")[0][0],
      );
      expect(body.stats.healthy_apps).toBe(0);
      expect(body.stats.next_health_expiry_at).toBeNull();
      const healthIds =
        "'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'";
      try {
        query(
          `UPDATE health_results SET state=CASE WHEN app_id LIKE '%003' THEN 'http_error' ELSE 'healthy' END,checked_at='2000-01-01T00:00:00.000000Z',fresh_until=CASE WHEN app_id LIKE '%002' THEN '2000-01-02T00:00:00.000000Z' WHEN app_id LIKE '%003' THEN '2998-01-01T00:00:00.000000Z' ELSE '2999-01-01T00:00:00.000000Z' END WHERE app_id IN (${healthIds})`,
        );
        const mixed = await page.request.get("/api/v1/admin/users?limit=1", {
          headers,
        });
        expect(mixed.status()).toBe(200);
        const { stats } = await mixed.json();
        expect(stats.healthy_apps).toBe(1);
        expect(stats.next_health_expiry_at).toBe("2999-01-01T00:00:00.000000Z");
      } finally {
        query(
          `UPDATE health_results SET state='unchecked',checked_at=NULL,fresh_until=NULL WHERE app_id IN (${healthIds})`,
        );
      }
      for (const user of body.items)
        expect(Object.keys(user)).not.toEqual(
          expect.arrayContaining(["email", "phone", "password_hash"]),
        );
      // Synthetic unavailable response is only error-UI evidence.
      await page.route("**/api/v1/admin/users?*", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "목록을 읽을 수 없어요.",
              request_id: null,
            },
          }),
        }),
      );
      await page.reload();
      await expect(
        page.getByText("사용자 목록과 통계를 불러오지 못했어요."),
      ).toBeVisible();
      await page.unroute("**/api/v1/admin/users?*");
      await page
        .getByRole("button", { name: "다시 시도", exact: true })
        .click();
      await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    });

    test("server commit with lost reply stays unknown; original key read resolves once and cancel cannot undo", async ({
      page,
      context,
    }) => {
      await openAdmin(page);
      const row = userRow(page, "approval-00");
      await row.getByRole("button", { name: "승인 해제", exact: true }).click();
      const entered = deferred(),
        release = deferred();
      let key,
        writes = 0;
      const before = await context.cookies();
      await page.route("**/api/v1/admin/users/*/approval", async (route) => {
        writes++;
        const req = route.request();
        const headers = await req.allHeaders();
        key = headers["idempotency-key"];
        for (const name of ["host", "content-length", "connection"])
          delete headers[name];
        const result = await fetch(req.url(), {
          method: "PATCH",
          headers,
          body: req.postData(),
        });
        expect(result.status).toBe(200);
        await result.arrayBuffer();
        entered.resolve();
        await release.promise;
        await route.abort("failed");
      });
      await row
        .getByRole("button", { name: "승인 해제 확인", exact: true })
        .click();
      await entered.promise;
      expect(
        query(
          "SELECT approval_status,account_version FROM members WHERE login_id_key='approval-00'",
        ),
      ).toEqual([["revoked", 2]]);
      expect(
        query(
          `SELECT state,result_account_version FROM write_operations WHERE key='${key}'`,
        ),
      ).toEqual([["succeeded", 2]]);
      await expect(
        row.getByRole("button", { name: "결과 확인", exact: true }),
      ).toBeDisabled();
      release.resolve();
      await expect(
        row.getByText(/처리가 끝났을 수 있지만 응답이 확정되지/),
      ).toBeVisible();
      expect(writes).toBe(1);
      expect(await context.cookies()).toEqual(before);
      await page.unroute("**/api/v1/admin/users/*/approval");
      await row.getByRole("button", { name: "결과 확인", exact: true }).click();
      await expect(row.getByText(/요청한 승인 상태가 확정/)).toBeVisible();
      const headers = await approvalHeaders(page);
      const cancel = await page.request.post(
        `/api/v1/write-operations/${key}/cancel`,
        { headers: { ...headers, Origin: "http://localhost:5174" } },
      );
      expect(cancel.status()).toBe(200);
      expect((await cancel.json()).state).toBe("succeeded");
      expect(
        query(
          "SELECT account_version FROM members WHERE login_id_key='approval-00'",
        ),
      ).toEqual([[2]]);
    });

    test("unreceived execution supports explicit cancellation without guessing a success", async ({
      page,
    }) => {
      await openAdmin(page);
      const row = userRow(page, "approval-01");
      await row.getByRole("button", { name: "승인 해제", exact: true }).click();
      await page.route("**/api/v1/admin/users/*/approval", (route) =>
        route.abort("failed"),
      );
      await row
        .getByRole("button", { name: "승인 해제 확인", exact: true })
        .click();
      await expect(row.getByText(/응답이 확정되지/)).toBeVisible();
      await row
        .getByRole("button", { name: "승인 요청 취소", exact: true })
        .click();
      await expect(
        row.getByText("승인 요청을 취소했어요.", { exact: true }),
      ).toBeVisible();
      expect(
        query(
          "SELECT approval_status,account_version FROM members WHERE login_id_key='approval-01'",
        ),
      ).toEqual([["approved", 1]]);
      expect(
        query(
          "SELECT state,failure_code FROM write_operations WHERE target_id='00000000-0000-4000-8000-000000000201'",
        ),
      ).toEqual([["rejected", "OPERATION_CANCELLED"]]);
    });

    for (const viewport of viewports)
      test(`administrator approval cards at ${viewport.width}x${viewport.height}`, async ({
        page,
      }) => {
        await page.clock.setFixedTime(new Date("2026-10-01T00:00:00Z"));
        await page.setViewportSize(viewport);
        await openAdmin(page);
        const row = userRow(page, "approval-02");
        await expect(
          page.getByRole("tab", { name: "사용자 관리" }),
        ).toHaveAttribute("aria-selected", "true");
        await row
          .getByRole("button", { name: "승인 해제", exact: true })
          .focus();
        await expect(
          row.getByRole("button", { name: "승인 해제", exact: true }),
        ).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(
          row.getByRole("region", { name: /회원 승인 확인/ }),
        ).toBeVisible();
        for (const [state, action] of [
          ["confirmation", null],
          ["unknown", "submit"],
          ["cancelled", "cancel"],
        ]) {
          if (action === "submit") {
            await page.route("**/api/v1/admin/users/*/approval", (route) =>
              route.abort("failed"),
            );
            await row
              .getByRole("button", { name: "승인 해제 확인", exact: true })
              .click();
            await expect(row.getByText(/응답이 확정되지/)).toBeVisible();
          }
          if (action === "cancel") {
            await row
              .getByRole("button", { name: "승인 요청 취소", exact: true })
              .click();
            await expect(
              row.getByText("승인 요청을 취소했어요.", { exact: true }),
            ).toBeVisible();
          }
          await prepareViewportCapture(page, viewport);
          await page.screenshot({
            path: test.info().outputPath(`${state}.png`),
            animations: "disabled",
          });
        }
      });
  });
