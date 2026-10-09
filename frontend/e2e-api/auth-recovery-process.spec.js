import { publicOrigin } from "./helpers.js";
import { expect } from "@playwright/test";
import {
  test,
  PASSWORD,
  login as ownedLogin,
  approvalHeaders,
} from "./user-delete-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";
import {
  processControl,
  proxyControl,
  serverControl,
} from "./fault-control.mjs";
import { key, login, privateA, state } from "./auth-race-helpers.js";

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});
test.afterEach(async () => {
  await serverControl({ action: "release" });
  await proxyControl({ action: "drop" });
});

test("R23-25 browser jar survives real SIGKILL restart with valid S and original deadline", async ({
  page,
  context,
}) => {
  await login(page);
  await page.goto(`/apps/${privateA}`);
  await expect(
    page.getByRole("heading", { name: "회원 A 비공개 자료", exact: true }),
  ).toBeVisible();
  const before = (await state(page)).body;
  const cookies = (await context.cookies()).map((c) => c.name);
  const expiry = query(
    `SELECT expires_at,absolute_expires_at FROM sessions WHERE flow_id='${before.flow_id}' AND issued_seq='${before.session_generation}'`,
  );
  expect(await processControl({ action: "restart" })).toMatchObject({
    ok: true,
    fixtureReinjection: false,
    migrationOnRestart: false,
  });
  expect(await serverControl({ action: "readiness" })).toEqual({
    ready: true,
    reason: null,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "회원 A 비공개 자료", exact: true }),
  ).toBeVisible();
  expect((await state(page)).body.session_generation).toBe(
    before.session_generation,
  );
  expect((await context.cookies()).map((c) => c.name)).toEqual(cookies);
  const after = query(
    `SELECT expires_at,absolute_expires_at FROM sessions WHERE flow_id='${before.flow_id}' AND issued_seq='${before.session_generation}'`,
  );
  expect(after[0][1]).toBe(expiry[0][1]);
});

test("R23-26 actual browser cookies rejected after snapshot restore CLI and current-ledger replay", async ({
  page,
}) => {
  await login(page);
  const before = (await state(page)).body;
  await processControl({ action: "snapshot" });
  const pending = "00000000-0000-4000-8000-000000000101";
  query(
    `UPDATE members SET created_at='2000-01-01T00:00:00.000000Z' WHERE id='${pending}'`,
  );
  await processControl({ action: "cli", command: "sweep-pending" });
  expect(query(`SELECT count(*) FROM members WHERE id='${pending}'`)).toEqual([
    [0],
  ]);
  await processControl({ action: "stop" });
  await processControl({ action: "restore" });
  await processControl({ action: "start" });
  expect(query(`SELECT count(*) FROM members WHERE id='${pending}'`)).toEqual([
    [0],
  ]);
  expect(
    query(
      `SELECT revoked_at IS NOT NULL FROM auth_flows WHERE id='${before.flow_id}'`,
    ),
  ).toEqual([[1]]);
  await page.goto(`/apps/${privateA}`);
  await expect(
    page.getByRole("heading", { name: "회원 A 비공개 자료", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toHaveCount(0);
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /^둘째 공개 앱,/ }),
  ).toBeVisible();
  expect(
    (await page.request.get("http://127.0.0.1:8000/readyz")).status(),
  ).toBe(200);
  expect(
    await page.evaluate((key) => Boolean(localStorage.getItem(key)), key),
  ).toBe(true);
});

function requireAge() {
  test.skip(
    process.env.API_E2E_AGE_AVAILABLE !== "1" && process.env.CI !== "true",
    "NOT RUN: encrypted restore requires real age and age-keygen",
  );
  expect(process.env.API_E2E_AGE_AVAILABLE, "real age is mandatory in CI").toBe(
    "1",
  );
}

async function assertMaintenance(page, ids) {
  for (const path of [
    "/",
    ...ids.flatMap((id) => [`/apps/${id}`, `/apps/${id}/edit`]),
    "/admin",
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole("banner").getByText("승인 회원", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: /del161-.*-app-[01]|회원 A 비공개 자료/,
      }),
    ).toHaveCount(0);
  }
  for (const endpoint of [
    "apps",
    "meta",
    "admin/users",
    "auth/me",
    ...ids.map((id) => `apps/${id}`),
  ]) {
    const response = await page.request.get(`/api/v1/${endpoint}`);
    expect(response.status()).toBe(503);
    expect((await response.json()).error.code).toBe("SERVICE_UNAVAILABLE");
  }
  expect(
    (await page.request.post("/api/v1/auth/login", { data: {} })).status(),
  ).toBe(503);
  expect(
    (await page.request.get("http://127.0.0.1:8000/readyz")).status(),
  ).toBe(503);
}

test("encrypted restore keeps old browser cookies and current authority blocked", async ({
  page,
  context,
  owned,
}) => {
  test.setTimeout(90000);
  requireAge();
  const adminContext = await owned.newContext();
  const adminPage = await adminContext.newPage();
  await blockExternalRequests(adminContext);
  await ownedLogin(page, owned.member.login, PASSWORD);
  await expect(
    page.getByRole("banner").getByText(owned.member.login, { exact: true }),
  ).toBeVisible();
  await ownedLogin(adminPage, owned.admin.login, PASSWORD);
  await expect(
    adminPage.getByRole("banner").getByText(owned.admin.login, { exact: true }),
  ).toBeVisible();
  const cookies = await context.cookies();
  const storage = await page.evaluate((key) => localStorage.getItem(key), key);
  const ownerHeaders = {
    ...(await approvalHeaders(page)),
    Origin: publicOrigin,
  };
  const adminHeaders = {
    ...(await approvalHeaders(adminPage)),
    Origin: publicOrigin,
  };
  try {
    await processControl({ action: "encrypted-backup" });
    const appKey = await page.request.post("/api/v1/write-operations", {
      headers: ownerHeaders,
      data: {
        kind: "app_delete",
        target_id: owned.apps[0],
        expected_version: 1,
      },
    });
    expect(appKey.status()).toBe(201);
    expect(
      (
        await page.request.delete(`/api/v1/apps/${owned.apps[0]}`, {
          headers: {
            ...ownerHeaders,
            "Idempotency-Key": (await appKey.json()).key,
          },
          data: { expected_version: 1 },
        })
      ).status(),
    ).toBe(204);
    const memberKey = await adminPage.request.post("/api/v1/write-operations", {
      headers: adminHeaders,
      data: {
        kind: "user_delete",
        target_id: owned.member.id,
        expected_app_count: 1,
      },
    });
    expect(memberKey.status()).toBe(201);
    expect(
      (
        await adminPage.request.delete(
          `/api/v1/admin/users/${owned.member.id}`,
          {
            headers: {
              ...adminHeaders,
              "Idempotency-Key": (await memberKey.json()).key,
            },
            data: { expected_app_count: 1 },
          },
        )
      ).status(),
    ).toBe(204);
    await processControl({ action: "stop" });
    await processControl({ action: "encrypted-restore" });
    await processControl({ action: "verify-restore" });
    expect(
      await processControl({
        action: "restore-status",
        ids: [owned.member.id, ...owned.apps],
      }),
    ).toMatchObject({
      members: 0,
      apps: 0,
      live_authority: 0,
      write_operations: 0,
    });
    await processControl({ action: "start" });
    expect(await context.cookies()).toEqual(cookies);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      storage,
    );
    await assertMaintenance(page, owned.apps);
    await assertMaintenance(adminPage, owned.apps);
  } finally {
    await processControl({ action: "normal-target" });
  }
});

test("failed encrypted restore never reopens data", async ({
  page,
  context,
  owned,
}) => {
  test.setTimeout(90000);
  requireAge();
  await ownedLogin(page, owned.member.login, PASSWORD);
  await expect(
    page.getByRole("banner").getByText(owned.member.login, { exact: true }),
  ).toBeVisible();
  const cookies = await context.cookies();
  try {
    for (const fault of ["wrong-key", "ciphertext", "ledger"]) {
      await processControl({ action: "encrypted-backup" });
      await processControl({ action: "stop" });
      await processControl({ action: "encrypted-restore", fault });
      await processControl({ action: "start" });
      expect(await context.cookies()).toEqual(cookies);
      await assertMaintenance(page, owned.apps);
      await processControl({ action: "restart" });
      await assertMaintenance(page, owned.apps);
      await processControl({ action: "normal-target" });
    }
  } finally {
    await processControl({ action: "normal-target" });
  }
});

test("migration maintenance blocks old cookies then release restart preserves archive and deletion evidence", async ({
  page,
  owned,
}) => {
  test.setTimeout(90000);
  // The delete fixture's hour window must match the detail contract's 15 minutes.
  for (const id of owned.apps)
    query(
      `UPDATE health_results SET fresh_until=strftime('%Y-%m-%dT%H:%M:%S',substr(checked_at,1,19),'+15 minutes') || substr(checked_at,20) WHERE app_id='${id}'`,
    );
  await ownedLogin(page, owned.member.login, PASSWORD);
  await expect(
    page.getByRole("banner").getByText(owned.member.login, { exact: true }),
  ).toBeVisible();
  await page.goto(`/apps/${owned.apps[1]}`);
  const headers = {
    ...(await approvalHeaders(page)),
    Origin: publicOrigin,
  };
  await expect(page.locator("main pre")).toBeVisible();
  const source = await page.locator("main pre").textContent();
  const item = await page.request.get(`/api/v1/apps/${owned.apps[1]}`, {
    headers,
  });
  expect(item.status()).toBe(200);
  const original = await item.json();
  const issued = await page.request.post("/api/v1/write-operations", {
    headers,
    data: { kind: "app_delete", target_id: owned.apps[0], expected_version: 1 },
  });
  expect(issued.status()).toBe(201);
  expect(
    (
      await page.request.delete(`/api/v1/apps/${owned.apps[0]}`, {
        headers: { ...headers, "Idempotency-Key": (await issued.json()).key },
        data: { expected_version: 1 },
      })
    ).status(),
  ).toBe(204);
  const before = await processControl({ action: "migration-status" });
  expect(before.deletionEvents).toBeGreaterThan(0);
  try {
    expect(await processControl({ action: "migration-block" })).toMatchObject({
      ok: true,
      fixtureReinjection: false,
      migrationOnRestart: false,
    });
    await processControl({ action: "restart" });
    await assertMaintenance(page, owned.apps);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /^둘째 공개 앱,/ }),
    ).toHaveCount(0);
    await expect(page.locator("main pre")).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByText(owned.member.login, { exact: true }),
    ).toHaveCount(0);
    const blocked = await processControl({ action: "migration-status" });
    expect(blocked.businessDigest).toBe(before.businessDigest);
    expect(blocked.ledgerDigest).toBe(before.ledgerDigest);
    expect(await processControl({ action: "migration-resume" })).toMatchObject({
      ok: true,
      fixtureReinjection: false,
      migrationOnRestart: false,
      releaseSwitched: true,
    });
    await page.goto(`/apps/${owned.apps[1]}`);
    await expect(
      page.getByRole("heading", { name: original.item.name, exact: true }),
    ).toBeVisible();
    expect(await page.locator("main pre").textContent()).toBe(source);
    const after = await processControl({ action: "migration-status" });
    expect(after.businessDigest).toBe(before.businessDigest);
    expect(after.ledgerDigest).toBe(before.ledgerDigest);
    expect(after.deletionEvents).toBe(before.deletionEvents);
    expect(
      (
        await page.request.get(`/api/v1/apps/${owned.apps[1]}`, { headers })
      ).status(),
    ).toBe(200);
    expect(
      (
        await (
          await page.request.get(`/api/v1/apps/${owned.apps[1]}`, { headers })
        ).json()
      ).item,
    ).toEqual(original.item);
    expect(
      (
        await page.request.get(`/api/v1/apps/${owned.apps[0]}`, { headers })
      ).status(),
    ).toBe(404);
    expect(
      (await page.request.get("http://127.0.0.1:8000/readyz")).status(),
    ).toBe(200);
  } finally {
    await processControl({ action: "migration-resume" });
  }
});
