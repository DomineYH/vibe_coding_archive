import { expect } from "@playwright/test";
import { blockExternalRequests, deferred, query } from "./helpers.js";
import {
  test,
  openAdmin,
  openReset,
  submit,
  TEMPORARY,
  ORIGINAL,
  findRow,
} from "./password-reset-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.describe("password reset recovery over real HTTP", () => {
  test.skip(!prepared, "requires isolated prepared authentication and secret");
  test.beforeEach(async ({ context }) => {
    test.setTimeout(90000);
    await blockExternalRequests(context);
  });

  test("lost committed response resolves by original key lookup without another POST", async ({
    page,
    members,
  }) => {
    await openAdmin(page, members);
    await openReset(page, members);
    let writes = 0,
      issues = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route(
      "**/api/v1/admin/users/*/password-reset",
      async (route) => {
        writes++;
        const response = await route.fetch();
        expect(response.status()).toBe(204);
        await route.abort("failed");
      },
    );
    await submit(page);
    await expect(
      page.getByRole("button", { name: "결과 확인", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "결과 확인", exact: true }).click();
    await expect(
      page.getByText(
        "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
      ),
    ).toBeVisible();
    expect(writes).toBe(1);
    expect(issues).toBe(1);
    expect(
      await page.getByLabel("임시 비밀번호", { exact: true }).count(),
    ).toBe(0);
    const retained = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        url: location.href,
        state: history.state,
      }),
    );
    expect(retained).not.toContain(TEMPORARY);
  });

  test("unresolved lookup permits explicit same-input retry and cancel permits a new decision", async ({
    page,
    members,
  }) => {
    await openAdmin(page, members);
    await openReset(page, members);
    let writes = 0;
    await page.route("**/api/v1/admin/users/*/password-reset", (route) => {
      writes++;
      return route.abort("failed");
    });
    await submit(page);
    await expect(
      page.getByRole("button", { name: "결과 확인", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "결과 확인", exact: true }).click();
    await expect(page.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
      "",
    );
    await page.unroute("**/api/v1/admin/users/*/password-reset");
    await submit(page, TEMPORARY, true);
    await expect(
      page.getByText(
        "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
      ),
    ).toBeVisible();
    expect(writes).toBe(1);
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await openReset(page, members, "revoked");
    await page.route("**/api/v1/admin/users/*/password-reset", (route) =>
      route.abort("failed"),
    );
    await submit(page);
    await page
      .getByRole("button", { name: "초기화 요청 취소", exact: true })
      .click();
    await expect(
      page.getByText("초기화 요청 취소가 확정됐어요."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "현재 회원 확인 후 새 초기화 판단" })
      .click();
    await expect(page.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
      "",
    );
    expect(
      query(
        `SELECT account_version FROM members WHERE id='${members.revoked.id}'`,
      )[0][0],
    ).toBe(1);
    await page.unroute("**/api/v1/admin/users/*/password-reset");
    await submit(page);
    await expect(
      page.getByText(
        "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
      ),
    ).toBeVisible();
  });

  test("version conflict requires a refreshed target and explicit new decision", async ({
    page,
    members,
  }) => {
    await openAdmin(page, members);
    await openReset(page, members);
    let issues = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route(
      "**/api/v1/admin/users/*/password-reset",
      async (route) => {
        query(
          `UPDATE members SET account_version=2 WHERE id='${members.member.id}'`,
        );
        await route.continue();
      },
    );
    await submit(page);
    await expect(
      page.getByText(
        "다른 변경이 먼저 확정되어 초기화를 적용하지 않았어요. 현재 상태를 다시 확인해 주세요.",
      ),
    ).toBeVisible();
    expect(issues).toBe(1);
    await page.unroute("**/api/v1/admin/users/*/password-reset");
    await page
      .getByRole("button", { name: "현재 회원 확인 후 새 초기화 판단" })
      .click();
    await submit(page);
    await expect(
      page.getByText(
        "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
      ),
    ).toBeVisible();
    expect(issues).toBe(2);
    expect(
      query(
        `SELECT account_version FROM members WHERE id='${members.member.id}'`,
      )[0][0],
    ).toBe(3);
  });

  test("reauth preserves only the key and looks it up before reconfirming the target", async ({
    page,
    members,
  }) => {
    await openAdmin(page, members);
    await openReset(page, members);
    let writes = 0;
    await page.route("**/api/v1/admin/users/*/password-reset", (route) => {
      writes++;
      return route.abort("failed");
    });
    await submit(page);
    await page.getByRole("button", { name: "결과 확인", exact: true }).click();
    await expect(page.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
      "",
    );
    await page.unroute("**/api/v1/admin/users/*/password-reset");
    query(
      `UPDATE sessions SET recent_auth_until='2000-01-01T00:00:00.000000Z' WHERE member_id='${members.admin.id}'`,
    );
    await submit(page, TEMPORARY, true);
    await expect(page.getByLabel("현재 관리자 비밀번호")).toBeVisible();
    const retained = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
        state: history.state,
      }),
    );
    expect(retained).not.toContain(TEMPORARY);
    const reads = [];
    page.on("request", (request) => {
      if (
        request.method() === "GET" &&
        /write-operations\/|admin\/users\//.test(request.url())
      )
        reads.push(request.url());
    });
    await page.getByLabel("현재 관리자 비밀번호").fill(ORIGINAL);
    await page.getByRole("button", { name: "본인 확인", exact: true }).click();
    await findRow(page, members.member.login);
    await expect(page.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
      "",
    );
    expect(reads[0]).toContain("/write-operations/");
    expect(writes).toBe(1);
    expect(
      query(
        `SELECT account_version FROM members WHERE id='${members.member.id}'`,
      )[0][0],
    ).toBe(1);
  });

  test("expired lookup and refresh retain unknown history without issuing another key", async ({
    page,
    members,
  }) => {
    await openAdmin(page, members);
    await openReset(page, members);
    let issues = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
    });
    await page.route("**/api/v1/admin/users/*/password-reset", (route) =>
      route.abort("failed"),
    );
    await submit(page);
    await expect(
      page.getByRole("button", { name: "결과 확인", exact: true }),
    ).toBeEnabled();
    query(
      `UPDATE write_operations SET expires_at='2000-01-01T00:00:00.000000Z' WHERE target_id='${members.member.id}'`,
    );
    await page.getByRole("button", { name: "결과 확인", exact: true }).click();
    await page
      .getByRole("button", { name: "현재 회원 상태 다시 확인" })
      .click();
    await expect(
      page.getByText("작업 키가 만료되어 과거 결과를 확인할 수 없어요."),
    ).toBeVisible();
    expect(
      await page.getByLabel("임시 비밀번호", { exact: true }).count(),
    ).toBe(0);
    expect(issues).toBe(1);
  });

  test("late issuance after tab departure does not execute", async ({
    page,
    members,
  }) => {
    await openAdmin(page, members);
    await openReset(page, members);
    const entered = deferred(),
      release = deferred();
    let writes = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/password-reset")
      )
        writes++;
    });
    await page.route("**/api/v1/write-operations", async (route) => {
      const response = await route.fetch();
      entered.resolve();
      await release.promise;
      await route.fulfill({ response });
    });
    await submit(page);
    await entered.promise;
    await page
      .getByRole("link", { name: /갤러리|아카이브|EduVibe/ })
      .first()
      .click();
    release.resolve();
    await page.waitForTimeout(250);
    expect(writes).toBe(0);
    expect(
      query(
        `SELECT account_version FROM members WHERE id='${members.member.id}'`,
      )[0][0],
    ).toBe(1);
  });
});
