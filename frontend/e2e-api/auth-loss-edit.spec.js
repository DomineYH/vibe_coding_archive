import { expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import {
  test as memberTest,
  login,
  ORIGINAL,
} from "./password-reset-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";

const test = memberTest.extend({
  appCleanup: [
    async ({ members, context }, use) => {
      const flows = new Set();
      const responses = [];
      const rememberFlow = (response) => {
        if (
          response.status() === 201 &&
          response.request().method() === "POST" &&
          response.url().endsWith("/auth/flows")
        )
          responses.push(
            response.json().then((body) => flows.add(body.flow_id)),
          );
      };
      context.on("response", rememberFlow);
      try {
        await use();
      } finally {
        context.off("response", rememberFlow);
        await Promise.all(responses);
        const cleanup = spawnSync(
          "uv",
          [
            "run",
            "--frozen",
            "python",
            "-c",
            `
import json, os, sqlite3, sys
owned = json.load(sys.stdin)
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    db.execute('PRAGMA foreign_keys=ON')
    for flow in owned['flows']:
        for table in ('auth_transitions', 'recovery_credentials', 'auth_retired_credentials', 'sessions'):
            db.execute(f'DELETE FROM {table} WHERE flow_id=?', (flow,))
        db.execute('DELETE FROM auth_flows WHERE id=?', (flow,))
    for member in owned['members']:
        apps = [row[0] for row in db.execute('SELECT id FROM apps WHERE owner_id=?', (member,))]
        for app in apps:
            db.execute('DELETE FROM write_operations WHERE target_id=?', (app,))
            db.execute('DELETE FROM apps WHERE id=?', (app,))
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
`,
          ],
          {
            cwd: "../backend",
            env: process.env,
            encoding: "utf8",
            input: JSON.stringify({
              flows: [...flows],
              members: Object.values(members).map((member) => member.id),
            }),
          },
        );
        expect(cleanup.status, "isolated proof-loss fixture cleanup").toBe(0);
      }
    },
    { auto: true },
  ],
});

test.skip(
  process.env.API_E2E_AUTH_BOUNDARY !== "prepared",
  "proof-loss editing requires isolated prepared authentication",
);

async function openEdit(page, member) {
  await login(page, member.login, ORIGINAL);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.goto("/apps/new");
  await page
    .getByLabel("어플리케이션 이름", { exact: true })
    .fill("232 원래 앱");
  await page
    .getByLabel("배포 URL", { exact: true })
    .fill("https://www.naver.com");
  await page
    .getByLabel("핵심 프롬프트", { exact: true })
    .fill("232 원래 프롬프트");
  await page.getByLabel("상세 설명", { exact: true }).fill("232 원래 설명");
  await page
    .getByRole("group", { name: "교과 과목" })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await page
    .getByRole("group", { name: "적용 가능 학년" })
    .getByRole("button", { name: "초3", exact: true })
    .click();
  await page
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  const id = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/apps/${id}/edit`);
  await page
    .getByLabel("어플리케이션 이름", { exact: true })
    .fill("232 숨길 초안");
  await page.getByLabel("상세 설명", { exact: true }).fill("232 보존할 설명");
  return id;
}
async function storedFlow(page) {
  return page.evaluate(
    () => JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")).flowId,
  );
}
async function recoverLink(page, id) {
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await expect(page.getByRole("form", { name: "앱 수정 양식" })).toHaveCount(0);
  const link = page.getByRole("link", { name: "로그인 및 인증 복구" });
  await expect(link).toHaveAttribute(
    "href",
    `/auth?mode=login&return_to=${encodeURIComponent(`/apps/${id}/edit`)}`,
  );
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/auth\?mode=login&return_to=/);
}

for (const loss of ["session", "all-active", "all-expired"]) {
  test(`232 ${loss} proof loss corrects header and obeys explicit recovery`, async ({
    page,
    context,
    members,
  }) => {
    await blockExternalRequests(context);
    const id = await openEdit(page, members.member);
    const flow = await storedFlow(page);
    const cookies = await context.cookies();
    const writes = [];
    let creates = 0;
    let logins = 0;
    let eligibilityReads = 0;
    page.on("response", (response) => {
      if (response.url().endsWith("/restart-eligibility")) eligibilityReads++;
    });
    page.on("request", (request) => {
      if (
        ["POST", "PATCH"].includes(request.method()) &&
        (/\/write-operations$/.test(request.url()) ||
          request.url().endsWith(`/apps/${id}`))
      )
        writes.push(request.method());
      if (request.method() === "POST" && request.url().endsWith("/auth/flows"))
        creates++;
      if (request.method() === "POST" && request.url().endsWith("/auth/login"))
        logins++;
    });
    expect(
      await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
          history: history.state,
        }),
      ),
    ).not.toContain("232 숨길 초안");
    const before = query(
      `SELECT name,description,version FROM apps WHERE id='${id}'`,
    );
    const operations = query(
      `SELECT count(*) FROM write_operations WHERE actor_id='${members.member.id}'`,
    );
    if (loss === "session")
      await context.clearCookies({ name: /eduvibe_session_/ });
    else await context.clearCookies();
    if (loss === "all-expired")
      query(
        `UPDATE auth_flows SET expires_at='2000-01-01T00:00:00Z' WHERE id='${flow}'`,
      );
    await page
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await recoverLink(page, id);
    expect(await storedFlow(page)).toBe(flow);
    expect(writes).toEqual([]);
    expect(
      query(`SELECT name,description,version FROM apps WHERE id='${id}'`),
    ).toEqual(before);
    expect(
      query(
        `SELECT count(*) FROM write_operations WHERE actor_id='${members.member.id}'`,
      ),
    ).toEqual(operations);
    expect(creates).toBe(0);
    expect(logins).toBe(0);
    if (loss === "session") {
      await expect(
        page.getByText("인증 결과를 확인할 수 없어요", { exact: true }),
      ).toBeVisible();
      // Controlled re-delivery of the real issued S; ordinary login changes identity history.
      await context.addCookies(cookies);
      await page
        .getByRole("button", { name: "결과 확인", exact: true })
        .click();
      await page.getByRole("button", { name: "편집으로 돌아가기" }).click();
      await expect(
        page.getByLabel("어플리케이션 이름", { exact: true }),
      ).toHaveValue("232 숨길 초안");
      await expect(page.getByLabel("상세 설명", { exact: true })).toHaveValue(
        "232 보존할 설명",
      );
      expect(writes).toEqual([]);
    } else {
      await expect(
        page.getByRole("button", { name: "브라우저 인증 초기화" }),
      ).toBeVisible();
      const eligibilityBeforeReset = eligibilityReads;
      await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
      if (loss === "all-active") {
        await expect
          .poll(() => eligibilityReads)
          .toBeGreaterThanOrEqual(eligibilityBeforeReset + 2);
        expect(await storedFlow(page)).toBe(flow);
        expect(creates).toBe(0);
        expect(logins).toBe(0);
      } else {
        await expect(
          page.getByLabel("로그인 아이디", { exact: true }),
        ).toBeVisible();
        const newFlow = await storedFlow(page);
        expect(newFlow).not.toBe(flow);
        expect(creates).toBe(1);
        expect(logins).toBe(0);
      }
    }
  });
}

test("232 lost committed response keeps unknown across session-proof recovery without replay", async ({
  page,
  context,
  members,
}) => {
  await blockExternalRequests(context);
  const id = await openEdit(page, members.member);
  const cookies = await context.cookies();
  const patches = [];
  const issues = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().endsWith(`/apps/${id}`))
      patches.push(request.headers()["idempotency-key"]);
    if (
      request.method() === "POST" &&
      request.url().endsWith("/write-operations")
    )
      issues.push(request.url());
  });
  await page.route(`**/api/v1/apps/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await page
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "저장 결과 확인", exact: true }),
  ).toBeVisible();
  expect(query(`SELECT version FROM apps WHERE id='${id}'`)).toEqual([[2]]);
  await context.clearCookies({ name: /eduvibe_session_/ });
  await page
    .getByRole("button", { name: "저장 결과 확인", exact: true })
    .click();
  await recoverLink(page, id);
  await expect(
    page.getByText("인증 결과를 확인할 수 없어요", { exact: true }),
  ).toBeVisible();
  await context.addCookies(cookies);
  await page.getByRole("button", { name: "결과 확인", exact: true }).click();
  await page.getByRole("button", { name: "편집으로 돌아가기" }).click();
  await expect(
    page.getByLabel("어플리케이션 이름", { exact: true }),
  ).toHaveValue("232 숨길 초안");
  await expect(
    page.getByRole("button", { name: "결과 확인 중", exact: true }),
  ).toBeDisabled();
  expect(patches).toHaveLength(1);
  expect(issues).toHaveLength(1);
  await page
    .getByRole("button", { name: "저장 결과 확인", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "232 숨길 초안", exact: true }),
  ).toBeVisible();
  expect(patches).toHaveLength(1);
  expect(query(`SELECT version FROM apps WHERE id='${id}'`)).toEqual([[2]]);
});

const loss231 =
  "로그인 상태가 바뀌어 작성 중인 내용이 저장되지 않았어요. 다시 로그인한 뒤 내용을 확인해 주세요.";
const unknown231 =
  "이전 저장 결과를 확인할 수 없어요. 자동으로 다시 저장하지 않습니다.";
for (const nextMember of ["member", "admin"]) {
  test(`231 other-tab logout discards dirty edit without writes before ${nextMember} login`, async ({
    page,
    context,
    members,
  }) => {
    await blockExternalRequests(context);
    const id = await openEdit(page, members.member);
    const before = query(
      `SELECT name,description,version FROM apps WHERE id='${id}'`,
    );
    const operations = query(
      `SELECT count(*) FROM write_operations WHERE target_id='${id}'`,
    );
    const writes = [];
    context.on("request", (request) => {
      if (
        ["POST", "PATCH"].includes(request.method()) &&
        (/\/write-operations$/.test(request.url()) ||
          request.url().endsWith(`/apps/${id}`))
      )
        writes.push(request.method());
    });
    const other = await context.newPage();
    await other.goto("/");
    await other.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.bringToFront();
    await expect(page).toHaveURL(
      `/auth?mode=login&return_to=${encodeURIComponent(`/apps/${id}/edit`)}`,
    );
    const notice = page.getByRole("status").filter({ hasText: loss231 });
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute("aria-live", "polite");
    await expect(page.getByRole("form", { name: "앱 수정 양식" })).toHaveCount(
      0,
    );
    await expect(other.getByText(loss231, { exact: true })).toHaveCount(0);
    expect(
      query(`SELECT name,description,version FROM apps WHERE id='${id}'`),
    ).toEqual(before);
    expect(
      query(`SELECT count(*) FROM write_operations WHERE target_id='${id}'`),
    ).toEqual(operations);
    expect(writes).toEqual([]);
    expect(
      await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
          history: history.state,
          url: location.href,
          dom: document.body.innerHTML,
        }),
      ),
    ).not.toContain("232 숨길 초안");
    await login(other, members[nextMember].login, ORIGINAL);
    await page.bringToFront();
    await expect(notice).toHaveCount(0);
    await page.goto(`/apps/${id}/edit`);
    await expect(
      page.getByLabel("어플리케이션 이름", { exact: true }),
    ).toHaveValue("232 원래 앱");
    await expect(page.getByText(loss231, { exact: true })).toHaveCount(0);
    expect(writes).toEqual([]);
    expect(
      query(`SELECT name,description,version FROM apps WHERE id='${id}'`),
    ).toEqual(before);
    expect(
      query(`SELECT count(*) FROM write_operations WHERE target_id='${id}'`),
    ).toEqual(operations);
    await other.close();
  });
}
test("231 other-tab logout after committed lost response keeps unknown without replay or late success", async ({
  page,
  context,
  members,
}) => {
  await blockExternalRequests(context);
  const id = await openEdit(page, members.member);
  const before = query(`SELECT version FROM apps WHERE id='${id}'`)[0][0];
  const writes = [];
  context.on("request", (request) => {
    if (
      ["POST", "PATCH"].includes(request.method()) &&
      (/\/write-operations$/.test(request.url()) ||
        request.url().endsWith(`/apps/${id}`))
    )
      writes.push(request.method());
  });
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  let committed;
  const saved = new Promise((resolve) => {
    committed = resolve;
  });
  await page.route(`**/api/v1/apps/${id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    await held;
    await route.abort("failed");
  });
  try {
    await page
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await saved;
    const other = await context.newPage();
    await other.goto("/");
    await other.getByRole("button", { name: "로그아웃", exact: true }).click();
    await page.bringToFront();
    await expect(page).toHaveURL(/\/auth\?mode=login&return_to=/);
    const notice = page.getByRole("status").filter({ hasText: unknown231 });
    await expect(notice).toHaveCount(1);
    await expect(page.getByText(loss231, { exact: true })).toHaveCount(0);
    release();
    await expect(notice).toBeVisible();
    await expect(
      page.getByText("앱을 수정했어요.", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "저장 결과 확인" }),
    ).toHaveCount(0);
    expect(writes).toEqual(["POST", "PATCH"]);
    expect(
      query(`SELECT name,description,version FROM apps WHERE id='${id}'`),
    ).toEqual([["232 숨길 초안", "232 보존할 설명", before + 1]]);
    expect(
      query(
        `SELECT count(*) FROM write_operations WHERE target_id='${id}' AND kind='app_update'`,
      ),
    ).toEqual([[1]]);
    await login(other, members.admin.login, ORIGINAL);
    await page.bringToFront();
    await expect(notice).toHaveCount(0);
    expect(writes).toEqual(["POST", "PATCH"]);
    await other.close();
  } finally {
    release();
  }
});
