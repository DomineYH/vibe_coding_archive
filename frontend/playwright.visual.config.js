import { defineConfig } from "@playwright/test";
import { chromiumExecutable } from "./playwright-browser.js";

export default defineConfig({
  testDir: "./visual",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  reporter: "list",
  outputDir: "test-results/visual",
  use: {
    baseURL: "http://localhost:5173",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
    serviceWorkers: "block",
    trace: { mode: "retain-on-failure", screenshots: false },
    launchOptions: {
      executablePath: chromiumExecutable(),
      // Partial tile reuse can vary rounded edges by 1–2 channel values between captures.
      args: ["--force-color-profile=srgb", "--disable-partial-raster"],
    },
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
