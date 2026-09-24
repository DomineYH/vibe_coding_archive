import { test, expect } from "@playwright/test";

test("browser launches and executes javascript", async ({ page }) => {
  await page.setContent("<html><body><h1>EduVibe E2E Smoke</h1></body></html>");
  const heading = page.locator("h1");
  await expect(heading).toHaveText("EduVibe E2E Smoke");
});
