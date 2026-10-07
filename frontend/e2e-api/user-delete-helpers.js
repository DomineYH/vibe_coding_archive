import { expect, test as base } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { approvalHeaders, login, userRow } from "./approval-helpers.js";
import { findRow } from "./password-reset-helpers.js";
export { approvalHeaders, login, userRow, findRow };
export const PASSWORD = "Synthetic account delete password 161!";

function fixture(action, value) {
  const result = spawnSync(
    "uv",
    ["run", "--frozen", "python", "-m", "tests.user_delete_fixtures"],
    {
      cwd: "../backend",
      env: process.env,
      input: JSON.stringify([action, value]),
      encoding: "utf8",
    },
  );
  expect(
    result.status,
    `isolated delete fixture ${action}: ${result.stderr}`,
  ).toBe(0);
  return JSON.parse(result.stdout);
}

export const test = base.extend({
  owned: async ({ context, browser }, provideFixture) => {
    const value = fixture("create", [
      PASSWORD,
      `del161-${randomUUID().slice(0, 8)}`,
    ]);
    const flows = new Set();
    const contexts = [context];
    const pending = new Set();
    const track = (ctx) => {
      ctx.on("request", (request) => {
        const flow = request.headers()["x-eduvibe-flow-id"];
        if (flow) flows.add(flow);
      });
      ctx.on("response", (response) => {
        if (
          response.request().method() === "POST" &&
          response.url().endsWith("/auth/flows") &&
          response.status() === 201
        ) {
          const read = response
            .json()
            .then((body) => flows.add(body.flow_id))
            .catch(() => {});
          pending.add(read);
          read.finally(() => pending.delete(read));
        }
      });
    };
    track(context);
    const owned = {
      ...value.members,
      apps: value.apps,
      async newContext() {
        const ctx = await browser.newContext();
        contexts.push(ctx);
        track(ctx);
        return ctx;
      },
    };
    try {
      await provideFixture(owned);
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
      await Promise.all(pending);
      const leftover = fixture("cleanup", {
        ...value,
        flows: [...flows],
        apps: owned.apps,
      });
      console.log("user-delete owned leftovers", JSON.stringify(leftover));
      expect(Object.values(leftover).every((count) => count === 0)).toBe(true);
    }
  },
});

export async function openAdmin(page, owned) {
  await login(page, owned.admin.login, PASSWORD);
  await expect(
    page.getByRole("banner").getByText(owned.admin.login, { exact: true }),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
}

export async function openDelete(page, owned, kind = "member") {
  const row = await findRow(page, owned[kind].login);
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByLabel("현재 관리자 비밀번호").fill(PASSWORD);
  await page.getByRole("button", { name: "본인 확인", exact: true }).click();
  await expect(page.getByRole("region", { name: /계정.*삭제/ })).toBeVisible();
  return page.getByRole("region", { name: /계정.*삭제/ });
}
