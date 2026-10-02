import { expect } from "@playwright/test";

export const AUTH_PASSWORD = "합성 로그인 비밀번호 1234";

export async function login(page, id, password = AUTH_PASSWORD) {
  await page.goto("/auth?mode=login");
  await page.getByLabel("로그인 아이디", { exact: true }).fill(id);
  await page.getByLabel("비밀번호", { exact: true }).fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
}

export async function openAdmin(page) {
  await login(page, "approval-admin");
  await expect(
    page.getByRole("banner").getByText("승인 담당", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
}

export function userRow(page, id) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByText(`로그인 아이디: ${id}`, { exact: true }) });
}

export async function approvalHeaders(page) {
  return page.evaluate(async () => {
    const { flowId } = JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1"));
    const flow = await (
      await fetch("/api/v1/auth/flow-state", {
        headers: { "X-EduVibe-Flow-Id": flowId },
      })
    ).json();
    const headers = {
      "X-EduVibe-Flow-Id": flowId,
      "X-EduVibe-Auth-Revision": flow.revision,
      "X-EduVibe-Session-Generation": flow.session_generation,
    };
    const csrf = await (await fetch("/api/v1/auth/csrf", { headers })).json();
    return { ...headers, "X-CSRF-Token": csrf.csrf_token };
  });
}
