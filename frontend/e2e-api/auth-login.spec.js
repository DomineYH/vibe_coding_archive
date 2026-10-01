import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blockExternalRequests, prepareViewportCapture } from "./helpers.js";

// Real HTTP, a test-owned file SQLite and real browser cookies. The prepared
// server is only started by the API E2E runner (APP_ENV=test).
const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const backend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../backend",
);
const PASSWORD = "합성 로그인 비밀번호 1234"; // test-only fixture credential
const key = "eduvibe-auth-flow-v1";

function sql(statement) {
  const result = spawnSync(
    "uv",
    [
      "run",
      "--frozen",
      "python",
      "-c",
      "import os, sqlite3, sys; c = sqlite3.connect(os.environ['DATABASE_PATH']); c.execute(sys.argv[1]); c.commit()",
      statement,
    ],
    { cwd: backend, env: process.env, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error("test database update failed");
}

async function login(page, loginId, password = PASSWORD) {
  const form = page.locator("form");
  await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  await form.getByLabel("비밀번호", { exact: true }).fill(password);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
}

async function openLogin(page) {
  await page.goto("/auth?mode=login");
  await expect(page.locator("#login-id")).toBeVisible();
}

const authCookies = (context) =>
  context
    .cookies()
    .then((all) => all.filter((c) => c.name.startsWith("eduvibe_")));

test.skip(!prepared, "real login needs the prepared APP_ENV=test boundary");
test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
});

test("an approved member logs in, keeps the session across refresh and logs out", async ({
  page,
  context,
}) => {
  await openLogin(page);
  const before = await authCookies(context);
  expect(before.map((c) => c.name.split("_")[1]).sort()).toEqual([
    "recovery",
    "session",
  ]);
  await login(page, "member-a");
  const banner = page.getByRole("banner");
  // The header shows the nickname, never the login ID.
  await expect(banner.getByText("승인 회원", { exact: true })).toBeVisible();
  await expect(banner.getByText("member-a")).toHaveCount(0);
  const after = await authCookies(context);
  const session = after.find((c) => c.name.startsWith("eduvibe_session_"));
  expect(session.name).not.toBe(
    before.find((c) => c.name.startsWith("eduvibe_session_")).name,
  );
  expect(session).toMatchObject({
    httpOnly: true,
    sameSite: "Lax",
    expires: -1,
  });
  // Nothing secret or personal lives in browser storage.
  const stored = await page.evaluate(() =>
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  );
  expect(stored).not.toMatch(/member-a|승인 회원|csrf|password|합성/i);
  expect(
    Object.keys(
      JSON.parse(await page.evaluate((k) => localStorage.getItem(k), key)),
    ).sort(),
  ).toEqual(["flowId", "revision"]);

  await page.reload();
  await expect(banner.getByText("승인 회원", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  const final = await authCookies(context);
  expect(final.map((c) => c.name.split("_")[1])).toEqual(["recovery"]);
  const me = await page.evaluate(async (k) => {
    const { flowId } = JSON.parse(localStorage.getItem(k));
    const state = await fetch("/api/v1/auth/flow-state", {
      headers: { "X-EduVibe-Flow-Id": flowId },
    }).then((r) => r.json());
    return state.session_generation;
  }, key);
  expect(me).toBeNull();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
});

test("pending, revoked and wrong credentials are told apart on the product screen", async ({
  page,
}) => {
  await openLogin(page);
  await login(page, "pending-user", "wrong password 12345");
  await expect(
    page.getByText("로그인 아이디 또는 비밀번호를 확인해 주세요."),
  ).toBeVisible();
  await login(page, "no-such-member");
  await expect(
    page.getByText("로그인 아이디 또는 비밀번호를 확인해 주세요."),
  ).toBeVisible();
  await login(page, "pending-user");
  await expect(page.getByText("승인 대기 중인 계정입니다.")).toBeVisible();
  await login(page, "revoked-user");
  await expect(page.getByText("승인 대기 중인 계정입니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  // The failed attempts left a usable anonymous session: a correct login still works.
  await login(page, "member-a");
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("repeated failures are limited with the server's retry time", async ({
  page,
}) => {
  await openLogin(page);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await login(page, "limit-user", "wrong password 12345");
    await expect(
      page.getByText("로그인 아이디 또는 비밀번호를 확인해 주세요."),
    ).toBeVisible();
  }
  await login(page, "limit-user", PASSWORD);
  await expect(
    page.getByText(
      /로그인 시도가 너무 많아요\. .* 이후에 다시 시도해 주세요\./,
    ),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("a lost login reply stays unresolved until the user checks it, then login works", async ({
  page,
}) => {
  await openLogin(page);
  await page.route("**/api/v1/auth/login", (route) => route.abort("failed"));
  await login(page, "member-a");
  await expect(page.getByText("인증 결과를 확인할 수 없어요")).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await page.unroute("**/api/v1/auth/login");
  await page.getByRole("button", { name: "결과 확인" }).click();
  await expect(page.locator("#login-id")).toBeVisible();
  await login(page, "member-a");
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

test("an expired session is anonymous after refresh and the server refuses it", async ({
  page,
}) => {
  await openLogin(page);
  await login(page, "한글교사");
  await expect(
    page.getByRole("banner").getByText("한글 교사", { exact: true }),
  ).toBeVisible();
  // 30 minutes of inactivity, as the database sees it.
  sql(
    "UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000000Z' WHERE member_id = '00000000-0000-4000-8000-000000000104'",
  );
  await page.reload();
  await expect(
    page.getByRole("banner").getByText("한글 교사", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
});

test("logging out one device leaves the member's other device signed in", async ({
  page,
  browser,
}) => {
  await openLogin(page);
  await login(page, "admin-user");
  const header = (p) =>
    p.getByRole("banner").getByText("관리 담당", { exact: true });
  await expect(header(page)).toBeVisible();
  const other = await browser.newContext();
  await blockExternalRequests(other);
  const second = await other.newPage();
  await openLogin(second);
  await login(second, "admin-user");
  await expect(header(second)).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await second.reload();
  await expect(header(second)).toBeVisible();
  await other.close();
});

test("switching accounts requires logging out first", async ({ page }) => {
  await openLogin(page);
  await login(page, "member-a");
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  await page.goto("/auth?mode=login");
  await expect(page.locator("#login-id")).toBeVisible();
  await login(page, "한글교사");
  await expect(
    page.getByText("다른 계정으로 로그인하려면 먼저 로그아웃해 주세요."),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
});

const sizes = [
  [1440, 1000],
  [1024, 900],
  [768, 1024],
  [390, 844],
  [360, 844],
];

// product_only observations for the evidence ledger; no baseline is created or updated.
for (const [width, height] of sizes) {
  test(`login states at ${width}x${height}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-10-01T00:00:00.000Z"));
    await page.setViewportSize({ width, height });
    const shot = async (state) => {
      await prepareViewportCapture(page, { width, height });
      await page.screenshot({
        path: test.info().outputPath(`login-${state}-${width}x${height}.png`),
        // The signed-in state is the gallery; only its first viewport matters here.
        fullPage: state !== "signed-in",
        animations: "disabled",
      });
    };
    await openLogin(page);
    // Label, access name and keyboard order of the prepared card.
    const form = page.locator("form");
    await expect(
      form.getByLabel("로그인 아이디", { exact: true }),
    ).toBeVisible();
    await form.getByLabel("로그인 아이디", { exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel("비밀번호", { exact: true })).toBeFocused();
    await shot("ready");
    await login(page, "pending-user", "wrong password 12345");
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(
      "로그인 아이디 또는 비밀번호를 확인해 주세요.",
    );
    await shot("invalid-credentials");
    await login(page, "pending-user");
    await expect(alert).toContainText("승인 대기 중인 계정입니다.");
    await shot("not-approved");
    await login(page, "member-a");
    await expect(
      page.getByRole("link", { name: /^둘째 공개 앱,/ }),
    ).toBeVisible();
    await expect(page.getByText("로그인 상태 확인 중")).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByText("승인 회원", { exact: true }),
    ).toBeVisible();
    await shot("signed-in");
  });
}
