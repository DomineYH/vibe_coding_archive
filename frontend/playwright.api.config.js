import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-api",
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
  },
  webServer: [
    {
      command:
        "uv run --frozen uvicorn app.main:app --host 127.0.0.1 --port 8000",
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
