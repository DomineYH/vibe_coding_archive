import { expect, test } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";

test("R23-17 ID-only proof cannot reset an active flow", async ({
  page,
  context,
}) => {
  expect(process.env.API_E2E_AUTH_BOUNDARY).toBe("prepared");
  await blockExternalRequests(context);
  await page.goto("/auth?mode=login");
  await expect(page.locator("#login-id")).toBeVisible();
  const flowId = await page.evaluate(
    () => JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")).flowId,
  );
  const revision = await page.evaluate(async (id) => {
    const state = await fetch("/api/v1/auth/flow-state", {
      headers: { "X-EduVibe-Flow-Id": id },
    }).then((response) => response.json());
    return state.revision;
  }, flowId);
  await context.clearCookies(); // explicitly simulated proof loss, not natural eviction
  const observed = await page.evaluate(
    async ({ id, revision }) => {
      const eligible = await fetch(
        `/api/v1/auth/flows/${id}/restart-eligibility`,
      ).then((r) => r.json());
      const reset = await fetch(`/api/v1/auth/flows/${id}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expected_revision: revision }),
      });
      return { eligible, resetStatus: reset.status };
    },
    { id: flowId, revision },
  );
  expect(observed).toEqual({
    eligible: { restart_eligible: false },
    resetStatus: 401,
  });
  await page.reload();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await expect(
    page.getByText(
      "인증 증명을 잃었어요. 이전 흐름이 종료될 때까지 공개 열람만 가능합니다.",
    ),
  ).toBeVisible();
});
