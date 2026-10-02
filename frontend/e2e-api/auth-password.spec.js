import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  blockExternalRequests,
  prepareViewportCapture,
  query,
  viewports,
} from "./helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const TEMPORARY = "합성 로그인 비밀번호 1234";
const PASSWORD = "  새 본인 비밀번호 보존 AbC 1234  ";

function adminCli(command, loginId) {
  const script = `import json, os, sys
from tests.admin_cli import run_admin_cli
from tests.support import AUTH_PASSWORD
command, login = json.load(sys.stdin)
answers = [('Login ID: ', login)]
if command == 'bootstrap-admin': answers.append(('Nickname: ', '첫 관리자'))
answers += [('Temporary password: ', AUTH_PASSWORD), ('Confirm temporary password: ', AUTH_PASSWORD), ('Type YES to confirm: ', 'YES')]
status, output = run_admin_cli(command, os.environ['DATABASE_PATH'], os.environ['PASSWORD_BLOCKLIST_PATH'], answers)
assert AUTH_PASSWORD not in output
sys.exit(status)`;
  const result = spawnSync("uv", ["run", "--frozen", "python", "-c", script], {
    cwd: "../backend",
    env: process.env,
    input: JSON.stringify([command, loginId]),
    encoding: "utf8",
  });
  expect(result.status, "real administrator CLI completed").toBe(0);
}

async function login(page, id, password = TEMPORARY) {
  await page.goto("/auth?mode=login");
  await page.getByLabel("로그인 아이디", { exact: true }).fill(id);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
}
async function change(page, password = PASSWORD, confirmation = password) {
  await page.getByLabel("새 비밀번호 (필수)", { exact: true }).fill(password);
  await page
    .getByLabel("새 비밀번호 확인 (필수)", { exact: true })
    .fill(confirmation);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
}

// Unavailable runs assert the gate instead of pretending this is authentication evidence.
test("the T01–T03 capability bundle follows the test boundary", async ({
  request,
}) => {
  const meta = await request.get("/api/v1/meta");
  const { capabilities } = await meta.json();
  for (const name of ["auth_login", "auth_logout", "auth_password_change"])
    expect(capabilities[name].enabled).toBe(prepared);
  for (const name of [
    "admin_reauth",
    "admin_password_reset",
    "admin_user_delete",
  ])
    expect(capabilities[name].enabled).toBe(false);
});

test.describe("administrator own password change over real HTTP and cookies", () => {
  test.skip(!prepared, "requires the prepared APP_ENV=test boundary");
  test.beforeEach(async ({ page }) => {
    await blockExternalRequests(page);
  });

  test("real TTY bootstrap → first own password change → full browser session", async ({
    page,
  }) => {
    // The runner bootstraps this member before synthetic fixture members exist.
    await login(page, "first-admin");
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    expect(
      (
        await page.request.get(
          "/api/v1/apps/00000000-0000-4000-8000-000000000030",
        )
      ).status(),
    ).toBe(404);
    await change(page);
    await expect(
      page.getByRole("banner").getByText("첫 관리자", { exact: true }),
    ).toBeVisible();
    await page.goto("/apps/00000000-0000-4000-8000-000000000030");
    await expect(
      page.getByRole("heading", { name: "회원 A 비공개 자료", exact: true }),
    ).toBeVisible();
    await page.goto("/admin");
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("banner").getByText("첫 관리자", { exact: true }),
    ).toBeVisible();
  });

  test("real CLI recovery → restricted login → confirmation only in browser → full cookie → refresh", async ({
    page,
    context,
  }) => {
    adminCli("recover-admin", "admin-user");
    await login(page, "admin-user");
    await expect(
      page.getByText(/변경 전용 로그인은 .*까지 유효합니다/),
    ).toBeVisible();
    await page.goto("/admin");
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    let writes = 0;
    page.on("request", (request) => {
      if (request.url().endsWith("/auth/password")) writes++;
    });
    await change(page, PASSWORD, "different synthetic confirmation");
    await expect(
      page.getByText("비밀번호 확인이 일치하지 않습니다."),
    ).toBeVisible();
    expect(writes).toBe(0);
    const pending = page.waitForRequest("**/api/v1/auth/password");
    await change(page);
    const sent = await pending;
    expect(sent.postDataJSON()).toEqual({ password: PASSWORD });
    await expect(
      page.getByRole("banner").getByText("관리 담당", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toHaveCount(0);
    const cookies = (await context.cookies()).filter((c) =>
      c.name.startsWith("eduvibe_session_"),
    );
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
      expires: -1,
    });
    await page.reload();
    await expect(
      page.getByRole("banner").getByText("관리 담당", { exact: true }),
    ).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
    );
    expect(stored).not.toMatch(/password|csrf|admin-user|관리 담당|합성/);
  });

  test("committed change with no reply preserves the password and discards only its full result", async ({
    page,
    browser,
  }) => {
    adminCli("recover-admin", "admin-user");
    await login(page, "admin-user");
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    // Send to the actual server; neither response nor Set-Cookie reaches this browser.
    let committed = false;
    let lost;
    await page.route("**/api/v1/auth/password", async (route) => {
      const request = route.request();
      const headers = await request.allHeaders();
      for (const name of ["host", "content-length", "connection"])
        delete headers[name];
      const reply = await fetch(request.url(), {
        method: "POST",
        headers,
        body: request.postData(),
      });
      expect(reply.status).toBe(200);
      lost = {
        flowId: headers["x-eduvibe-flow-id"],
        transitionId: headers["x-eduvibe-transition-id"],
        generation: reply.headers.get("x-eduvibe-session-generation"),
      };
      committed = true;
      await route.abort("failed");
    });
    await change(page);
    await expect(page.getByText("인증 결과를 확인할 수 없어요")).toBeVisible();
    expect(committed).toBe(true);
    const state = await page.request.get("/api/v1/auth/flow-state", {
      params: { transition_id: lost.transitionId },
      headers: { "X-EduVibe-Flow-Id": lost.flowId },
    });
    expect(state.status()).toBe(200);
    expect((await state.json()).requested_transition).toMatchObject({
      availability: "available",
      state: "succeeded",
      result_session_generation: lost.generation,
    });
    const sessions = (flowId) =>
      query(
        `SELECT issued_seq, revoked_at IS NOT NULL FROM sessions WHERE flow_id='${flowId}' AND kind='full' ORDER BY rowid`,
      );
    expect(sessions(lost.flowId)).toEqual([[lost.generation, 0]]);
    const other = await browser.newContext();
    await blockExternalRequests(other);
    const second = await other.newPage();
    await login(second, "admin-user", PASSWORD);
    await expect(
      second.getByRole("banner").getByText("관리 담당", { exact: true }),
    ).toBeVisible();
    const otherFlow = await second.evaluate(
      () => JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")).flowId,
    );
    const otherSessions = sessions(otherFlow);
    expect(otherSessions).toHaveLength(1);
    expect(otherSessions[0][1]).toBe(0);
    await page.unroute("**/api/v1/auth/password");
    await page.getByRole("button", { name: "받지 못한 세션 버리기" }).click();
    await expect(
      page.getByRole("link", { name: "로그인 화면으로" }),
    ).toBeVisible();
    expect(sessions(lost.flowId)).toEqual([[lost.generation, 1]]);
    expect(sessions(otherFlow)).toEqual(otherSessions);
    await page.getByRole("link", { name: "로그인 화면으로" }).click();
    await expect(page.locator("#login-id")).toBeVisible();
    await second.reload();
    await expect(
      second.getByRole("banner").getByText("관리 담당", { exact: true }),
    ).toBeVisible();
    await login(page, "admin-user", PASSWORD);
    await expect(
      page.getByRole("banner").getByText("관리 담당", { exact: true }),
    ).toBeVisible();
    await other.close();
  });

  test("own password drafts are discarded after another tab logs out and signs in again", async ({
    page,
    context,
  }) => {
    adminCli("recover-admin", "admin-user");
    await login(page, "admin-user");
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    const input = page.getByLabel("새 비밀번호 (필수)", { exact: true });
    await input.fill(PASSWORD);
    const other = await context.newPage();
    await other.goto("/auth?mode=password-change");
    await expect(
      other.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    await other.getByRole("button", { name: "로그아웃" }).click();
    await expect(
      other
        .getByRole("banner")
        .getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toHaveCount(0);
    await login(other, "admin-user");
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    await expect(input).toHaveValue("");
    await other.close();
  });

  for (const viewport of viewports) {
    test(`change-only card and field errors at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      adminCli("recover-admin", "admin-user");
      await page.clock.setFixedTime(new Date("2026-10-01T00:00:00Z"));
      await page.setViewportSize(viewport);
      await login(page, "admin-user");
      await expect(
        page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
      ).toBeVisible();
      const input = page.getByLabel("새 비밀번호 (필수)", { exact: true });
      await input.focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByLabel("새 비밀번호 확인 (필수)", { exact: true }),
      ).toBeFocused();
      await prepareViewportCapture(page, viewport);
      await page.screenshot({
        path: test.info().outputPath("change-only.png"),
        fullPage: true,
        animations: "disabled",
      });
      await change(page, TEMPORARY);
      await expect(
        page.getByText("임시 비밀번호와 다른 비밀번호를 입력해 주세요."),
      ).toBeVisible();
      await expect(input).toHaveAttribute("aria-invalid", "true");
      await expect(input).toBeFocused();
      await prepareViewportCapture(page, viewport);
      await page.screenshot({
        path: test.info().outputPath("same-password.png"),
        fullPage: true,
        animations: "disabled",
      });
      await change(page);
      await expect(
        page.getByRole("banner").getByText("관리 담당", { exact: true }),
      ).toBeVisible();
    });
  }
});
