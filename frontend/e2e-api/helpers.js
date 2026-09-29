import { expect } from "@playwright/test";

export const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

export const viewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 844 },
];

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
