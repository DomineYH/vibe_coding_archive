import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(`${process.cwd()}/package.json`);
const { chromium } = require("@playwright/test");
const evidenceDir = fileURLToPath(
  new URL("./visual/api-mode/", import.meta.url),
);
const origin = process.env.API_ORIGIN ?? "http://localhost:5174";
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];
const capabilityKeys = [
  "apps_read",
  "auth_register",
  "auth_login",
  "auth_logout",
  "auth_password_change",
  "admin_users_read",
  "admin_approval",
  "admin_summary",
  "apps_create",
  "apps_update_own",
  "apps_delete_own",
  "admin_apps_read",
  "admin_apps_manage",
  "admin_reauth",
  "admin_password_reset",
  "admin_user_delete",
  "health_read",
  "health_check",
  "health_batch",
  "email_collection",
  "phone_collection",
];
const catalog = JSON.parse(readFileSync("../contracts/catalog.json", "utf8"));
const validationMeta = {
  ...catalog,
  server_time: "2026-09-29T00:00:00Z",
  capabilities: Object.fromEntries(
    capabilityKeys.map((key) => [
      key,
      key === "apps_read"
        ? { enabled: true, reasons: [] }
        : { enabled: false, reasons: ["not_implemented"] },
    ]),
  ),
  support: { email: null, service_url: null, announcement_url: null },
  initial_pending_days: 90,
};
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ["--force-color-profile=srgb"],
});

async function waitForRenderedPage(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

try {
  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport,
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    const page = await context.newPage();
    const requests = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/")) requests.push(request);
    });
    await page.addInitScript(() => {
      localStorage.setItem("eduvibe-archive-coty2026", "stale-demo");
      localStorage.setItem(
        "eduvibe-archive-mock-v1",
        '{"principal":"sentinel"}',
      );
      localStorage.setItem("unrelated-app-key", "preserve");
    });
    await page.route("**/api/v1/meta", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Controlled test API failure",
            request_id: "issue78-smoke",
          },
        }),
      }),
    );

    await page.goto(origin, { waitUntil: "domcontentloaded" });
    await page.getByRole("alert").waitFor();
    assert.match(
      await page.getByRole("status").innerText(),
      /인증 기능 준비 중/,
    );
    assert.equal(await page.locator("a.card-r").count(), 0);
    assert.deepEqual(
      await page.evaluate(() => [
        localStorage.getItem("eduvibe-archive-coty2026"),
        localStorage.getItem("eduvibe-archive-mock-v1"),
        localStorage.getItem("unrelated-app-key"),
      ]),
      [null, null, "preserve"],
    );
    await waitForRenderedPage(page);
    await page.screenshot({
      path: `${evidenceDir}/api-mode-gallery-failure-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
      animations: "disabled",
    });

    const hiddenAuthPage = await context.newPage();
    await hiddenAuthPage.addInitScript(() => {
      let visibilityState = "hidden";
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => visibilityState,
      });
      window.__setIssue78Visibility = (nextState) => {
        visibilityState = nextState;
        document.dispatchEvent(new Event("visibilitychange"));
      };
    });
    await hiddenAuthPage.goto(`${origin}/auth?mode=login`, {
      waitUntil: "domcontentloaded",
    });
    await hiddenAuthPage
      .locator("main")
      .getByRole("status")
      .filter({ hasText: "인증 기능은 아직 준비 중이에요" })
      .waitFor();
    assert.match(
      await hiddenAuthPage.locator("header").innerText(),
      /인증 기능 준비 중/,
    );
    await hiddenAuthPage.evaluate(() =>
      window.__setIssue78Visibility("visible"),
    );
    await hiddenAuthPage
      .locator("main")
      .getByRole("status")
      .filter({ hasText: "인증 기능은 아직 준비 중이에요" })
      .waitFor();
    await hiddenAuthPage.close();

    await page.goto(`${origin}/auth?mode=login`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("status")
      .filter({ hasText: "인증 기능은 아직 준비 중이에요" })
      .waitFor();
    assert.equal(await page.getByRole("textbox").count(), 0);
    await waitForRenderedPage(page);
    await page.screenshot({
      path: `${evidenceDir}/api-mode-auth-unavailable-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
      animations: "disabled",
    });

    await page.goto(`${origin}/admin`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("status")
      .filter({ hasText: "관리자 기능은 아직 준비 중이에요" })
      .waitFor();
    await waitForRenderedPage(page);
    await page.screenshot({
      path: `${evidenceDir}/api-mode-admin-unavailable-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
      animations: "disabled",
    });

    const validationPage = await context.newPage();
    await validationPage.route("**/api/v1/meta", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(validationMeta),
      }),
    );
    let queryValidationRequests = 0;
    await validationPage.route("**/api/v1/apps**", (route) => {
      queryValidationRequests += 1;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "VALIDATION_ERROR",
            message: "검색 조건을 확인해 주세요.",
            fields: { q: "검색어를 확인해 주세요." },
            request_id: "issue78-query-validation",
          },
        }),
      });
    });
    await validationPage.goto(`${origin}/?q=${encodeURIComponent("분수")}`, {
      waitUntil: "domcontentloaded",
    });
    const search = validationPage.getByRole("textbox", {
      name: "앱·작성자 검색",
    });
    const reset = validationPage.getByRole("button", { name: "조건 초기화" });
    await validationPage.locator("#gallery-search-validation-error").waitFor();
    assert.ok(queryValidationRequests > 0);
    assert.equal(await search.inputValue(), "분수");
    assert.equal(await search.getAttribute("aria-invalid"), "true");
    assert.equal(
      await search.getAttribute("aria-describedby"),
      "gallery-search-validation-error",
    );
    const searchBox = await search.boundingBox();
    const errorBox = await validationPage
      .locator("#gallery-search-validation-error")
      .boundingBox();
    assert.ok(searchBox && errorBox);
    assert.ok(errorBox.y >= searchBox.y + searchBox.height);
    await waitForRenderedPage(validationPage);
    await validationPage.screenshot({
      path: `${evidenceDir}/api-mode-gallery-query-error-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
      animations: "disabled",
    });
    await search.focus();
    assert.equal(
      await search.evaluate((element) => element === document.activeElement),
      true,
    );
    await validationPage.keyboard.press("Tab");
    assert.equal(
      await reset.evaluate((element) => element === document.activeElement),
      true,
    );
    await validationPage.keyboard.press("Enter");
    await validationPage.waitForFunction(
      () =>
        !new URL(location.href).searchParams.has("q") &&
        document.querySelector("#gallery-search")?.value === "",
    );
    assert.equal(
      await validationPage.locator("#gallery-search").inputValue(),
      "",
    );
    await validationPage.close();

    const metaRequests = requests.filter((request) =>
      request.url().endsWith("/api/v1/meta"),
    );
    assert.ok(metaRequests.length >= 1);
    for (const request of metaRequests) {
      assert.equal(request.method(), "GET");
      const headers = await request.allHeaders();
      assert.equal(headers["x-eduvibe-flow-id"], undefined);
      assert.equal(headers["x-eduvibe-auth-revision"], undefined);
      assert.equal(headers["x-eduvibe-session-generation"], undefined);
      assert.equal(headers["x-csrf-token"], undefined);
    }
    assert.equal(
      requests.filter((request) =>
        /\/api\/v1\/(auth|me|csrf)(\/|\?|$)/.test(request.url()),
      ).length,
      0,
    );
    await context.close();
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        viewportCount: viewports.length,
        productOnlyCaptures: viewports.length * 4,
        queryValidationCaptures: viewports.length,
        storage: "only the two EduVibe demo keys were cleared",
        publicReadError: "visible, with no mock fixture cards",
        authentication: "no auth/me/CSRF calls or headers; routes unavailable",
        transport: "route-intercepted 503; no live API or database",
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
