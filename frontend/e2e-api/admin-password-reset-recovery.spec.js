import { spawnSync } from "node:child_process";
import { unlink } from "node:fs/promises";
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
  issue,
  approvalHeaders,
} from "./password-reset-helpers.js";

test.use({ trace: "off", screenshot: "off", video: "off" });

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
  test.describe("operator rotation", () => {
    test("rotation invalidates outstanding work, retains success and expiry, and loss keeps lookup and cancel", async ({
      page,
      members,
    }) => {
      await openAdmin(page, members);
      const success = await issue(page, members.member);
      const write = async (key, version) =>
        page.request.post(
          `/api/v1/admin/users/${members.member.id}/password-reset`,
          {
            headers: {
              ...(await approvalHeaders(page)),
              Origin: "http://localhost:5174",
              "Idempotency-Key": key,
            },
            data: {
              expected_account_version: version,
              new_password: TEMPORARY,
            },
          },
        );
      expect((await write(success.key, 1)).status()).toBe(204);
      const pending = await issue(page, members.member, 2);
      const history = query(
        `SELECT state,created_at,expires_at,applied_at FROM write_operations WHERE key='${success.key}'`,
      );
      const expiry = query(
        `SELECT created_at,expires_at FROM write_operations WHERE key='${pending.key}'`,
      );
      const rotate = () => {
        const answer = spawnSync(
          "uv",
          [
            "run",
            "--frozen",
            "python",
            "-c",
            `
from app.operational_commands import rotate_reset_key
from app.settings import Settings
settings = Settings.from_environment()
assert settings.app_env == 'test'
raise SystemExit(rotate_reset_key(settings,generate=True,process_state=lambda: [{'ActiveState':'inactive','MainPID':'0'}]*2))
`,
          ],
          { cwd: "../backend", env: process.env, stdio: "pipe" },
        );
        expect(
          answer.status,
          "synthetic rotation with test-only process-state reader",
        ).toBe(0);
        expect(answer.stdout.toString().trim()).toBe("RESET_KEY_ROTATED");
      };
      const lookup = async (key) =>
        page.request.get(`/api/v1/write-operations/${key}`, {
          headers: await approvalHeaders(page),
        });
      try {
        rotate();
        expect((await (await lookup(pending.key)).json()).rejection_code).toBe(
          "OPERATION_INVALIDATED",
        );
        expect((await (await lookup(success.key)).json()).state).toBe(
          "succeeded",
        );
        expect(
          query(
            `SELECT state,created_at,expires_at,applied_at FROM write_operations WHERE key='${success.key}'`,
          ),
        ).toEqual(history);
        expect(
          query(
            `SELECT created_at,expires_at FROM write_operations WHERE key='${pending.key}'`,
          ),
        ).toEqual(expiry);
        await unlink(process.env.PASSWORD_RESET_HMAC_PATH);
        const unavailableIssue = await page.request.post(
          "/api/v1/write-operations",
          {
            headers: {
              ...(await approvalHeaders(page)),
              Origin: "http://localhost:5174",
            },
            data: {
              kind: "user_password_reset",
              target_id: members.member.id,
              expected_account_version: 2,
              new_password: TEMPORARY,
            },
          },
        );
        expect(unavailableIssue.status()).toBe(503);
        expect((await write(pending.key, 2)).status()).toBe(503);
        expect((await lookup(success.key)).status()).toBe(200);
        const cancelled = await page.request.post(
          `/api/v1/write-operations/${pending.key}/cancel`,
          {
            headers: {
              ...(await approvalHeaders(page)),
              Origin: "http://localhost:5174",
            },
          },
        );
        expect(cancelled.status()).toBe(200);
        expect((await (await lookup(pending.key)).json()).rejection_code).toBe(
          "OPERATION_INVALIDATED",
        );
      } finally {
        rotate();
      }
    });
  });
});
