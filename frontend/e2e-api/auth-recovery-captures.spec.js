import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  prepareViewportCapture,
  viewports,
} from "./helpers.js";
import { proxyControl, serverControl } from "./fault-control.mjs";
import {
  API,
  key,
  login,
  password,
  proof,
  request,
  state,
} from "./auth-race-helpers.js";

async function capture(page, viewport, info, name) {
  // Remove focus only after asserting actual accessible errors/controls.
  await page.evaluate(() => document.activeElement?.blur());
  await prepareViewportCapture(page, viewport);
  await page.screenshot({
    path: info.outputPath(`${name}.png`),
    fullPage: true,
    animations: "disabled",
  });
}
test.beforeEach(async ({ page, context }) => {
  await blockExternalRequests(context);
  await page.clock.setFixedTime(new Date("2026-10-01T00:00:00Z"));
});
test.afterEach(async () => {
  await proxyControl({ action: "drop" });
  await serverControl({ action: "clock", at: null });
});
for (const viewport of viewports) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`integration recovery captures login ${size}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(page.locator("#login-id")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expect(page.locator("#login-password")).toHaveAttribute(
      "aria-describedby",
      "password-error",
    );
    await capture(page, viewport, info, "field-errors");
    await page.locator("#login-id").fill("member-a");
    await page.locator("#login-password").fill(password);
    await proxyControl({
      action: "arm",
      path: `${API}/login`,
      stage: "before_forward",
    });
    // Use the user's actual double-click: conceal/disabled controls handle the
    // second native event. Two synthetic submit events can call a stale handler
    // twice after its form has been removed and are not this interaction.
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .dblclick();
    await expect
      .poll(async () => (await proxyControl({ action: "status" })).held)
      .toBe(true);
    // The shell deliberately conceals the form while a member transition is pending.
    await expect(page.getByText("로그인 상태를 확인하고 있어요")).toBeVisible();
    await expect(page.locator("#login-id")).toHaveCount(0);
    expect(
      (await proxyControl({ action: "status" })).events.filter(
        (event) => event.path === `${API}/login` && event.stage === "ingress",
      ),
    ).toHaveLength(1);
    await capture(page, viewport, info, "in-flight");
    await proxyControl({ action: "release" });
    await expect(
      page.getByRole("banner").getByText("승인 회원", { exact: true }),
    ).toBeVisible();
    expect(
      (await proxyControl({ action: "status" })).events.filter(
        (event) =>
          event.path === `${API}/transitions` && event.stage === "ingress",
      ),
    ).toHaveLength(1);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(
      page
        .getByRole("banner")
        .getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    await page.route("**/api/v1/auth/transitions", (route) =>
      route.abort("failed"),
    );
    await page.locator("#login-id").fill("member-a");
    await page.locator("#login-password").fill(password);
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(page.getByText("인증 결과를 확인할 수 없어요")).toBeVisible();
    await capture(page, viewport, info, "network-unknown");
  });
  test(`integration recovery captures results ${size}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    // Monotonic HTTP journey begins 31m before the prescribed capture clock.
    // The captured unavailable result really succeeded and aged out; it is not
    // an invented never-admitted ID or a fabricated response.
    await serverControl({ action: "clock", at: "2026-09-30T23:29:00Z" });
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    const admitted = (await state(page)).body.next_transition_id;
    await login(page);
    await serverControl({ action: "clock", at: "2026-09-30T23:49:00Z" });
    const { flow, headers } = await proof(page, "session");
    const rotated = await request(
      page,
      `${API}/flows/${flow.flow_id}/recovery-cookie/rotate`,
      {
        expected_revision: flow.revision,
        expected_session_generation: flow.session_generation,
      },
      headers,
    );
    expect(rotated.status).toBe(201);
    const ready = await request(
      page,
      `${API}/flows/${flow.flow_id}/ready`,
      {
        expected_revision: rotated.body.revision,
      },
      {
        "X-EduVibe-Flow-Id": flow.flow_id,
        "X-CSRF-Token": rotated.body.recovery_csrf_token,
      },
    );
    expect(ready.status).toBe(200);
    await serverControl({ action: "clock", at: "2026-10-01T00:00:00Z" });
    const expired = (await state(page, admitted)).body;
    expect(expired.requested_transition).toMatchObject({
      availability: "unavailable",
      execution_blocked: true,
    });
    await page.evaluate(
      ({ key, flow, transitionId }) =>
        localStorage.setItem(
          key,
          JSON.stringify({
            flowId: flow.flow_id,
            revision: flow.revision,
            transitionId,
            progress: "executing",
          }),
        ),
      { key, flow: expired, transitionId: admitted },
    );
    await page.goto("/auth?mode=login");
    // The past result is unavailable, while execution_blocked=true authorizes
    // safe anonymous reentry. Capture the actual ready form without claiming
    // the unavailable operation failed or succeeded from this later response.
    await expect(page.locator("#login-id")).toBeVisible();
    await expect(
      page.getByRole("banner").getByText("승인 회원", { exact: true }),
    ).toHaveCount(0);
    await capture(page, viewport, info, "unavailable");
    await page.locator("#login-id").fill("member-a");
    await page.locator("#login-password").fill(password);
    await proxyControl({
      action: "arm",
      path: `${API}/login`,
      stage: "before_headers",
    });
    await page
      .locator("form")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect
      .poll(async () => (await proxyControl({ action: "status" })).held)
      .toBe(true);
    await proxyControl({ action: "drop" });
    await expect(
      page.getByRole("button", { name: "받지 못한 세션 버리기" }),
    ).toBeVisible();
    await capture(page, viewport, info, "missing-session");
  });
  test(`integration recovery captures reset ${size}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize(viewport);
    await login(page);
    await page.evaluate((key) => localStorage.removeItem(key), key);
    await page.goto("/auth?mode=login");
    await expect(
      page.getByRole("button", { name: "브라우저 인증 초기화" }),
    ).toBeVisible();
    await capture(page, viewport, info, "explicit-reset");
    // UI-only reset failure, labeled in the manifest. Real committed partial reset
    // is separately verified by auth-recovery-members with the streaming proxy.
    await page.route("**/api/v1/auth/flows/*/reset", (route) =>
      route.abort("failed"),
    );
    await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
    await expect(
      page.getByRole("button", { name: "브라우저 인증 초기화" }),
    ).toBeVisible();
    await expect(page.getByRole("alert").last()).toBeVisible();
    await capture(page, viewport, info, "reset-recheck");
    await page.unroute("**/api/v1/auth/flows/*/reset");
    await context.clearCookies();
  });
  test(`integration recovery captures budget ${size}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize(viewport);
    // Refuse initial preparation before any permit exists; the product error
    // card can safely give budget guidance. Execution refusal remains unresolved
    // until explicit settle in the separately verified real-cookie scenario.
    await context.addCookies(
      Array.from({ length: 8 }, (_, i) => ({
        name: `eduvibe_session_dev_00000000-0000-4000-8000-${String(i).padStart(12, "0")}_1`,
        value: "unknown",
        url: "http://localhost:5174",
        httpOnly: true,
        sameSite: "Lax",
      })),
    );
    await page.goto("/auth?mode=login");
    await expect(
      page.getByText("쿠키 공간을 확보한 뒤 다시 확인해 주세요."),
    ).toBeVisible();
    await capture(page, viewport, info, "cookie-budget");
  });
}
