import { browserContextOptions } from "./helpers.js";
import { publicOrigin } from "./helpers.js";
import { expect } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import {
  approvalHeaders,
  change,
  test,
  login,
  openAdmin,
  openReset,
  ORIGINAL,
  TEMPORARY,
  submit,
} from "./password-reset-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.describe("real administrator password reset", () => {
  test.skip(!prepared, "requires isolated prepared authentication and secret");
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90000);
    await blockExternalRequests(context);
  });

  test("recent login completes row reset without reauthentication", async ({
    page,
    members,
  }) => {
    const reauthVisits = [];
    let reauthRequests = 0,
      issues = 0,
      writes = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame() && /[?&]mode=reauth/.test(frame.url()))
        reauthVisits.push(frame.url());
    });
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      if (request.url().endsWith("/auth/reauth")) reauthRequests++;
      if (request.url().endsWith("/write-operations")) issues++;
      if (request.url().endsWith("/password-reset")) writes++;
    });
    await openAdmin(page, members);
    await openReset(page, members);
    expect(issues).toBe(0);
    expect(writes).toBe(0);
    await submit(page);
    await expect(
      page.getByText(
        "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
      ),
    ).toBeVisible();
    expect(issues).toBe(1);
    expect(writes).toBe(1);
    expect(reauthVisits).toEqual([]);
    expect(reauthRequests).toBe(0);
    expect(
      query(
        `SELECT approval_status,must_change_password,account_version FROM members WHERE id='${members.member.id}'`,
      )[0],
    ).toEqual(["approved", 1, 2]);
  });

  test("reauth → row reset → old session revoked → temporary change_only → own change → full", async ({
    page,
    members,
    browser,
  }) => {
    const oldContext = await browser.newContext(browserContextOptions);
    const tempContext = await browser.newContext(browserContextOptions);
    const secondContext = await browser.newContext(browserContextOptions);
    try {
      const old = await oldContext.newPage();
      await login(old, members.member.login, ORIGINAL);
      await expect(
        old
          .getByRole("banner")
          .getByText(members.member.login, { exact: true }),
      ).toBeVisible();
      const oldHeaders = await approvalHeaders(old);
      await openAdmin(page, members);
      query(
        `UPDATE sessions SET recent_auth_until='2000-01-01T00:00:00Z' WHERE member_id='${members.admin.id}'`,
      );
      await openReset(page, members);
      const refused = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          response.url().endsWith("/write-operations"),
      );
      await submit(page);
      const refusal = await refused;
      expect(refusal.status()).toBe(403);
      expect((await refusal.json()).error.code).toBe("REAUTH_REQUIRED");
      await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
      await page.getByLabel("현재 관리자 비밀번호").fill(ORIGINAL);
      await page
        .getByRole("button", { name: "본인 확인", exact: true })
        .click();
      await expect(
        page.getByLabel("임시 비밀번호", { exact: true }),
      ).toHaveValue("");
      await submit(page);
      await expect(
        page.getByText(
          "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
        ),
      ).toBeVisible();
      expect(
        (
          await old.request.get("/api/v1/auth/me", { headers: oldHeaders })
        ).status(),
      ).toBe(401);
      expect(
        query(
          `SELECT approval_status,must_change_password,account_version FROM members WHERE id='${members.member.id}'`,
        )[0],
      ).toEqual(["approved", 1, 2]);
      const temporary = await tempContext.newPage();
      const other = await secondContext.newPage();
      for (const targetPage of [temporary, other]) {
        await login(targetPage, members.member.login, TEMPORARY);
        await expect(
          targetPage.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
        ).toBeVisible();
      }
      const headers = await approvalHeaders(temporary);
      const denied = await temporary.request.post("/api/v1/write-operations", {
        headers: { ...headers, Origin: publicOrigin },
        data: {
          kind: "app_delete",
          target_id: "00000000-0000-4000-8000-000000000001",
          expected_version: 1,
        },
      });
      expect(denied.status()).toBe(403);
      const otherHeaders = await approvalHeaders(other);
      await change(temporary);
      await expect(
        temporary
          .getByRole("banner")
          .getByText(members.member.login, { exact: true }),
      ).toBeVisible();
      expect(
        (
          await other.request.get("/api/v1/auth/me", { headers: otherHeaders })
        ).status(),
      ).toBe(401);
      const me = await temporary.request.get("/api/v1/auth/me", {
        headers: await approvalHeaders(temporary),
      });
      expect((await me.json()).session_kind).toBe("full");
      expect(
        query(
          `SELECT must_change_password,account_version FROM members WHERE id='${members.member.id}'`,
        )[0],
      ).toEqual([0, 3]);
    } finally {
      await oldContext.close();
      await tempContext.close();
      await secondContext.close();
    }
  });

  test("pending and revoked targets remain unapproved; existing temporary sessions are revoked", async ({
    page,
    members,
    browser,
  }) => {
    const temporaryContext = await browser.newContext(browserContextOptions);
    try {
      const temporary = await temporaryContext.newPage();
      await login(temporary, members.temporary.login, ORIGINAL);
      await expect(
        temporary.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
      ).toBeVisible();
      const oldHeaders = await approvalHeaders(temporary);
      await openAdmin(page, members);
      for (const kind of ["pending", "revoked", "temporary"]) {
        await openReset(page, members, kind);
        await submit(page);
        await expect(
          page.getByText(
            "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
          ),
        ).toBeVisible();
        expect(
          query(
            `SELECT approval_status,account_version FROM members WHERE id='${members[kind].id}'`,
          )[0],
        ).toEqual([kind === "temporary" ? "approved" : kind, 2]);
        await page.getByRole("button", { name: "닫기", exact: true }).click();
      }
      expect(
        (
          await temporary.request.get("/api/v1/auth/me", {
            headers: oldHeaders,
          })
        ).status(),
      ).toBe(401);
      await login(temporary, members.pending.login, TEMPORARY);
      await expect(
        temporary.getByText(/승인.*기다|승인.*대기/).first(),
      ).toBeVisible();
    } finally {
      await temporaryContext.close();
    }
  });
});
