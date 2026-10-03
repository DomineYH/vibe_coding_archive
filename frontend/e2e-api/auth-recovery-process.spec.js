import { expect, test } from "@playwright/test";
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
