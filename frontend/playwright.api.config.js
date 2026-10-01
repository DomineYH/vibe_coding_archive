import { defineConfig } from "@playwright/test";
import { chromiumExecutable } from "./playwright-browser.js";

export default defineConfig({
  testDir: "./e2e-api",
  outputDir: "test-results/api",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://localhost:5174",
    locale: "ko-KR",
    timezoneId: "Asia/Seoul",
    deviceScaleFactor: 1,
    reducedMotion: "reduce",
    colorScheme: "light",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: chromiumExecutable(),
            args: ["--force-color-profile=srgb", "--disable-partial-raster"],
          },
        }
      : {}),
  },
  webServer: [
    {
      command: `uv run --frozen uvicorn ${process.env.API_E2E_AUTH_BOUNDARY === "prepared" ? "tests.auth_server" : "app.main"}:app --host 127.0.0.1 --port 8000`,
      cwd: "../backend",
      url: "http://127.0.0.1:8000/healthz",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: "npm run dev:api",
      cwd: ".",
      url: "http://localhost:5174/",
      reuseExistingServer: false,
      timeout: 120000,
      env: { ...process.env, VITE_DATA_MODE: "api" },
    },
  ],
});
