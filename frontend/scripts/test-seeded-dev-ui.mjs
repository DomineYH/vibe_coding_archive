/* global document, requestAnimationFrame */

import { chromium, expect } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromiumExecutable } from "../playwright-browser.js";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(frontend, "..");
const date = new Date().toISOString().slice(0, 10);
const evidenceDirectory = path.join(
  root,
  "docs/evidence/phase-2/issue84",
  date,
  "visual/seed-mode",
);
const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];
const publicId = "00000000-0000-4000-8000-000000000084";
const privateId = "00000000-0000-4000-8000-000000000085";
const apiUrl = new URL(process.env.ISSUE84_SEED_UI_API_URL ?? "");

async function tabTo(page, target) {
  for (let index = 0; index < 40; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

if (
  apiUrl.protocol !== "http:" ||
  apiUrl.hostname !== "127.0.0.1" ||
  !apiUrl.port ||
  apiUrl.pathname !== "/" ||
  apiUrl.search ||
  apiUrl.hash
)
  throw new Error("Seed UI verification requires its temporary loopback API.");

process.env.VITE_DATA_MODE = "api";
const cacheDirectory = await mkdtemp(
  path.join(os.tmpdir(), "eduvibe-seed-ui-"),
);
const vite = await createServer({
  configFile: path.join(frontend, "vite.config.js"),
  root: frontend,
  cacheDir: cacheDirectory,
  optimizeDeps: { entries: ["index.html"] },
  server: {
    host: "127.0.0.1",
    port: 0,
    strictPort: false,
    proxy: { "/api": apiUrl.origin },
  },
});
let browser;

try {
  // Vite 6 treats port 0 as its default; the native listener asks the OS.
  await new Promise((resolve, reject) => {
    vite.httpServer.once("error", reject);
    vite.httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = vite.httpServer.address();
  expect(
    address.port,
    "Seed UI must not claim a fixed development port",
  ).not.toBe(5173);
  expect(address.port, "Seed UI must not claim the fixed API UI port").not.toBe(
    5174,
  );
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    executablePath: chromiumExecutable(),
    args: ["--force-color-profile=srgb"],
  });
  expect(browser.version()).toBe("151.0.7922.34");
  const context = await browser.newContext({
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
  });
  await context.route("**/*", (route) => {
    const { hostname } = new URL(route.request().url());
    return hostname === "127.0.0.1" || hostname === "localhost"
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  const requestPaths = [];
  const externalRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    requestPaths.push({ method: request.method(), path: url.pathname });
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost")
      externalRequests.push(url.hostname);
  });
  await page.goto(origin);

  const listResponse = await page.request.get(
    new URL("/api/v1/apps?limit=100", origin).href,
  );
  expect(listResponse.status()).toBe(200);
  const list = await listResponse.json();
  expect(list.pagination.total).toBe(1);
  expect(list.items.map(({ id }) => id)).toEqual([publicId]);
  expect(JSON.stringify(list)).not.toContain("private");
  const privateResponse = await page.request.get(
    new URL(`/api/v1/apps/${privateId}`, origin).href,
  );
  expect(privateResponse.status()).toBe(404);
  expect(await privateResponse.text()).not.toContain("sentinel");

  const appLink = page.getByRole("link", { name: /Existing app edit/ });
  await expect(appLink).toBeVisible();
  await expect(appLink).toHaveAccessibleName(
    /Existing app edit.*시연 교사.*수학/,
  );
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await page.evaluate(() => document.fonts.ready);
  const pretendardLoaded = await page.evaluate(() =>
    Array.from(document.fonts).some(
      (face) => face.family.includes("Pretendard") && face.status === "loaded",
    ),
  );
  expect(
    pretendardLoaded,
    "Seed captures require the actual Pretendard font",
  ).toBe(true);
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await mkdir(evidenceDirectory, { recursive: true });
    await page.screenshot({
      path: path.join(
        evidenceDirectory,
        `gallery-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }

  await tabTo(page, appLink);
  await expect(appLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Existing app edit", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("main")).toContainText("시연 교사");
  await expect(page.getByRole("main")).not.toContainText(publicId);
  await expect(page.getByRole("main")).not.toContainText("seed-member-one");
  await expect(page.getByRole("main")).toContainText(
    "분수와 수직선을 함께 살펴보는 합성 자료입니다.",
  );
  await expect(page.locator("main pre")).toHaveText("Existing prompt");
  await expect(page.getByRole("main")).not.toContainText("sentinel");
  await expect(page.getByRole("link", { name: "앱 열기" })).toHaveAttribute(
    "href",
    "https://example.test/fraction-adventure",
  );
  await expect(page.getByText("미검사", { exact: true }).first()).toBeVisible();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport.width);
    await page.screenshot({
      path: path.join(
        evidenceDirectory,
        `detail-${viewport.width}x${viewport.height}.png`,
      ),
      fullPage: true,
      animations: "disabled",
    });
  }

  const galleryButton = page.getByRole("button", { name: "갤러리로" });
  await expect(galleryButton).toBeVisible();
  await tabTo(page, galleryButton);
  await page.keyboard.press("Enter");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  const apiRequests = requestPaths.filter(({ path }) =>
    path.startsWith("/api/v1/"),
  );
  expect(apiRequests.some(({ path }) => path === "/api/v1/apps")).toBe(true);
  expect(
    apiRequests.some(
      ({ method, path }) =>
        method !== "GET" || /\/(?:auth|health|admin)(?:\/|$|-)/.test(path),
    ),
  ).toBe(false);
  expect(externalRequests).toEqual([]);

  await writeFile(
    path.join(evidenceDirectory, "results.json"),
    `${JSON.stringify(
      {
        environment: "test-owned temporary checkout; development API",
        ui_port: address.port,
        isolated_vite_cache: true,
        pretendard_loaded: pretendardLoaded,
        public_count: list.pagination.total,
        public_id: publicId,
        rendered_name: "Existing app edit",
        rendered_prompt: "Existing prompt",
        private_status: privateResponse.status(),
        keyboard_open_and_return: true,
        viewports,
      },
      null,
      2,
    )}\n`,
  );
  console.log("Seeded development UI: 10 screenshots, 5 viewports, PASS.");
} finally {
  await browser?.close();
  await vite.close();
  await rm(cacheDirectory, { recursive: true, force: true });
}
