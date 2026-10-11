import { expect, test as base } from "@playwright/test";
import { query } from "./helpers.js";
import { login } from "./approval-helpers.js";

export const test = base.extend({
  rateCleanup: [
    async ({ context }, use) => {
      const before = new Set(
        query("SELECT * FROM rate_limit_events").map((row) =>
          JSON.stringify(row),
        ),
      );
      try {
        await use();
      } finally {
        await context.close();
        for (const row of query("SELECT * FROM rate_limit_events"))
          if (!before.has(JSON.stringify(row)))
            query(`DELETE FROM rate_limit_events WHERE id=${Number(row[0])}`);
      }
    },
    { auto: true },
  ],
});
export async function loginMember(page) {
  await login(page, "member-a");
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}
