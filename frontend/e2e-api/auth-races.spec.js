import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { blockExternalRequests, query } from "./helpers.js";
import { proxyControl, serverControl } from "./fault-control.mjs";

const API = "/api/v1/auth";
const PASSWORD = "합성 로그인 비밀번호 1234";
const NEW_PASSWORD = "확정 후 유실된 새 비밀번호 AbC 1234";
const storageKey = "eduvibe-auth-flow-v1";

async function openLogin(page, member = "member-a") {
  await page.goto("/auth?mode=login");
  await page.locator("#login-id").fill(member);
  await page.locator("#login-password").fill(PASSWORD);
}

async function readFlow(page) {
  return page.evaluate(async (key) => {
    const { flowId } = JSON.parse(localStorage.getItem(key));
    const response = await fetch("/api/v1/auth/flow-state", {
      headers: { "X-EduVibe-Flow-Id": flowId },
    });
    return { status: response.status, body: await response.json() };
  }, storageKey);
}

function recoverAdmin() {
  const result = spawnSync(
    "uv",
    [
      "run",
      "--frozen",
      "python",
      "-c",
      `
import os
from tests.admin_cli import run_admin_cli
from tests.support import AUTH_PASSWORD
answers = [('Login ID: ', 'admin-user'), ('Temporary password: ', AUTH_PASSWORD), ('Confirm temporary password: ', AUTH_PASSWORD), ('Type YES to confirm: ', 'YES')]
status, output = run_admin_cli('recover-admin', os.environ['DATABASE_PATH'], os.environ['PASSWORD_BLOCKLIST_PATH'], answers)
assert AUTH_PASSWORD not in output
raise SystemExit(status)
`,
    ],
    { cwd: "../backend", env: process.env, encoding: "utf8" },
  );
  expect(result.status, "real hidden-input administrator recovery").toBe(0);
}

test.beforeEach(async ({ context }) => {
  expect(process.env.API_E2E_FAULTS).toBe("1");
  await blockExternalRequests(context);
});
test.afterEach(async () => {
  await serverControl({ action: "release" });
  await proxyControl({ action: "drop" });
});

for (const operation of ["login", "password"]) {
  for (const stage of ["before_headers", "after_headers", "mid_body"]) {
    test(`R23-04/05/08 ${operation} committed response loss at ${stage}`, async ({
      page,
      context,
    }) => {
      if (operation === "password") recoverAdmin();
      await openLogin(
        page,
        operation === "password" ? "admin-user" : "member-a",
      );
      const submit = () =>
        page
          .locator("form")
          .getByRole("button", { name: "로그인", exact: true })
          .click();
      if (operation === "password") {
        await submit();
        await expect(
          page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
        ).toBeVisible();
        await page
          .getByLabel("새 비밀번호 (필수)", { exact: true })
          .fill(NEW_PASSWORD);
        await page
          .getByLabel("새 비밀번호 확인 (필수)", { exact: true })
          .fill(NEW_PASSWORD);
      }
      const flowId = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).flowId,
        storageKey,
      );
      const before = query(
        `SELECT account_version FROM members WHERE login_id='${operation === "password" ? "admin-user" : "member-a"}'`,
      )[0][0];
      await proxyControl({ action: "arm", path: `${API}/${operation}`, stage });
      if (operation === "password")
        await page
          .getByRole("button", { name: "비밀번호 변경", exact: true })
          .click();
      else await submit();
      await expect
        .poll(async () => (await proxyControl({ action: "status" })).held)
        .toBe(true);
      const events = (await proxyControl({ action: "status" })).events;
      const upstream = events.find(
        (event) =>
          event.path === `${API}/${operation}` &&
          event.stage === "upstream_headers",
      );
      expect(upstream.status).toBe(200);
      const issued = upstream.cookies.find((cookie) => !cookie.deletion);
      expect(issued).toMatchObject({ httpOnly: true, sameSiteLax: true });
      const received = stage !== "before_headers";
      await expect
        .poll(async () =>
          (await context.cookies()).some(
            (cookie) => cookie.name === issued.name,
          ),
        )
        .toBe(received);
      const state = await readFlow(page);
      expect(state.status).toBe(200);
      expect(state.body.session_cookie_present).toBe(received);
      expect(
        query(
          `SELECT state FROM auth_transitions WHERE flow_id='${flowId}' AND kind='${operation === "password" ? "password_change" : "login"}' ORDER BY rowid DESC LIMIT 1`,
        ),
      ).toEqual([["succeeded"]]);
      expect(
        query(
          `SELECT account_version FROM members WHERE login_id='${operation === "password" ? "admin-user" : "member-a"}'`,
        )[0][0],
      ).toBe(before + (operation === "password" ? 1 : 0));
      const observed = (await proxyControl({ action: "status" })).events;
      const nextIngress = observed.findLast(
        (event) =>
          event.path === `${API}/flow-state` && event.stage === "ingress",
      );
      expect(nextIngress.cookies.includes(issued.name)).toBe(received);
      await expect(
        page
          .getByRole("banner")
          .getByText(operation === "password" ? "관리 담당" : "승인 회원", {
            exact: true,
          }),
      ).toHaveCount(0);
      await proxyControl({ action: "drop" });
      if (received) {
        // The adapter rechecks the exact stored result after loss. A received
        // S may restore identity only after that real state/CSRF/me chain.
        await expect(
          page
            .getByRole("banner")
            .getByText(operation === "password" ? "관리 담당" : "승인 회원", {
              exact: true,
            }),
        ).toBeVisible();
        const afterLoss = (
          await proxyControl({ action: "status" })
        ).events.slice(observed.length);
        expect(
          afterLoss.some(
            (event) =>
              event.path.startsWith(`${API}/flow-state`) &&
              event.stage === "forwarded",
          ),
        ).toBe(true);
        expect(
          afterLoss.some(
            (event) =>
              event.path === `${API}/me` &&
              event.stage === "upstream_headers" &&
              event.status === 200,
          ),
        ).toBe(true);
      } else {
        await expect(
          page.getByText("인증 결과를 확인할 수 없어요"),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "받지 못한 세션 버리기" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "받지 못한 세션 버리기" })
          .click();
        if (operation === "password")
          await page.getByRole("link", { name: "로그인 화면으로" }).click();
        await expect(page.locator("#login-id")).toBeVisible();
        expect(
          query(
            `SELECT revoked_at IS NOT NULL FROM sessions WHERE flow_id='${flowId}' AND issued_seq='${state.body.session_generation}'`,
          ),
        ).toEqual([[1]]);
        await page
          .locator("#login-id")
          .fill(operation === "password" ? "admin-user" : "member-a");
        await page
          .locator("#login-password")
          .fill(operation === "password" ? NEW_PASSWORD : PASSWORD);
        await submit();
        await expect(
          page
            .getByRole("banner")
            .getByText(operation === "password" ? "관리 담당" : "승인 회원", {
              exact: true,
            }),
        ).toBeVisible();
      }
      expect(
        (await proxyControl({ action: "status" })).events.filter(
          (event) =>
            event.path === `${API}/${operation}` && event.stage === "forwarded",
        ),
      ).toHaveLength(received ? 1 : operation === "login" ? 2 : 1);
    });
  }
}

for (const stage of ["before_claim", "hash_return"]) {
  test(`R23-03 owner tab closes at ${stage}; survivor fences actual login`, async ({
    page,
    context,
  }) => {
    await openLogin(page);
    const survivor = await context.newPage();
    await survivor.goto("/auth?mode=login");
    await expect(survivor.locator("#login-id")).toBeVisible();
    const { body: before } = await readFlow(page);
    await serverControl({ action: "arm", stage });
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect
      .poll(async () => (await serverControl({ action: "status" })).reached)
      .toBe(true);
    expect(
      query(
        `SELECT state FROM auth_transitions WHERE flow_id='${before.flow_id}' AND kind='login'`,
      ),
    ).toEqual([[stage === "hash_return" ? "executing" : "admitted"]]);
    await page.close();
    await survivor.reload();
    await expect(
      survivor.getByText("인증 결과를 확인할 수 없어요"),
    ).toBeVisible();
    await survivor
      .getByRole("button", { name: "결과 확인", exact: true })
      .click();
    await expect(survivor.locator("#login-id")).toBeVisible();
    await serverControl({ action: "release" });
    await expect
      .poll(() =>
        query(
          `SELECT state FROM auth_transitions WHERE flow_id='${before.flow_id}' AND kind='login'`,
        ),
      )
      .toEqual([["cancelled"]]);
    expect(
      query(
        `SELECT count(*) FROM sessions WHERE flow_id='${before.flow_id}' AND kind='full'`,
      ),
    ).toEqual([[0]]);
    await survivor.locator("#login-id").fill("member-a");
    await survivor.locator("#login-password").fill(PASSWORD);
    await survivor
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(
      survivor.getByRole("banner").getByText("승인 회원", { exact: true }),
    ).toBeVisible();
  });
}
