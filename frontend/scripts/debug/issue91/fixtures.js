import { test as base, expect } from "@playwright/test";
import { setTimeout as delay } from "node:timers/promises";

export const test = base.extend({
  warmServer: [
    async ({ browser }, runFixture) => {
      if (process.env.ISSUE91_MODE === "stress-warm") {
        const warmPage = await browser.newPage();
        try {
          await warmPage.goto("http://localhost:5173/");
          await warmPage
            .getByRole("button", { name: "로그인", exact: true })
            .waitFor();
        } finally {
          await warmPage.close();
        }
      }
      await runFixture();
    },
    { scope: "worker", auto: true },
  ],
  page: async ({ page }, runFixture) => {
    const mode = process.env.ISSUE91_MODE;
    if (mode === "auth-gate") {
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      await page.exposeFunction("__issue91AuthGate", () => gate);
      await page.route("**/src/services/mock/auth.ts", async (route) => {
        const response = await route.fetch();
        const body = await response.text();
        const needle = "async getCurrentAuthState({ signal } = {}) {";
        expect(body).toContain(needle);
        await route.fulfill({
          response,
          body: body.replace(
            needle,
            needle + "\n await window.__issue91AuthGate();",
          ),
        });
      });
      const originalPause = page.clock.pauseAt.bind(page.clock);
      page.clock.pauseAt = async (...args) => {
        const result = await originalPause(...args);
        release();
        await expect(page.getByRole("banner").getByRole("status")).toHaveCount(
          0,
        );
        return result;
      };
      try {
        await runFixture(page);
      } finally {
        release();
      }
      return;
    }
    if (mode === "stress" || mode === "stress-warm") {
      const session = await page.context().newCDPSession(page);
      await session.send("Emulation.setCPUThrottlingRate", {
        rate: Number(process.env.ISSUE91_CPU || 6),
      });
      await session.send("Network.enable");
      await session.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: Number(process.env.ISSUE91_LATENCY || 150),
        downloadThroughput: 1024 * 1024,
        uploadThroughput: 1024 * 1024,
      });
      await runFixture(page);
      await session.detach();
      return;
    }
    if (mode === "network-delay") {
      await page.route("**/*", async (route) => {
        if (route.request().isNavigationRequest())
          await delay(Number(process.env.ISSUE91_NAV_DELAY || 2000));
        await route.continue();
      });
    }
    await runFixture(page);
  },
});
