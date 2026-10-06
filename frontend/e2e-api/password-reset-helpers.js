import { expect, test as base } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { approvalHeaders, login, userRow } from "./approval-helpers.js";

export { approvalHeaders, login, userRow };
export const ORIGINAL = "Synthetic original password 167!";
export const TEMPORARY = "  Synthetic temporary é password 167!  ";
export const FINAL = "Synthetic final own password 167!";

function fixtures() {
  const result = spawnSync(
    "uv",
    ["run", "--frozen", "python", "-m", "tests.password_reset_fixtures"],
    {
      cwd: "../backend",
      env: process.env,
      input: JSON.stringify([ORIGINAL, `reset-${randomUUID().slice(0, 8)}`]),
      encoding: "utf8",
    },
  );
  expect(result.status, "isolated reset fixture creation").toBe(0);
  return JSON.parse(result.stdout);
}

// Each case owns its browser flow and database rows, including failed cases.
export const test = base.extend({
  members: async ({ context }, runTest) => {
    const members = fixtures();
    try {
      await runTest(members);
    } finally {
      await context.close();
      const cleanup = spawnSync(
        "uv",
        [
          "run",
          "--frozen",
          "python",
          "-c",
          `import json, os, sqlite3, sys
ids = json.load(sys.stdin)
marks = ','.join('?' for _ in ids)
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    db.execute('PRAGMA foreign_keys=ON')
    flows = [row[0] for row in db.execute(f'SELECT DISTINCT flow_id FROM sessions WHERE member_id IN ({marks})', ids)]
    for flow in flows:
        for table in ('auth_transitions', 'recovery_credentials', 'auth_retired_credentials', 'sessions'):
            db.execute(f'DELETE FROM {table} WHERE flow_id=?', (flow,))
        db.execute('DELETE FROM auth_flows WHERE id=?', (flow,))
    db.execute(f'DELETE FROM write_operations WHERE actor_id IN ({marks}) OR target_id IN ({marks})', ids + ids)
    db.execute(f'DELETE FROM audit_logs WHERE actor_id IN ({marks}) OR target_id IN ({marks})', ids + ids)
    db.execute(f'DELETE FROM members WHERE id IN ({marks})', ids)
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
`,
        ],
        {
          cwd: "../backend",
          env: process.env,
          input: JSON.stringify(
            Object.values(members).map((member) => member.id),
          ),
          encoding: "utf8",
        },
      );
      expect(cleanup.status, "isolated reset fixture cleanup").toBe(0);
    }
  },
});

export async function openAdmin(page, members) {
  await login(page, members.admin.login, ORIGINAL);
  await expect(
    page.getByRole("banner").getByText(members.admin.login, { exact: true }),
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
}

export async function findRow(page, loginId) {
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
  const row = userRow(page, loginId);
  for (let attempt = 0; attempt < 10 && (await row.count()) === 0; attempt++) {
    const more = page.getByRole("button", { name: /추가 회원 불러오기/ });
    await expect(more).toBeVisible();
    const count = await page.getByRole("listitem").count();
    await more.click();
    await expect
      .poll(() => page.getByRole("listitem").count())
      .toBeGreaterThan(count);
  }
  await expect(row).toBeVisible();
  return row;
}

export async function openReset(page, members, kind = "member") {
  const row = await findRow(page, members[kind].login);
  await row
    .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
    .click();
  await page.getByLabel("현재 관리자 비밀번호").fill(ORIGINAL);
  await page.getByRole("button", { name: "본인 확인", exact: true }).click();
  await findRow(page, members[kind].login);
  await expect(
    page.getByRole("heading", { name: /임시 비밀번호 초기화 확인/ }),
  ).toBeVisible();
  await expect(page.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
    "",
  );
}

export async function submit(page, password = TEMPORARY, retry = false) {
  await page.getByLabel("임시 비밀번호", { exact: true }).fill(password);
  await page.getByLabel("임시 비밀번호 확인").fill(password);
  await page
    .getByRole("button", {
      name: retry ? "같은 초기화 요청 다시 제출" : "초기화 확인",
      exact: true,
    })
    .click();
}

export async function change(page) {
  await page.getByLabel("새 비밀번호 (필수)", { exact: true }).fill(FINAL);
  await page.getByLabel("새 비밀번호 확인 (필수)", { exact: true }).fill(FINAL);
  await page
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
}

export async function issue(page, member, version = 1) {
  const response = await page.request.post("/api/v1/write-operations", {
    headers: {
      ...(await approvalHeaders(page)),
      Origin: "http://localhost:5174",
    },
    data: {
      kind: "user_password_reset",
      target_id: member.id,
      expected_account_version: version,
      new_password: TEMPORARY,
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
