import { expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];

export function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

export function fulfillServiceUnavailable(route, requestId) {
  return route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({
      error: {
        code: "SERVICE_UNAVAILABLE",
        message: "Public service error",
        request_id: requestId,
      },
    }),
  });
}

export async function prepareViewportCapture(page, viewport) {
  await page.setViewportSize(viewport);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(viewport.width);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
}

export function blockExternalRequests(context) {
  return context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return loopbackHosts.has(url.hostname)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
}

export function disableAutomaticPagination(page) {
  return page.addInitScript(() => {
    window.IntersectionObserver = class {
      observe() {}
      disconnect() {}
    };
  });
}

export function query(statement) {
  const result = spawnSync(
    "uv",
    [
      "run",
      "--frozen",
      "python",
      "-c",
      "import json, os, sqlite3, sys; c = sqlite3.connect(os.environ['DATABASE_PATH']); print(json.dumps(c.execute(sys.argv[1]).fetchall()))",
      statement,
    ],
    {
      cwd: path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../backend",
      ),
      env: process.env,
      encoding: "utf8",
    },
  );
  if (result.status !== 0) throw new Error("test database query failed");
  return JSON.parse(result.stdout);
}
