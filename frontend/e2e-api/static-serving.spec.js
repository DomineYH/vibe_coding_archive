import { expect } from "@playwright/test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { approvalHeaders, login } from "./approval-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";
import { test, wire } from "./static-serving-helpers.js";

if (process.env.API_E2E_NGINX !== "1")
  throw new Error(
    "static-serving.spec.js requires --nginx; Vite is not serving evidence",
  );
const release = process.env.API_E2E_RELEASE_ROOT;
const A = "00000000-0000-4000-8000-000000000030";
const publicId = "00000000-0000-4000-8000-000000000002";
const origin = "https://localhost:8443";
const sentinel = "T01_SYNTHETIC_FORBIDDEN_FILE_196";
const excluded = [
  ".env",
  ".git/config",
  "source.ts",
  "mock/data.js",
  "reference/proof.png",
  "evidence/proof.txt",
  "assets/private.sqlite3",
  "assets/private.sqlite3-wal",
  "assets/private.sqlite3-shm",
  "assets/private.db",
  "assets/private.db-wal",
  "assets/private.db-shm",
  "assets/backup.age",
  "assets/private.bak",
  "assets/private.key",
  "assets/main.js.map",
  "assets/.nested.js",
  "assets/mock.js",
  "assets/source.ts.js",
  "assets/private.db.js",
  "apps/.env",
  "apps/private.db",
  "apps/mock",
  "apps/evidence",
  "assets/PRIVATE.DB.JS",
  "ASSETS/PRIVATE.DB",
  "apps/MOCK",
];

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});

async function entry(page, route, locator) {
  expect((await page.goto(route)).status()).toBe(200);
  await expect(locator).toBeVisible();
  expect((await page.reload()).status()).toBe(200);
  await expect(locator).toBeVisible();
}

test("serves built routes on direct entry reload and history", async ({
  page,
}) => {
  const scripts = [];
  page.on("request", (request) => {
    if (request.resourceType() === "script")
      scripts.push(new URL(request.url()).pathname);
  });
  await entry(page, "/", page.locator("a.card-r").first());
  await entry(
    page,
    `/apps/${publicId}`,
    page.getByRole("heading", { name: "둘째 공개 앱", exact: true }),
  );
  await page
    .getByRole("button", { name: "갤러리로", exact: true })
    .first()
    .click();
  await expect(page.locator("a.card-r").first()).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "둘째 공개 앱", exact: true }),
  ).toBeVisible();
  await page.goForward();
  await expect(page.locator("a.card-r").first()).toBeVisible();
  await entry(
    page,
    "/auth?mode=login",
    page.getByLabel("로그인 아이디", { exact: true }),
  );
  await entry(
    page,
    "/auth?mode=signup",
    page.getByLabel("로그인 아이디 (필수)", { exact: true }),
  );
  await login(page, "member-a");
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  await entry(
    page,
    "/apps/new",
    page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
  );
  await entry(
    page,
    `/apps/${A}/edit`,
    page.getByRole("form", { name: "앱 수정 양식", exact: true }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement !== document.body),
  ).toBe(true);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "approval-admin");
  await expect(
    page.getByRole("banner").getByText("승인 담당", { exact: true }),
  ).toBeVisible();
  await entry(page, "/admin", page.getByRole("list", { name: "회원 목록" }));
  expect(scripts.some((url) => /^\/assets\/[^/]+\.js$/.test(url))).toBe(true);
  expect(scripts.some((url) => /@vite|\/src\//.test(url))).toBe(false);
});

test("denies anonymous protected UI and API without private values", async ({
  page,
  request,
}) => {
  for (const route of ["/apps/new", "/admin", `/apps/${A}/edit`]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/auth\?mode=login/);
    await expect(
      page.getByLabel("로그인 아이디", { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator("form").getByRole("button", { name: "로그인", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("form", { name: /새 앱 등록 양식|앱 수정 양식/ }),
    ).toHaveCount(0);
    await expect(page.getByRole("list", { name: "회원 목록" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("회원 A 비공개 자료");
  }
  const privateApp = await request.get(`/api/v1/apps/${A}`);
  expect(privateApp.status()).toBe(404);
  expect((await privateApp.text()).includes("회원 A 비공개 자료")).toBe(false);
  const admin = await page.request.get("/api/v1/admin/users", {
    headers: await approvalHeaders(page),
  });
  expect([401, 403]).toContain(admin.status());
  expect((await admin.text()).includes("승인 교사")).toBe(false);
});

test("separates API assets probes and unknown routes", async ({ request }) => {
  const missingApi = await request.get("/api/v1/no-such-path");
  expect(missingApi.status()).toBe(404);
  expect(missingApi.headers()["content-type"]).toContain("application/json");
  for (const route of [
    "/api",
    "/api/",
    "/assets/absent.js",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/arbitrary",
    "/apps/a/extra",
  ]) {
    const response = await request.get(route);
    expect(response.status()).toBe(404);
    expect((await response.text()).includes('<div id="root">')).toBe(false);
  }
  for (const route of ["/healthz", "/readyz"]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toEqual({ status: "ok" });
  }
  const files = [
    "index.html",
    "licenses/Pretendard-OFL.txt",
    ...readdirSync(path.join(release, "assets")).map(
      (name) => `assets/${name}`,
    ),
  ];
  for (const file of files) {
    const response = await request.get(`/${file}`);
    expect(response.status(), file).toBe(200);
    expect(
      (await response.body()).equals(readFileSync(path.join(release, file))),
      file,
    ).toBe(true);
  }
  for (const route of [
    "/auth/",
    "/admin/",
    "/apps/new/",
    `/apps/${publicId}/`,
    `/apps/${A}/edit/`,
    "/apps/not-a-uuid",
  ]) {
    const response = await request.get(route);
    expect(response.status()).toBe(200);
    expect(
      (await response.body()).equals(
        readFileSync(path.join(release, "index.html")),
      ),
    ).toBe(true);
  }
});

test("never serves forbidden files or escaping links", async () => {
  for (const file of excluded) {
    const target = path.join(release, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, sentinel);
  }
  const outside = path.join(path.dirname(release), "outside.js");
  writeFileSync(outside, sentinel);
  symlinkSync(outside, path.join(release, "assets/escape.js"));
  symlinkSync(path.dirname(release), path.join(release, "assets/escape-dir"));
  const targets = [
    ...excluded.map((file) => `/${file}`),
    "/assets/escape.js",
    "/assets/escape-dir/outside.js",
    "/assets/",
    "/licenses/",
    "/assets/../.env",
    "/assets/%2e%2e/.env",
    "/assets%2f..%2f.env",
    "/assets/%252e%252e/%252eenv",
    "//assets//.nested.js",
    "/ASSETS/.NESTED.JS",
    "/.git/",
    "/apps/%2eenv/edit",
    "/apps/private.db/edit",
  ];
  for (const target of targets) {
    const result = await wire(target);
    expect(result.response.includes(sentinel), target).toBe(false);
    expect(result.response.includes("Index of /"), target).toBe(false);
    expect(result.status, target).toBeGreaterThanOrEqual(400);
    expect(result.status, target).toBeLessThan(500);
  }
  const assets = path.join(release, "assets");
  const saved = path.join(path.dirname(release), "saved-assets");
  renameSync(assets, saved);
  try {
    symlinkSync(path.dirname(release), assets);
    const escaped = await wire("/assets/outside.js");
    expect(escaped.response.includes(sentinel)).toBe(false);
    expect([403, 404]).toContain(escaped.status);
  } finally {
    unlinkSync(assets);
    renameSync(saved, assets);
  }
});

test("preserves HTTPS auth cookies and cache controls", async ({
  page,
  context,
}) => {
  const cookieResponses = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/v1/auth/"))
      cookieResponses.push(response);
  });
  await login(page, "member-a");
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  const loginResponse = cookieResponses.find(
    (response) => new URL(response.url()).pathname === "/api/v1/auth/login",
  );
  expect(Boolean(loginResponse)).toBe(true);
  const headers = await loginResponse.headersArray();
  const cookies = headers.filter(
    (header) => header.name.toLowerCase() === "set-cookie",
  );
  expect(cookies.length).toBeGreaterThanOrEqual(2);
  expect(
    cookies.every(
      ({ value }) =>
        /; Secure/i.test(value) &&
        /; HttpOnly/i.test(value) &&
        /; Path=\//i.test(value) &&
        !/; Domain=/i.test(value),
    ),
  ).toBe(true);
  expect(
    headers.some(
      (header) => header.name.toLowerCase() === "x-eduvibe-auth-revision",
    ),
  ).toBe(true);
  expect((await loginResponse.allHeaders())["cache-control"]).toBe(
    "private, no-store",
  );
  const jar = (await context.cookies()).filter((cookie) =>
    cookie.name.startsWith("__Host-eduvibe_"),
  );
  expect(
    jar.some((cookie) => cookie.name.startsWith("__Host-eduvibe_session_")),
  ).toBe(true);
  expect(
    jar.some((cookie) => cookie.name.startsWith("__Host-eduvibe_recovery_")),
  ).toBe(true);
  expect(
    jar.every(
      (cookie) =>
        cookie.secure &&
        cookie.httpOnly &&
        cookie.path === "/" &&
        cookie.sameSite === "Lax",
    ),
  ).toBe(true);
  const current = await page.request.get("/api/v1/auth/me", {
    headers: await approvalHeaders(page),
  });
  expect(current.status()).toBe(200);
  expect(current.headers()["cache-control"]).toBe("private, no-store");
  expect(
    (await page.request.get("/index.html")).headers()["cache-control"],
  ).toBe("no-store");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  expect(
    (await context.cookies()).some((cookie) =>
      cookie.name.startsWith("__Host-eduvibe_session_"),
    ),
  ).toBe(false);
});

test("rejects untrusted Host and forwarded identities", async ({ request }) => {
  for (const target of ["/", "/api/v1/meta"]) {
    const result = await wire(target, { headers: ["Host: unknown.invalid"] });
    expect(result.status).toBe(421);
  }
  const redirect = await request.get("http://localhost:8080/auth?mode=login", {
    maxRedirects: 0,
  });
  expect(redirect.status()).toBe(308);
  expect(redirect.headers().location).toBe(`${origin}/auth?mode=login`);
  const untrustedRedirect = await request.get("http://localhost:8080/", {
    headers: { Host: "unknown.invalid" },
    maxRedirects: 0,
  });
  expect(untrustedRedirect.status()).toBe(421);
  for (const spoof of [false, true]) {
    const result = await request.post("/api/v1/auth/flows", {
      headers: {
        Origin: origin,
        ...(spoof
          ? {
              Forwarded: "for=203.0.113.99;proto=http;host=unknown.invalid",
              "X-Forwarded-For": "203.0.113.99",
              "X-Real-IP": "203.0.113.98",
              "X-Forwarded-Proto": "http",
            }
          : {}),
      },
      data: { restart_from: [] },
    });
    expect(result.status()).toBe(201);
  }
  expect(
    query(
      "SELECT count(DISTINCT subject_hash) FROM rate_limit_events WHERE purpose='prepare'",
    ),
  ).toEqual([[1]]);
  const before = query("SELECT count(*) FROM auth_flows");
  const refused = await request.post("/api/v1/auth/flows", {
    headers: { Origin: "http://localhost:8443", "X-Forwarded-Proto": "https" },
    data: { restart_from: [] },
  });
  expect(refused.status()).toBe(403);
  expect(query("SELECT count(*) FROM auth_flows")).toEqual(before);
});

test("enforces single and aggregate header budgets", async ({ page }) => {
  await login(page, "member-a");
  await expect(
    page.getByRole("banner").getByText("승인 회원", { exact: true }),
  ).toBeVisible();
  // Product cookies and ordinary browser headers reach the real API.
  expect(
    (
      await page.request.get("/api/v1/auth/me", {
        headers: await approvalHeaders(page),
      })
    ).status(),
  ).toBe(200);
  const body = JSON.stringify({ restart_from: [] });
  for (const method of ["GET", "POST"]) {
    const target = method === "GET" ? "/api/v1/meta" : "/api/v1/auth/flows";
    const common = [
      "Host: localhost:8443",
      "Connection: close",
      ...(method === "POST"
        ? [
            `Origin: ${origin}`,
            "Content-Type: application/json",
            `Content-Length: ${Buffer.byteLength(body)}`,
          ]
        : []),
    ];
    // Count field names, ': ', values and CRLF; Host and framing are included.
    for (const [size, count, fragmented, reverse] of [
      [12000, 4, 0, false],
      [16383, 6, 257, false],
      [16384, 9, 0, true],
      [16385, 24, 257, true],
      [17408, 40, 0, false],
    ]) {
      const budget =
        size - 2 - common.reduce((total, field) => total + field.length + 2, 0);
      const fields = Array.from({ length: count }, (_, index) => {
        const line =
          Math.floor(budget / count) + (index < budget % count ? 1 : 0);
        return `X-${index}: ${"x".repeat(line - `X-${index}: `.length - 2)}`;
      });
      const before = query("SELECT count(*) FROM auth_flows");
      const result = await wire(target, {
        method,
        headers: [
          ...common.slice(0, -1),
          ...(reverse ? fields.reverse() : fields),
          ...common.slice(-1),
        ],
        body: method === "POST" ? body : "",
        fragment: fragmented,
      });
      if (size === 12000) {
        expect(result.status).toBe(method === "GET" ? 200 : 201);
        if (method === "POST")
          expect(query("SELECT count(*) FROM auth_flows")[0][0]).toBe(
            before[0][0] + 1,
          );
      } else {
        expect([400, 414, 431]).toContain(result.status);
        expect(result.response.includes("<center>nginx</center>")).toBe(true);
        expect(query("SELECT count(*) FROM auth_flows")).toEqual(before);
      }
    }
    for (const name of ["Cookie", "X-Large"]) {
      for (const size of [8000, 8191, 8192, 8193]) {
        const field = `${name}: ${"x".repeat(size - name.length - 4)}\r\n`;
        const before = query("SELECT count(*) FROM auth_flows");
        const result = await wire(target, {
          method,
          headers: [...common, field.slice(0, -2)],
          body: method === "POST" ? body : "",
          fragment: 503,
        });
        if (size === 8000)
          expect(result.status).toBe(method === "GET" ? 200 : 201);
        else {
          expect([400, 414, 431]).toContain(result.status);
          expect(result.response.includes("<center>nginx</center>")).toBe(true);
          expect(query("SELECT count(*) FROM auth_flows")).toEqual(before);
        }
      }
    }
  }
});

test("keeps operational capabilities disabled and fails when the upstream is unavailable", async ({
  page,
  request,
}) => {
  const meta = await (await request.get("/api/v1/meta")).json();
  expect(meta.capabilities.health_check.enabled).toBe(false);
  expect(meta.capabilities.health_batch.enabled).toBe(false);
  expect(
    query(
      "SELECT count(*) FROM health_jobs WHERE status IN ('queued','running')",
    ),
  ).toEqual([[0]]);
  expect(existsSync(process.env.HEALTH_WORKER_LOCK_PATH)).toBe(false);
  expect(existsSync(process.env.HEALTH_ACTIVATION_PATH)).toBe(false);
  const pid = Number(readFileSync(process.env.API_E2E_UPSTREAM_PID, "utf8"));
  expect(Number.isSafeInteger(pid) && pid > 1).toBe(true);
  process.kill(pid, "SIGSTOP");
  try {
    const failure = await request.get("/api/v1/meta");
    expect([502, 504]).toContain(failure.status());
    expect((await failure.text()).includes('<div id="root">')).toBe(false);
    await page.goto("/");
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(await page.locator("a.card-r").count()).toBe(0);
    expect(
      (await page.locator("body").textContent()).includes("분수 피자 가게"),
    ).toBe(false);
  } finally {
    process.kill(pid, "SIGCONT");
  }
  await expect
    .poll(async () => (await request.get("/readyz")).status())
    .toBe(200);
});
