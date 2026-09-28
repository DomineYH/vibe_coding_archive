import assert from "node:assert/strict";
import { createRequire } from "node:module";
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
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  args: ["--force-color-profile=srgb"],
});

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
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: `${evidenceDir}/api-mode-gallery-failure-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
      animations: "disabled",
    });

    await page.goto(`${origin}/auth?mode=login`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .getByRole("status")
      .filter({ hasText: "인증 기능은 아직 준비 중이에요" })
      .waitFor();
    assert.equal(await page.getByRole("textbox").count(), 0);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
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
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.screenshot({
      path: `${evidenceDir}/api-mode-admin-unavailable-${viewport.width}x${viewport.height}.png`,
      fullPage: true,
      animations: "disabled",
    });

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
        productOnlyCaptures: viewports.length * 3,
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
