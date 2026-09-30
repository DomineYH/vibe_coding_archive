// Evidence harness only. Run from the repository root: node docs/evidence/phase-2/issue85/2026-09-30/demo.mjs
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const evidence = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(evidence, "../../../../..");
const frontend = path.join(root, "frontend");
const backend = path.join(root, "backend");
// Tailwind resolves its configuration and content paths from the frontend cwd.
process.chdir(frontend);
const require = createRequire(path.join(frontend, "package.json"));
const { chromium, expect } = require("@playwright/test");
const { disableAutomaticPagination } = await import(
  path.join(frontend, "e2e-api/helpers.js")
);
const { createServer } = await import(
  path.join(frontend, "node_modules/vite/dist/node/index.js")
);
const viewports = [
  [1440, 1000],
  [1024, 900],
  [768, 1024],
  [390, 844],
  [360, 844],
];
const results = {
  started_utc: new Date().toISOString(),
  mode: "api",
  database: "owned temporary file SQLite; no seed",
  checkpoints: [],
  captures: [],
  external_attempts_blocked: 0,
};
const temporary = await mkdtemp(path.join(os.tmpdir(), "eduvibe-issue85-"));
const env = {
  ...process.env,
  APP_ENV: "test",
  DATABASE_PATH: path.join(temporary, "demo.sqlite3"),
  PUBLIC_ORIGIN: "http://localhost:5174",
};
let api, vite, browser;
function passed(name) {
  results.checkpoints.push({ name, result: "PASS" });
}
async function freePort(port, host) {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  await new Promise((resolve) => server.close(resolve));
}
async function startApi() {
  api = spawn(
    "uv",
    [
      "run",
      "--frozen",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000",
      "--no-access-log",
    ],
    { cwd: backend, env, stdio: "ignore" },
  );
  for (let i = 0; i < 200; i++) {
    if (api.exitCode !== null)
      throw new Error("Owned API exited during startup");
    try {
      const response = await fetch("http://127.0.0.1:8000/readyz");
      if (response.status === 200 && (await response.json()).status === "ready")
        return;
    } catch {
      /* Listener is not ready yet. */
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Owned API readiness timeout");
}
async function stopApi() {
  if (api && api.exitCode === null) {
    api.kill("SIGTERM");
    await once(api, "exit");
  }
}
async function captures(page, state) {
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    expect(
      await page.evaluate(() =>
        [...document.fonts].some(
          (face) =>
            face.family.includes("Pretendard") && face.status === "loaded",
        ),
      ),
      "Actual Pretendard font must load",
    ).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    if (state === "detail-copy-success") {
      await page.getByRole("button", { name: /^(복사하기|복사됨)$/ }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("button", { name: "복사됨" })).toBeFocused();
    }
    const file = `visual/demo/${state}-${width}x${height}.png`;
    await page.screenshot({
      path: path.join(evidence, file),
      fullPage: true,
      animations: "disabled",
    });
    results.captures.push(file);
  }
}
try {
  await freePort(8000, "127.0.0.1");
  await freePort(5174, "localhost");
  execFileSync("uv", ["run", "--frozen", "alembic", "upgrade", "head"], {
    cwd: backend,
    env,
    stdio: "ignore",
  });
  execFileSync(
    "uv",
    [
      "run",
      "--frozen",
      "python",
      "-c",
      "import os; from pathlib import Path; from tests.support import populate_public_and_private_apps, prepare_issue83_detail_fixture; p=Path(os.environ['DATABASE_PATH']); populate_public_and_private_apps(p,27,valid_uuids=True,include_search_edge_cases=True); prepare_issue83_detail_fixture(p)",
    ],
    { cwd: backend, env, stdio: "ignore" },
  );
  const databaseChecks = JSON.parse(
    execFileSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        "import json,os,sqlite3; c=sqlite3.connect(os.environ['DATABASE_PATH']); c.execute('PRAGMA foreign_keys=ON'); integrity=[r[0] for r in c.execute('PRAGMA integrity_check')]; violations=c.execute('PRAGMA foreign_key_check').fetchall(); assert integrity==['ok'] and not violations; print(json.dumps({'sqlite_version':sqlite3.sqlite_version,'integrity_check':integrity,'foreign_key_check_count':len(violations),'foreign_keys':c.execute('PRAGMA foreign_keys').fetchone()[0],'journal_mode':c.execute('PRAGMA journal_mode').fetchone()[0],'revision':c.execute('SELECT version_num FROM alembic_version').fetchone()[0],'public_apps':c.execute('SELECT COUNT(*) FROM apps WHERE is_public=1').fetchone()[0],'private_apps':c.execute('SELECT COUNT(*) FROM apps WHERE is_public=0').fetchone()[0]}))",
      ],
      { cwd: backend, env, encoding: "utf8" },
    ),
  );
  await writeFile(
    path.join(evidence, "database-checks.json"),
    JSON.stringify(databaseChecks, null, 2) + "\n",
  );
  await startApi();
  process.env.VITE_DATA_MODE = "api";
  vite = await createServer({
    configFile: path.join(frontend, "vite.config.js"),
    root: frontend,
    cacheDir: path.join(temporary, "vite-cache"),
    optimizeDeps: { entries: ["index.html"] },
  });
  await vite.listen();
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    args: ["--force-color-profile=srgb"],
  });
  expect(browser.version()).toBe("151.0.7922.34");
  results.browser = browser.version();
  const context = await browser.newContext({
    baseURL: "http://localhost:5174",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    permissions: ["clipboard-read", "clipboard-write"],
  });
  await context.route("**/*", (route) => {
    if (
      ["localhost", "127.0.0.1", "[::1]"].includes(
        new URL(route.request().url()).hostname,
      )
    )
      return route.continue();
    results.external_attempts_blocked++;
    return route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  // This demonstration exercises manual paging; automatic paging is covered separately.
  await disableAutomaticPagination(page);
  await page.clock.setFixedTime("2026-09-22T00:12:00Z");
  const calls = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/v1/"))
      calls.push({ method: request.method(), path: url.pathname });
  });
  await mkdir(path.join(evidence, "visual/demo"), { recursive: true });
  const unavailable = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Public service error",
          request_id: "issue85-demo",
        },
      }),
    });
  let releaseMeta;
  const metaGate = new Promise((resolve) => {
    releaseMeta = resolve;
  });
  let failMeta = true;
  await page.route("**/api/v1/meta", async (route) => {
    if (failMeta) return unavailable(route);
    await metaGate;
    await route.continue();
  });
  await page.goto("http://localhost:5174");
  await expect(page.getByRole("alert")).toContainText(
    "공개 아카이브를 불러오지 못했어요",
  );
  await captures(page, "meta-error-controlled");
  failMeta = false;
  await page.getByRole("button", { name: "다시 시도" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.locator('[data-screen-label="갤러리"]').getByRole("status"),
  ).toContainText("공개 아카이브를 불러오는 중이에요");
  try {
    await captures(page, "meta-loading-delayed-real");
  } finally {
    releaseMeta();
  }
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.unroute("**/api/v1/meta");
  await captures(page, "gallery");
  passed(
    "controlled metadata failure/delayed real loading; keyboard retry reaches real server",
  );
  const meta = await page.request.get("/api/v1/meta").then((r) => r.json());
  expect(meta.capabilities.apps_read.enabled).toBe(true);
  expect(
    Object.entries(meta.capabilities).filter(
      ([key, value]) => key !== "apps_read" && value.enabled,
    ),
  ).toEqual([]);
  passed("actual meta → public gallery; all other capabilities disabled");
  await page
    .getByRole("group", { name: "과목 필터" })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await page.getByRole("combobox", { name: "학년 필터" }).selectOption("초1");
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("추가 공개 앱");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  let failNext = true;
  let releaseFailure;
  const failureGate = new Promise((resolve) => {
    releaseFailure = resolve;
  });
  let releaseNext;
  const nextGate = new Promise((resolve) => {
    releaseNext = resolve;
  });
  await page.route("**/api/v1/apps?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("offset") === "24") {
      if (failNext) {
        failNext = false;
        await failureGate;
        return unavailable(route);
      }
      await nextGate;
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "더 불러오기" }).click();
  try {
    await expect(
      page.getByRole("button", { name: "불러오는 중이에요" }),
    ).toBeDisabled();
    await captures(page, "next-page-loading-before-controlled-error");
  } finally {
    releaseFailure();
  }
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await captures(page, "next-page-error-controlled");
  await page.getByRole("button", { name: "다시 시도" }).focus();
  await page.keyboard.press("Enter");
  try {
    // React Query retains the preceding error while its explicit retry is pending.
    await expect(page.getByRole("alert")).toContainText(
      "추가 자료를 불러오지 못했어요",
    );
    await expect(page.locator("a.card-r")).toHaveCount(24);
    await captures(page, "next-page-retry-pending-delayed-real");
  } finally {
    releaseNext();
  }
  await expect(page.locator("a.card-r")).toHaveCount(25);
  await page.unroute("**/api/v1/apps?**");
  passed("controlled next-page failure retains 24 cards; keyboard real retry");
  await mkdir(path.join(evidence, "visual/demo"), { recursive: true });
  await captures(page, "filtered-page2");
  passed("search AND subject AND grade → second page (24 → 25 cards)");
  await search.fill("조건없는 자료");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await captures(page, "zero-results");
  passed("valid zero results is not an error");
  await search.fill("추가 공개 앱");
  const link = page.getByRole("link", { name: /추가 공개 앱 27/ });
  await expect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "추가 공개 앱 27" }),
  ).toBeVisible();
  await expect(page.getByText("미검사", { exact: true }).first()).toBeVisible();
  const prompt = await page.locator("main pre").textContent();
  await page.getByRole("button", { name: "복사하기" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "복사됨" })).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    prompt,
  );
  passed("keyboard detail focus; real Clipboard API copied exact DB prompt");
  await captures(page, "detail-copy-success");
  const external = page.getByRole("link", { name: "앱 열기" });
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");
  const popupPromise = context.waitForEvent("page");
  await external.click();
  const popup = await popupPromise;
  await expect.poll(() => results.external_attempts_blocked).toBeGreaterThan(0);
  await popup.close();
  passed(
    "new tab opened; external request blocked, no destination success claimed",
  );
  await captures(page, "detail-unchecked");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "추가 공개 앱 27" }),
  ).toBeVisible();
  const detailId = new URL(page.url()).pathname.split("/").at(-1);
  const before = await page.request
    .get(`/api/v1/apps/${detailId}`)
    .then((r) => r.json());
  const privateResponse = await page.request.get(
    "/api/v1/apps/00000000-0000-4000-8000-000000000028",
  );
  const missingResponse = await page.request.get(
    "/api/v1/apps/00000000-0000-4000-8000-000000000099",
  );
  expect(privateResponse.status()).toBe(404);
  expect(await privateResponse.json()).toEqual(await missingResponse.json());
  for (const sentinel of [
    "private-login-sentinel",
    "email-sentinel",
    "phone-sentinel",
    "password-hash-sentinel",
  ])
    expect(JSON.stringify(before)).not.toContain(sentinel);
  passed("reload; private/missing same 404; sensitive sentinels absent");
  await page.getByRole("button", { name: "갤러리로" }).focus();
  await page.keyboard.press("Enter");
  await expect(search).toHaveValue("추가 공개 앱");
  await expect(page.getByRole("combobox", { name: "학년 필터" })).toHaveValue(
    "초1",
  );
  expect(new URL(page.url()).searchParams.get("subject")).toBe("수학");
  passed("keyboard gallery return retains query, subject and grade");
  await stopApi();
  await startApi();
  await page.goto(`http://localhost:5174/apps/${detailId}`);
  await expect(
    page.getByRole("heading", { name: "추가 공개 앱 27" }),
  ).toBeVisible();
  const after = await page.request
    .get(`/api/v1/apps/${detailId}`)
    .then((r) => r.json());
  expect(after.item).toEqual(before.item);
  expect(await page.locator("main pre").textContent()).toBe(prompt);
  await captures(page, "restarted-detail");
  passed(
    "same file DB after process restart → same ID and full item → browser",
  );
  await page.goto(
    "http://localhost:5174/apps/00000000-0000-4000-8000-000000000001",
  );
  await expect(page.locator("main pre")).toContainText("긴 프롬프트 경계 줄");
  await captures(page, "long-detail");
  passed("real long nickname/name/prompt/detail at pinned five viewports");
  await page.goto("http://localhost:5174/auth");
  await expect(page.locator("main").getByRole("status")).toContainText(
    "준비 중",
  );
  await captures(page, "auth-unavailable");
  await page.goto("http://localhost:5174/admin");
  await expect(page.locator("main").getByRole("status")).toContainText(
    "관리자 기능은 아직 준비 중이에요",
  );
  await captures(page, "admin-unavailable");
  passed("unsupported auth/admin routes remain unavailable");
  expect(
    calls.every(
      ({ method, path }) =>
        method === "GET" && !/\/(auth|admin|health)/.test(path),
    ),
  ).toBe(true);
  results.api_requests = calls;
  results.finished_utc = new Date().toISOString();
  results.result = "PASS";
} catch (error) {
  results.result = "FAIL";
  results.failure = error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  await vite?.close();
  await stopApi();
  await rm(temporary, { recursive: true, force: true });
  await writeFile(
    path.join(evidence, "demo-results.json"),
    JSON.stringify(results, null, 2) + "\n",
  );
  console.log(
    `Issue85 demo: ${results.result}; ${results.checkpoints.length} checkpoints; ${results.captures.length} captures`,
  );
}
