import { defineConfig } from "@playwright/test";
import { chromiumExecutable } from "./playwright-browser.js";

export default defineConfig({
  testDir: "./e2e-api",
  testIgnore:
    process.env.API_E2E_AUTH_BOUNDARY === "prepared"
      ? []
      : ["**/auth-races*.spec.js", "**/auth-recovery*.spec.js"],
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
      command:
        process.env.API_E2E_FAULTS === "1"
          ? "node e2e-api/auth-fault-launcher.mjs"
          : `uv run --frozen uvicorn ${process.env.API_E2E_AUTH_BOUNDARY === "prepared" ? "tests.auth_server" : "app.main"}:app --host 127.0.0.1 --port 8000`,
      cwd: process.env.API_E2E_FAULTS === "1" ? "." : "../backend",
      url: "http://127.0.0.1:8000/healthz",
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command:
        process.env.API_E2E_FAULTS === "1"
          ? "node node_modules/vite/bin/vite.js --config e2e-api/vite-fault.config.mjs --host localhost --port 5174 --strictPort"
          : "npm run dev:api",
      cwd: ".",
      url: "http://localhost:5174/",
      reuseExistingServer: false,
      timeout: 120000,
      env: { ...process.env, VITE_DATA_MODE: "api" },
    },
  ],
});
