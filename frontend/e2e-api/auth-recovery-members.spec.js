import { expect, test } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { proxyControl } from "./fault-control.mjs";
import {
  API,
  key,
  login,
  privateA,
  proof,
  request,
  state,
} from "./auth-race-helpers.js";

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});
test.afterEach(async () => {
  await proxyControl({ action: "drop" });
});

for (const loss of ["R", "ID", "all", "S"]) {
  test(`R23-17/18/20/23 full member simulated ${loss} loss never restores old private material`, async ({
    page,
    context,
  }) => {
    await login(page);
    await page.goto(`/apps/${privateA}`);
    await expect(
      page.getByRole("heading", { name: "회원 A 비공개 자료", exact: true }),
    ).toBeVisible();
    const original = (await state(page)).body;
    const before = await context.cookies();
    const expiry = await request(page, `${API}/csrf`, undefined, {
      "X-EduVibe-Flow-Id": original.flow_id,
    });
    if (loss === "R") await context.clearCookies({ name: /eduvibe_recovery_/ });
    if (loss === "S") await context.clearCookies({ name: /eduvibe_session_/ });
    if (loss === "ID" || loss === "all")
      await page.evaluate((key) => localStorage.removeItem(key), key);
    if (loss === "all") await context.clearCookies();
    if (loss === "R") await page.goto("/auth?mode=login");
    else await page.reload();
    if (loss === "R") {
      await expect(
        page.getByRole("banner").getByText("승인 회원", { exact: true }),
      ).toBeVisible();
      expect((await state(page)).body.session_generation).toBe(
        original.session_generation,
      );
      expect(
        (await context.cookies()).find((c) => c.name.includes("recovery")).name,
      ).not.toBe(before.find((c) => c.name.includes("recovery")).name);
      expect(
        (
          await request(page, `${API}/csrf`, undefined, {
            "X-EduVibe-Flow-Id": original.flow_id,
          })
        ).body.expires_at,
      ).toBe(expiry.body.expires_at);
    } else {
      await expect(
        page.getByRole("heading", { name: "회원 A 비공개 자료", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("banner").getByText("승인 회원", { exact: true }),
      ).toHaveCount(0);
      if (loss === "ID") {
        await page.goto("/auth?mode=login");
        await expect(
          page.getByRole("button", { name: "브라우저 인증 초기화" }),
        ).toBeVisible();
        const targets = await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).resetTargets,
          key,
        );
        expect(targets.map((t) => t.flowId)).toEqual([original.flow_id]);
        expect(
          query(
            `SELECT revoked_at IS NOT NULL FROM auth_flows WHERE id='${original.flow_id}'`,
          ),
        ).toEqual([[0]]);
        await page
          .getByRole("button", { name: "브라우저 인증 초기화" })
          .click();
        await expect(page.locator("#login-id")).toBeVisible();
        expect(
          query(
            `SELECT revoked_at IS NOT NULL FROM auth_flows WHERE id='${original.flow_id}'`,
          ),
        ).toEqual([[1]]);
      }
      if (loss === "all") {
        await page.goto("/auth?mode=login");
        await expect(page.locator("#login-id")).toBeVisible();
        expect((await state(page)).body.flow_id).not.toBe(original.flow_id);
        expect(
          query(
            `SELECT revoked_at IS NOT NULL FROM auth_flows WHERE id='${original.flow_id}'`,
          ),
        ).toEqual([[0]]);
      }
      if (loss === "S") {
        expect((await state(page)).body).toMatchObject({
          session_generation: original.session_generation,
          session_cookie_present: false,
        });
        await page.goto("/auth?mode=login");
        await expect(
          page.getByText("인증 결과를 확인할 수 없어요"),
        ).toBeVisible();
      }
    }
  });
}

test("R23-21 unavailable execution_blocked false and true require explicit settlement, not failure", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  await expect(page.locator("#login-id")).toBeVisible();
  const { flow, headers } = await proof(page);
  const before = (await state(page, flow.next_transition_id)).body
    .requested_transition;
  expect(before).toMatchObject({
    availability: "unavailable",
    execution_blocked: false,
    state: null,
  });
  const settled = await request(
    page,
    `${API}/transitions/${flow.next_transition_id}/settle`,
    { flow_id: flow.flow_id, expected_revision: flow.revision },
    headers,
  );
  expect(settled.body.result).toMatchObject({
    availability: "unavailable",
    execution_blocked: true,
    state: null,
  });
  const late = await request(
    page,
    `${API}/transitions`,
    {
      flow_id: flow.flow_id,
      transition_id: flow.next_transition_id,
      kind: "login",
      expected_revision: flow.revision,
      expected_session_generation: flow.session_generation,
    },
    (await proof(page, "session")).headers,
  );
  expect(late.status).toBe(409);
  expect(
    query(
      `SELECT count(*) FROM auth_transitions WHERE transition_id='${flow.next_transition_id}'`,
    ),
  ).toEqual([[0]]);
  await page.reload();
  await expect(page.locator("#login-id")).toBeVisible();
});

test("R23-23 real cookie budget exact cleanup, observed reduction and simulated late replenishment", async ({
  page,
  context,
}) => {
  await login(page);
  const oldR = (await context.cookies()).find((c) =>
    c.name.includes("recovery"),
  );
  const { flow, headers } = await proof(page, "session");
  const endpoint = `${API}/flows/${flow.flow_id}/recovery-cookie/rotate`;
  const rotate = (revision) =>
    request(
      page,
      endpoint,
      {
        expected_revision: revision,
        expected_session_generation: flow.session_generation,
      },
      headers,
    );
  const first = await rotate(flow.revision);
  expect(first.status).toBe(201);
  // Replay an actually issued cookie via browser API; simulated late arrival.
  const unknown = Array.from({ length: 5 }, (_, i) => ({
    name: `eduvibe_session_dev_00000000-0000-4000-8000-${String(i).padStart(12, "0")}_1`,
    value: "unknown",
    url: "http://localhost:5174",
    httpOnly: true,
    sameSite: "Lax",
  }));
  await context.addCookies([oldR, ...unknown]);
  const blocked = await rotate(first.body.revision);
  expect(blocked.status).toBe(409);
  expect(blocked.body.error.code).toBe("AUTH_COOKIE_BUDGET_EXCEEDED");
  expect((await context.cookies()).map((c) => c.name)).not.toContain(oldR.name);
  expect((await context.cookies()).map((c) => c.name)).toEqual(
    expect.arrayContaining(unknown.map((c) => c.name)),
  );
  await context.addCookies([oldR]);
  expect((await rotate(first.body.revision)).status).toBe(409);
  const allowed = await rotate(first.body.revision);
  expect(allowed.status).toBe(201);
  expect(
    query(
      `SELECT current_recovery_seq FROM auth_flows WHERE id='${flow.flow_id}'`,
    )[0][0],
  ).not.toBe(oldR.name.split("_").at(-1));
  await context.clearCookies({ name: /00000000-0000-4000-8000-/ });
  await page.reload();
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("R23-19 member-origin multiple target reset retains exact targets after real response loss", async ({
  page,
  context,
  browser,
}) => {
  await login(page);
  const other = await browser.newContext();
  try {
    await blockExternalRequests(other);
    const second = await other.newPage();
    await second.goto("http://localhost:5174/auth?mode=login");
    await login(second);
    // Explicit simulated profile merge, real issued cookies only; not natural device behavior.
    await context.addCookies(await other.cookies());
  } finally {
    await other.close();
  }
  await page.evaluate((key) => localStorage.removeItem(key), key);
  await page.goto("/auth?mode=login");
  await expect(
    page.getByRole("button", { name: "브라우저 인증 초기화" }),
  ).toBeVisible();
  const targets = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).resetTargets,
    key,
  );
  expect(targets).toHaveLength(2);
  await proxyControl({
    action: "arm",
    path: `${API}/flows/${targets[0].flowId}/reset`,
    stage: "before_headers",
  });
  await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
  await expect
    .poll(async () => (await proxyControl({ action: "status" })).held)
    .toBe(true);
  expect(
    query(
      `SELECT revoked_at IS NOT NULL FROM auth_flows WHERE id='${targets[0].flowId}'`,
    ),
  ).toEqual([[1]]);
  await proxyControl({ action: "drop" });
  await expect(
    page.getByRole("button", { name: "브라우저 인증 초기화" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).resetTargets,
      key,
    ),
  ).toEqual(targets);
  await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
  await expect(page.locator("#login-id")).toBeVisible();
  const next = (await state(page)).body.flow_id;
  expect(targets.map((t) => t.flowId)).not.toContain(next);
  for (const target of targets)
    expect(
      query(
        `SELECT revoked_at IS NOT NULL FROM auth_flows WHERE id='${target.flowId}'`,
      ),
    ).toEqual([[1]]);
});

for (const primitive of ["StorageEvent", "ineffective AbortController"]) {
  test(`R23-24 ${primitive} unsupported path retains public HTTP reading`, async ({
    page,
  }) => {
    await page.addInitScript((primitive) => {
      if (primitive === "StorageEvent") window.StorageEvent = undefined;
      else {
        const Original = window.AbortController;
        window.AbortController = class extends Original {
          abort() {}
        };
      }
    }, primitive);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /^둘째 공개 앱,/ }),
    ).toBeVisible();
    const before = query("SELECT count(*) FROM auth_flows")[0][0];
    await page.goto("/auth?mode=login");
    await expect(
      page.getByText(/이 환경에서는 인증을 준비할 수 없어요/),
    ).toBeVisible();
    expect(query("SELECT count(*) FROM auth_flows")[0][0]).toBe(before);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /^둘째 공개 앱,/ }),
    ).toBeVisible();
  });
}
