import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  projects: [
    {
      name: "system-chrome",
      use: {
        channel: "chrome",
        headless: true,
      },
    },
  ],
});
