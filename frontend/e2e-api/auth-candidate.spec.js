import { expect, test as base } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { chmod, readFile, unlink, writeFile } from "node:fs/promises";
import {
  AUTH_PASSWORD,
  approvalHeaders,
  login,
  openAdmin,
} from "./approval-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const status = process.env.API_E2E_CANDIDATE_STATUS;
const path = process.env.AUTH_ACTIVATION_PATH;
const test = base.extend({
  isolation: [
    async ({ context }, use) => {
      const owned = {
        rates: query("SELECT * FROM rate_limit_events"),
        flows: query("SELECT id FROM auth_flows").flat(),
        members: query("SELECT id FROM members").flat(),
        apps: query("SELECT id FROM apps").flat(),
        operations: query("SELECT key FROM write_operations").flat(),
        audits: query("SELECT id FROM audit_logs").flat(),
      };
      const original = await readFile(path);
      const hmac = await readFile(process.env.PASSWORD_RESET_HMAC_PATH);
      try {
        await blockExternalRequests(context);
        await use();
      } finally {
        await context.close();
        await writeFile(path, original, { mode: 0o600 });
        await chmod(path, 0o600);
        await writeFile(process.env.PASSWORD_RESET_HMAC_PATH, hmac, {
          mode: 0o600,
        });
        const cleanup = spawnSync(
          "uv",
          [
            "run",
            "--frozen",
            "python",
            "-c",
            `
import json, os, sqlite3, sys
before = json.load(sys.stdin)
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    db.execute('PRAGMA foreign_keys=ON')
    for row in db.execute('SELECT id FROM auth_flows').fetchall():
        if row[0] not in before['flows']:
            for table in ('auth_transitions', 'recovery_credentials', 'auth_retired_credentials', 'sessions'):
                db.execute(f'DELETE FROM {table} WHERE flow_id=?', row)
            db.execute('DELETE FROM auth_flows WHERE id=?', row)
    for table, column, snapshot in [('audit_logs','id','audits'), ('write_operations','key','operations'), ('apps','id','apps'), ('members','id','members')]:
        for row in db.execute(f'SELECT {column} FROM {table}').fetchall():
            if row[0] not in before[snapshot]:
                db.execute(f'DELETE FROM {table} WHERE {column}=?', row)
    rates = {tuple(row) for row in before['rates']}
    for row in db.execute('SELECT * FROM rate_limit_events').fetchall():
        if tuple(row) not in rates:
            db.execute('DELETE FROM rate_limit_events WHERE id=?', (row[0],))
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
`,
          ],
          {
            cwd: "../backend",
            env: process.env,
            input: JSON.stringify(owned),
            encoding: "utf8",
          },
        );
        expect(
          cleanup.status,
          "candidate-owned rows and rate events cleaned",
        ).toBe(0);
      }
    },
    { auto: true },
  ],
});

async function refused(response) {
  expect(response.status()).toBe(503);
  expect((await response.json()).error.code).toBe("FEATURE_UNAVAILABLE");
}

async function meta(request) {
  return (await (await request.get("/api/v1/meta")).json()).capabilities;
}

// The runner selects separate candidate servers; ordinary default runs omit this file.
// Every selected startup result and --auth-unavailable executes a real case.
if (status)
  test("candidate startup, existing workflows, reset isolation and revocation", async ({
    page,
    request,
    browser,
  }) => {
    test.setTimeout(120000);
    const capabilities = await meta(request);
    const enabled = prepared && status === "approved";
    expect(capabilities.auth_login.enabled).toBe(enabled);
    for (const key of [
      "health_check",
      "health_batch",
      "email_collection",
      "phone_collection",
    ])
      expect(capabilities[key].enabled).toBe(false);
    if (!enabled) {
      await refused(
        await request.post("/api/v1/auth/flows", {
          headers: { Origin: "http://localhost:5174" },
          data: { restart_from: [] },
        }),
      );
      expect((await request.get("/api/v1/apps")).status()).toBe(200);
      await page.goto("/auth?mode=login");
      await expect(
        page.getByLabel("로그인 아이디", { exact: true }),
      ).toHaveCount(0);
      return;
    }

    await test.step("approved candidate accepts signup and administrator approval", async () => {
      await page.goto("/auth?mode=signup");
      await page
        .getByLabel("로그인 아이디 (필수)", { exact: true })
        .fill("candidate-signup");
      await page
        .getByLabel("비밀번호 (필수)", { exact: true })
        .fill(AUTH_PASSWORD);
      await page
        .getByLabel("비밀번호 확인 (필수)", { exact: true })
        .fill(AUTH_PASSWORD);
      await page.getByLabel("별명 (필수)", { exact: true }).fill("후보 회원");
      await page
        .getByRole("button", { name: "가입 신청하기", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
      ).toBeVisible();
    });
    const [target] = query(
      "SELECT id FROM members WHERE login_id='candidate-signup'",
    )[0];
    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await blockExternalRequests(adminContext);
    try {
      await openAdmin(admin);
      const adminHeaders = {
        ...(await approvalHeaders(admin)),
        Origin: "http://localhost:5174",
      };
      const operation = {
        kind: "user_approval",
        target_id: target,
        expected_account_version: 1,
        approved: true,
      };
      const issued = await admin.request.post("/api/v1/write-operations", {
        headers: adminHeaders,
        data: operation,
      });
      expect(issued.status()).toBe(201);
      const approved = await admin.request.patch(
        `/api/v1/admin/users/${target}/approval`,
        {
          headers: {
            ...adminHeaders,
            "Idempotency-Key": (await issued.json()).key,
          },
          data: { expected_account_version: 1, approved: true },
        },
      );
      expect(approved.status()).toBe(200);
      await login(page, "candidate-signup");
      await expect(
        page.getByRole("banner").getByText("후보 회원", { exact: true }),
      ).toBeVisible();
      const memberHeaders = {
        ...(await approvalHeaders(page)),
        Origin: "http://localhost:5174",
      };
      const catalogs = await (await request.get("/api/v1/meta")).json();
      const input = {
        name: "후보 아카이브 앱",
        url: "https://www.naver.com",
        prompt: "수업 도구",
        description: "후보 시험",
        subject: catalogs.subjects[0],
        grades: [catalogs.grades[0]],
        theme_id: catalogs.themes[0].id,
        is_public: true,
        stack_db: null,
        stack_backend: null,
        stack_frontend: null,
        stack_hosting: null,
      };
      const createKey = await page.request.post("/api/v1/write-operations", {
        headers: memberHeaders,
        data: { kind: "app_create", input },
      });
      expect(createKey.status()).toBe(201);
      const created = await page.request.post("/api/v1/apps", {
        headers: {
          ...memberHeaders,
          "Idempotency-Key": (await createKey.json()).key,
        },
        data: input,
      });
      expect(created.status()).toBe(201);
      const app = (await created.json()).item;
      await page.goto(`/apps/${app.id}`);
      await expect(
        page.getByRole("heading", { name: input.name, exact: true }),
      ).toBeVisible();

      await test.step("missing reset supply preserves auth and app/admin actions", async () => {
        expect((await meta(request)).admin_password_reset.enabled).toBe(true);
        await unlink(process.env.PASSWORD_RESET_HMAC_PATH);
        const restricted = await meta(request);
        expect(restricted.admin_password_reset.enabled).toBe(false);
        for (const key of [
          "auth_login",
          "apps_create",
          "admin_approval",
          "admin_user_delete",
        ])
          expect(restricted[key].enabled).toBe(true);
        expect(
          (
            await admin.request.get("/api/v1/admin/users", {
              headers: adminHeaders,
            })
          ).status(),
        ).toBe(200);
        const reset = await admin.request.post("/api/v1/write-operations", {
          headers: adminHeaders,
          data: {
            kind: "user_password_reset",
            target_id: target,
            expected_account_version: 2,
            new_password: "Synthetic candidate reset 1234!",
          },
        });
        expect(reset.status()).toBe(503);
        expect((await reset.json()).error.code).toBe("SERVICE_UNAVAILABLE");
      });

      await test.step("revocation closes meta, existing sessions and writes; renewed record stays latched", async () => {
        const record = JSON.parse(await readFile(path, "utf8"));
        await writeFile(path, JSON.stringify({ ...record, status: "revoked" }));
        const off = await meta(request);
        for (const key of [
          "auth_login",
          "auth_register",
          "apps_create",
          "apps_update_own",
          "apps_delete_own",
          "admin_approval",
          "admin_user_delete",
        ])
          expect(off[key]).toEqual({
            enabled: false,
            reasons: ["operational_restriction"],
          });
        await refused(
          await page.request.get("/api/v1/auth/me", { headers: memberHeaders }),
        );
        await refused(
          await page.request.post("/api/v1/write-operations", {
            headers: memberHeaders,
            data: { kind: "app_create", input },
          }),
        );
        await refused(
          await admin.request.get("/api/v1/admin/users", {
            headers: adminHeaders,
          }),
        );
        expect((await request.get("/api/v1/apps")).status()).toBe(200);
        await writeFile(path, JSON.stringify(record));
        expect((await meta(request)).auth_login.enabled).toBe(false);
      });
    } finally {
      await adminContext.close();
    }
  });
