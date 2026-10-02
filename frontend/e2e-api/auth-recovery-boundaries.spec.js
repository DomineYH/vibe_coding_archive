import { expect, test } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { serverControl } from "./fault-control.mjs";
import { API, login, proof, request, state } from "./auth-race-helpers.js";

const start = "2026-10-01T00:00:00.000000Z";
const instant = (minutes, offset) =>
  offset < 0
    ? `2026-10-01T00:${String(minutes - 1).padStart(2, "0")}:59.999999Z`
    : `2026-10-01T00:${String(minutes).padStart(2, "0")}:00.${offset === 0 ? "000000" : "000001"}Z`;
test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
  await serverControl({ action: "clock", at: start });
});
test.afterEach(async () => {
  await serverControl({ action: "clock", at: null });
});
for (const kind of ["anonymous", "full", "change_only", "flow"]) {
  for (const offset of [-1, 0, 1]) {
    test(`R23-22 browser ${kind} deadline ${offset}us uses server time and conceals expired identity`, async ({
      page,
    }) => {
      if (kind === "change_only") {
        // Synthetic temporary credential for the lifetime test only; real CLI
        // creation/recovery is independently covered by auth-password.
        query(
          "UPDATE members SET must_change_password=1, temporary_password_expires_at='2026-10-02T00:00:00.000000Z',password_hash=(SELECT password_hash FROM members WHERE login_id='member-a'), account_version=account_version+1 WHERE login_id='admin-user'",
        );
        await page.goto("/auth?mode=login");
        await page.locator("#login-id").fill("admin-user");
        await page.locator("#login-password").fill("합성 로그인 비밀번호 1234");
        await page
          .locator("form")
          .getByRole("button", { name: "로그인", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
        ).toBeVisible();
      } else if (kind === "full") await login(page);
      else {
        await page.goto("/auth?mode=login");
        await expect(page.locator("#login-id")).toBeVisible();
      }
      const before = (await state(page)).body;
      if (kind === "full") {
        await serverControl({
          action: "clock",
          at: "2026-10-01T00:20:00.000000Z",
        });
        const { flow, headers } = await proof(page, "session");
        const rotated = await request(
          page,
          `${API}/flows/${flow.flow_id}/recovery-cookie/rotate`,
          {
            expected_revision: flow.revision,
            expected_session_generation: flow.session_generation,
          },
          headers,
        );
        expect(rotated.status).toBe(201);
        expect(
          (
            await request(
              page,
              `${API}/flows/${flow.flow_id}/ready`,
              { expected_revision: rotated.body.revision },
              {
                "X-EduVibe-Flow-Id": flow.flow_id,
                "X-CSRF-Token": rotated.body.recovery_csrf_token,
              },
            )
          ).status,
        ).toBe(200);
      }
      const minutes = ["anonymous", "change_only"].includes(kind) ? 15 : 30;
      await serverControl({ action: "clock", at: instant(minutes, offset) });
      const observed = await state(page);
      if (kind === "flow") expect(observed.status).toBe(offset < 0 ? 200 : 401);
      else {
        expect(observed.status).toBe(200);
        expect(observed.body.session_generation).toBe(
          offset < 0 ? before.session_generation : null,
        );
      }
      await page.reload();
      if (kind === "full" && offset < 0)
        await expect(
          page.getByRole("banner").getByText("승인 회원", { exact: true }),
        ).toBeVisible();
      else if (kind === "change_only" && offset < 0)
        await expect(
          page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
        ).toBeVisible();
      else
        await expect(
          page.getByRole("banner").getByText("승인 회원", { exact: true }),
        ).toHaveCount(0);
      if (kind === "change_only" && offset >= 0)
        await expect(
          page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
        ).toHaveCount(0);
      if (kind !== "flow" && offset >= 0)
        expect(
          query(
            `SELECT expires_at FROM sessions WHERE flow_id='${before.flow_id}' AND issued_seq='${before.session_generation}'`,
          )[0][0],
        ).toBe(
          ["anonymous", "change_only"].includes(kind)
            ? "2026-10-01T00:15:00.000000Z"
            : "2026-10-01T00:30:00.000000Z",
        );
    });
  }
}
