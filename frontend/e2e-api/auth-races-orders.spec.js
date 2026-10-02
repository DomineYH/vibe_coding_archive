import { expect, test } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { proxyControl, serverControl } from "./fault-control.mjs";
import {
  API,
  admit,
  delayedExecution,
  anonymous,
  login,
  password,
  proof,
  request,
  state,
} from "./auth-race-helpers.js";

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});
test.afterEach(async () => {
  await serverControl({ action: "release" });
  await proxyControl({ action: "drop" });
});
async function submit(page) {
  await page.locator("#login-id").fill("member-a");
  await page.locator("#login-password").fill(password);
  await page
    .locator("form")
    .getByRole("button", { name: "로그인", exact: true })
    .click();
}

test("R23-03 pre-admission owner close fences the saved ID before forwarding", async ({
  page,
  context,
}) => {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-id")).toBeVisible();
  const before = (await state(page)).body;
  const { headers: oldHeaders } = await proof(page, "session");
  const survivor = await context.newPage();
  await survivor.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await expect(survivor.locator("#login-id")).toBeVisible();
  await proxyControl({
    action: "arm",
    path: `${API}/transitions`,
    stage: "before_forward",
  });
  await submit(page);
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  expect(
    query(
      `SELECT count(*) FROM auth_transitions WHERE transition_id='${before.next_transition_id}'`,
    ),
  ).toEqual([[0]]);
  await page.close();
  await survivor.reload();
  await expect(
    survivor.getByText("인증 결과를 확인할 수 없어요"),
  ).toBeVisible();
  await survivor
    .getByRole("button", { name: "결과 확인", exact: true })
    .click();
  await expect(survivor.locator("#login-id")).toBeVisible();
  await proxyControl({ action: "drop" });
  const dropped = await proxyControl({ action: "status" });
  expect(
    dropped.events.some(
      (event) =>
        event.path === `${API}/transitions` && event.stage === "forwarded",
    ),
  ).toBe(false);
  // Closing/dropping prevented ingress; a genuine later HTTP retry of the saved
  // original request must still be rejected by the survivor's revision fence.
  const late = await request(
    survivor,
    `${API}/transitions`,
    {
      flow_id: before.flow_id,
      transition_id: before.next_transition_id,
      kind: "login",
      expected_revision: before.revision,
      expected_session_generation: before.session_generation,
    },
    oldHeaders,
  );
  expect(late.status).toBe(409);
  expect(late.body.error.code).toBe("AUTH_STATE_CHANGED");
  expect(
    query(
      `SELECT count(*) FROM sessions WHERE flow_id='${before.flow_id}' AND kind='full'`,
    ),
  ).toEqual([[0]]);
  await submit(survivor);
  await expect(
    survivor.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("R23-03 worker wins before survivor settlement and keeps genuine received S", async ({
  page,
  context,
}) => {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-id")).toBeVisible();
  const survivor = await context.newPage();
  await survivor.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await expect(survivor.locator("#login-id")).toBeVisible();
  await proxyControl({
    action: "arm",
    path: `${API}/login`,
    stage: "after_headers",
  });
  await submit(page);
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  const { flow, headers } = await proof(survivor);
  const transition = query(
    `SELECT transition_id FROM auth_transitions WHERE flow_id='${flow.flow_id}' AND kind='login'`,
  )[0][0];
  const settled = await request(
    survivor,
    `${API}/transitions/${transition}/settle`,
    { flow_id: flow.flow_id, expected_revision: flow.revision },
    headers,
  );
  expect(settled.body.result.state).toBe("succeeded");
  expect(flow.session_cookie_present).toBe(true);
  await page.close();
  await proxyControl({ action: "drop" });
  await survivor.reload();
  await expect(
    survivor.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("R23-04/06 delayed old login S cannot replace newer selected S; repeat old ingress", async ({
  page,
  context,
}) => {
  await page.goto("/auth?mode=login", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#login-id")).toBeVisible();
  const survivor = await context.newPage();
  await survivor.goto("/");
  const admitted = await admit(page, "login");
  await proxyControl({
    action: "arm",
    path: `${API}/login`,
    stage: "before_headers",
  });
  await delayedExecution(page, "login", admitted.headers, {
    login_id: "member-a",
    password,
  });
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  const { flow, headers } = await proof(survivor);
  const transition = query(
    `SELECT transition_id FROM auth_transitions WHERE flow_id='${flow.flow_id}' AND kind='login'`,
  )[0][0];
  const discarded = await request(
    survivor,
    `${API}/transitions/${transition}/discard-session`,
    {
      flow_id: flow.flow_id,
      expected_revision: flow.revision,
      expected_session_generation: flow.session_generation,
    },
    headers,
  );
  expect(discarded.status).toBe(200);
  await anonymous(survivor);
  await login(survivor);
  const current = (await state(survivor)).body.session_generation;
  await proxyControl({ action: "release" });
  await expect
    .poll(async () =>
      (await proxyControl({ action: "status" })).events.some(
        (e) => e.path === `${API}/login` && e.stage === "complete",
      ),
    )
    .toBe(true);
  await proxyControl({ action: "duplicate" });
  expect(
    (
      await request(survivor, `${API}/login`, {
        login_id: "member-a",
        password,
      })
    ).status,
  ).toBe(200);
  for (let i = 0; i < 2; i++) {
    const observed = (await state(survivor)).body;
    expect(observed.session_generation).toBe(current);
    expect(observed.session_cookie_present).toBe(true);
  }
  await survivor.reload();
  await expect(
    survivor.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  expect(
    query(
      `SELECT revoked_at IS NOT NULL FROM sessions WHERE flow_id='${flow.flow_id}' AND issued_seq='${flow.session_generation}'`,
    ),
  ).toEqual([[1]]);
});

test("R23-07 late exact logout deletion preserves newer anonymous and member cookies", async ({
  page,
  context,
}) => {
  await login(page);
  const survivor = await context.newPage();
  await survivor.goto("/");
  const oldNames = (await context.cookies()).map((c) => c.name);
  const admitted = await admit(page, "logout");
  await proxyControl({
    action: "arm",
    path: `${API}/logout`,
    stage: "before_headers",
  });
  await delayedExecution(page, "logout", admitted.headers);
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  await anonymous(survivor);
  await login(survivor);
  const selected = (await state(survivor)).body.session_generation;
  const newer = (await context.cookies())
    .filter((c) => !oldNames.includes(c.name))
    .map((c) => c.name);
  expect(newer.length).toBeGreaterThan(0);
  await proxyControl({ action: "release" });
  await expect
    .poll(async () =>
      (await proxyControl({ action: "status" })).events.some(
        (e) => e.path === `${API}/logout` && e.stage === "complete",
      ),
    )
    .toBe(true);
  expect((await context.cookies()).map((c) => c.name)).toEqual(
    expect.arrayContaining(newer),
  );
  expect((await state(survivor)).body.session_generation).toBe(selected);
  await survivor.reload();
  await expect(
    survivor.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("R23-09/10 delayed old R rotation headers cannot replace newer R and repeat old ingress", async ({
  page,
  context,
}) => {
  await login(page);
  const { flow, headers } = await proof(page, "session");
  const endpoint = `${API}/flows/${flow.flow_id}/recovery-cookie/rotate`;
  await proxyControl({
    action: "arm",
    path: endpoint,
    stage: "before_headers",
  });
  await delayedExecution(
    page,
    `flows/${flow.flow_id}/recovery-cookie/rotate`,
    headers,
    {
      expected_revision: flow.revision,
      expected_session_generation: flow.session_generation,
    },
  );
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  const revision = query(
    `SELECT revision FROM auth_flows WHERE id='${flow.flow_id}'`,
  )[0][0];
  const newer = await request(
    page,
    endpoint,
    {
      expected_revision: revision,
      expected_session_generation: flow.session_generation,
    },
    headers,
  );
  expect(newer.status).toBe(201);
  const recoveryHeaders = {
    "X-EduVibe-Flow-Id": flow.flow_id,
    "X-CSRF-Token": newer.body.recovery_csrf_token,
  };
  expect(
    (
      await request(
        page,
        `${API}/flows/${flow.flow_id}/ready`,
        { expected_revision: newer.body.revision },
        recoveryHeaders,
      )
    ).status,
  ).toBe(200);
  const selectedName = (await context.cookies()).find((c) =>
    c.name.includes("recovery"),
  ).name;
  await proxyControl({ action: "release" });
  expect((await page.evaluate(() => window.delayedAuthResult)).status).toBe(
    201,
  );
  for (let i = 0; i < 2; i++)
    expect((await state(page)).body.session_cookie_present).toBe(true);
  expect((await context.cookies()).map((c) => c.name)).toContain(selectedName);
  await page.reload();
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("R23-20 total simulated proof loss with real delayed old S stays in new selected member flow", async ({
  page,
  context,
}) => {
  await page.goto("/auth?mode=login");
  await expect(page.locator("#login-id")).toBeVisible();
  const admitted = await admit(page, "login");
  await proxyControl({
    action: "arm",
    path: `${API}/login`,
    stage: "before_headers",
  });
  await delayedExecution(page, "login", admitted.headers, {
    login_id: "member-a",
    password,
  });
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  await context.clearCookies();
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    "eduvibe-auth-flow-v1",
  );
  const next = await context.newPage();
  await login(next, "한글교사");
  const selected = (await state(next)).body;
  expect(selected.flow_id).not.toBe(admitted.flow.flow_id);
  await proxyControl({ action: "release" });
  expect((await page.evaluate(() => window.delayedAuthResult)).status).toBe(
    200,
  );
  await next.goto("/apps/00000000-0000-4000-8000-000000000031");
  await expect(
    next.getByRole("heading", { name: "회원 B 비공개 자료", exact: true }),
  ).toBeVisible();
  await expect(
    next.getByRole("banner").getByText("한글 교사", { exact: true }),
  ).toBeVisible();
  expect((await state(next)).body.flow_id).toBe(selected.flow_id);
  expect(
    query(
      `SELECT state FROM auth_transitions WHERE transition_id='${admitted.permit.transition_id}'`,
    ),
  ).toEqual([["succeeded"]]);
});

test("R23-02 two tabs share member transition lock and duplicate HTTP admission is rejected", async ({
  page,
  context,
}) => {
  await page.goto("/auth?mode=login");
  await expect(page.locator("#login-id")).toBeVisible();
  const next = await context.newPage();
  await next.goto("/auth?mode=login");
  await expect(next.locator("#login-id")).toBeVisible();
  for (const tab of [page, next]) {
    await tab.locator("#login-id").fill("member-a");
    await tab.locator("#login-password").fill(password);
  }
  await serverControl({ action: "arm", stage: "hash_return" });
  await Promise.all(
    [page, next].map((tab) =>
      tab
        .locator("form")
        .evaluate((form) =>
          form.dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
        ),
    ),
  );
  await expect
    .poll(async () => (await serverControl({ action: "status" })).reached)
    .toBe(true);
  const { flow, headers } = await proof(next, "session");
  const duplicate = await request(
    next,
    `${API}/transitions`,
    {
      flow_id: flow.flow_id,
      transition_id: `${flow.flow_id}.${flow.revision}`,
      kind: "login",
      expected_revision: flow.revision,
      expected_session_generation: flow.session_generation,
    },
    headers,
  );
  expect(duplicate.status).toBe(409);
  expect(duplicate.body.error.code).toBe("AUTH_TRANSITION_PENDING");
  expect(
    query(
      `SELECT count(*) FROM auth_transitions WHERE flow_id='${flow.flow_id}' AND kind='login'`,
    ),
  ).toEqual([[1]]);
  await serverControl({ action: "release" });
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  await expect(
    next.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  expect(
    query(
      `SELECT count(*) FROM sessions WHERE flow_id='${flow.flow_id}' AND kind='full'`,
    ),
  ).toEqual([[1]]);
});

for (const first of ["ready", "abandon"]) {
  test(`R23-09 actual browser R receipt; ${first} wins over competing ready/abandon`, async ({
    page,
  }) => {
    await page.goto("/");
    const created = await request(page, `${API}/flows`, { restart_from: [] });
    expect(created.status).toBe(201);
    const id = created.body.flow_id;
    const recovery = await request(
      page,
      `${API}/flows/${id}/recovery-cookie`,
      {},
    );
    expect(recovery.status).toBe(201);
    const headers = {
      "X-EduVibe-Flow-Id": id,
      "X-CSRF-Token": recovery.body.recovery_csrf_token,
    };
    const ready = () =>
      request(
        page,
        `${API}/flows/${id}/ready`,
        { expected_revision: recovery.body.revision },
        headers,
      );
    const abandon = () => request(page, `${API}/flows/${id}/abandon`, {});
    expect((await (first === "ready" ? ready() : abandon())).status).toBe(200);
    expect((await (first === "ready" ? abandon() : ready())).status).toBe(
      first === "ready" ? 409 : 401,
    );
    expect(
      query(
        `SELECT ever_ready,revoked_at IS NOT NULL FROM auth_flows WHERE id='${id}'`,
      ),
    ).toEqual([[first === "ready" ? 1 : 0, first === "ready" ? 0 : 1]]);
    await request(
      page,
      `${API}/flows/${id}/reset`,
      {
        expected_revision: query(
          `SELECT revision FROM auth_flows WHERE id='${id}'`,
        )[0][0],
      },
      headers,
    );
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
  });
}
