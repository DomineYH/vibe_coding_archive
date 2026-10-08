import { defineConfig } from "@playwright/test";
import { chromiumExecutable } from "./playwright-browser.js";

if (process.env.APP_ENV !== "test") {
  throw new Error(
    "API E2E requires APP_ENV=test in the process environment. Use npm run test:e2e:api for isolated settings.",
  );
}

const nginx = process.env.API_E2E_NGINX === "1";

export default defineConfig({
  testDir: "./e2e-api",
  ...(nginx ? { testMatch: "**/static-serving.spec.js" } : {}),
  testIgnore: nginx
    ? []
    : [
        "**/static-serving.spec.js",
        ...(process.env.API_E2E_AUTH_BOUNDARY === "prepared"
          ? []
          : ["**/auth-races*.spec.js", "**/auth-recovery*.spec.js"]),
      ],
  outputDir: "test-results/api",
  fullyParallel: false,
  workers: 1,
  timeout: nginx ? 120000 : 30000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: nginx ? "https://localhost:8443" : "http://localhost:5174",
    ...(nginx
      ? {
          ignoreHTTPSErrors: true,
          trace: "off",
          screenshot: "off",
          video: "off",
        }
      : {}),
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
      command: nginx
        ? "node scripts/nginx-serving.mjs --upstream"
        : process.env.API_E2E_FAULTS === "1"
          ? "node e2e-api/auth-fault-launcher.mjs"
          : `uv run --frozen uvicorn ${process.env.API_E2E_HEALTH === "1" ? "tests.health_server" : process.env.API_E2E_AUTH_BOUNDARY === "prepared" ? "tests.auth_server" : "app.main"}:app --host 127.0.0.1 --port 8000`,
      cwd: nginx
        ? "."
        : process.env.API_E2E_FAULTS === "1"
          ? "."
          : "../backend",
      url: "http://127.0.0.1:8000/healthz",
      ...(nginx
        ? { gracefulShutdown: { signal: "SIGTERM", timeout: 10000 } }
        : {}),
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: nginx
        ? "node scripts/nginx-serving.mjs"
        : process.env.API_E2E_FAULTS === "1"
          ? "node node_modules/vite/bin/vite.js --config e2e-api/vite-fault.config.mjs --host localhost --port 5174 --strictPort"
          : "npm run dev:api",
      cwd: ".",
      url: nginx ? "https://localhost:8443/" : "http://localhost:5174/",
      ...(nginx ? { ignoreHTTPSErrors: true } : {}),
      ...(nginx
        ? { gracefulShutdown: { signal: "SIGTERM", timeout: 10000 } }
        : {}),
      reuseExistingServer: false,
      timeout: 120000,
      env: { ...process.env, VITE_DATA_MODE: "api" },
    },
  ],
});
