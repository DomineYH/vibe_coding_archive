import { expect } from "@playwright/test";

export const API = "/api/v1/auth";
export const key = "eduvibe-auth-flow-v1";
export const password = "합성 로그인 비밀번호 1234";
export const privateA = "00000000-0000-4000-8000-000000000030";
export async function request(page, path, body, headers = {}) {
  return page.evaluate(
    async ({ path, body, headers }) => {
      const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
      };
    },
    { path, body, headers },
  );
}
export async function state(page, transition) {
  const flowId = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).flowId,
    key,
  );
  return request(
    page,
    `${API}/flow-state${transition ? `?transition_id=${transition}` : ""}`,
    undefined,
    { "X-EduVibe-Flow-Id": flowId },
  );
}
export async function proof(page, kind = "recovery") {
  const { body: flow } = await state(page);
  const token = await request(
    page,
    kind === "recovery"
      ? `${API}/flows/${flow.flow_id}/recovery-csrf`
      : `${API}/csrf`,
    undefined,
    { "X-EduVibe-Flow-Id": flow.flow_id },
  );
  expect(token.status).toBe(200);
  return {
    flow,
    headers: {
      "X-EduVibe-Flow-Id": flow.flow_id,
      "X-CSRF-Token":
        kind === "recovery"
          ? token.body.recovery_csrf_token
          : token.body.csrf_token,
      ...(kind === "session"
        ? { "X-EduVibe-Session-Generation": flow.session_generation }
        : {}),
    },
  };
}
export async function login(page, id = "member-a") {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-id")).toBeVisible();
  await page.locator("#login-id").fill(id);
  await page.locator("#login-password").fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(
    page
      .getByRole("banner")
      .getByText(id === "member-a" ? "승인 회원" : "한글 교사", {
        exact: true,
      }),
  ).toBeVisible();
}
export async function anonymous(page) {
  const { flow, headers } = await proof(page);
  const admitted = await request(
    page,
    `${API}/transitions`,
    {
      flow_id: flow.flow_id,
      transition_id: flow.next_transition_id,
      kind: "anonymous_session",
      expected_revision: flow.revision,
      expected_session_generation: null,
    },
    headers,
  );
  expect(admitted.status).toBe(201);
  const result = await request(
    page,
    `${API}/anonymous-session`,
    { expected_revision: admitted.body.revision },
    {
      ...headers,
      "X-EduVibe-Auth-Revision": admitted.body.revision,
      "X-EduVibe-Transition-Id": admitted.body.transition_id,
    },
  );
  expect(result.status).toBe(201);
  return result;
}

export async function admit(page, kind) {
  const { flow, headers } = await proof(page, "session");
  const result = await request(
    page,
    `${API}/transitions`,
    {
      flow_id: flow.flow_id,
      transition_id: flow.next_transition_id,
      kind,
      expected_revision: flow.revision,
      expected_session_generation: flow.session_generation,
    },
    headers,
  );
  expect(result.status).toBe(201);
  return {
    flow,
    headers: {
      ...headers,
      "X-EduVibe-Auth-Revision": result.body.revision,
      "X-EduVibe-Transition-Id": result.body.transition_id,
    },
    permit: result.body,
  };
}
export async function delayedExecution(page, operation, headers, body) {
  await page.evaluate(
    ({ operation, headers, body }) => {
      window.delayedAuthResult = fetch(`/api/v1/auth/${operation}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
        .then(async (r) => ({
          status: r.status,
          body: r.status === 204 ? null : await r.json(),
        }))
        .catch(() => ({ transportLost: true }));
    },
    { operation, headers, body },
  );
}
