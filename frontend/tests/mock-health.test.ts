import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { authService } from "../src/services/mock/auth";
import { healthService } from "../src/services/mock/health";
import type { components } from "../src/contracts/api";
import {
  getMockSnapshot,
  resetMockState,
  setMockClock,
  setMockScenario,
  updateMockApp,
} from "../src/services/mock/state";

const appId = "00000000-0000-4000-8000-000000000001";
const privateAppId = "00000000-0000-4000-8000-000000000091";

describe("individual health check mock", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockState();
  });

  afterEach(() => {
    resetMockState();
    localStorage.clear();
  });

  it("reads without starting work and accepts an anonymous public check", async () => {
    const before = await healthService.getAppHealth(appId);
    expect(before.health.latestJob).toBeNull();
    expect(before.health.result.state).toBe("healthy");

    const accepted = await healthService.requestCheck(appId);
    expect(accepted).toMatchObject({
      disposition: "created",
      health: { latestJob: { status: "running" } },
    });
  });

  it("reuses a fresh completed result during the app cooldown", async () => {
    setMockScenario("health_app_cooldown");

    await expect(healthService.requestCheck(appId)).resolves.toMatchObject({
      disposition: "result_reused",
      health: { result: { state: "healthy" }, latestJob: null },
    });
  });

  it("returns technical measurements only to administrators", async () => {
    setMockScenario("health_result_healthy");
    const accepted = await healthService.requestCheck(appId);
    await healthService.getJob(accepted.health.latestJob!.id);
    await expect(healthService.getAppHealth(appId)).resolves.toMatchObject({
      health: { result: { state: "healthy" } },
    });
    const anonymous = await healthService.getAppHealth(appId);
    expect(anonymous.health.result).not.toHaveProperty("http_status");

    await authService.login({ loginId: "admin", password: "admin123" });
    await expect(healthService.getAppHealth(appId)).resolves.toMatchObject({
      health: {
        result: {
          http_status: 204,
          response_ms: 26,
          error_kind: null,
          error_stage: null,
        },
      },
    });
  });

  it.each([
    ["health_result_healthy", "healthy", 204],
    ["health_result_http_error", "http_error", 404],
    ["health_result_timeout", "timeout", null],
    ["health_result_network_error", "network_error", null],
    ["health_result_blocked", "blocked", null],
    ["health_result_redirect_error", "redirect_error", 302],
  ] as const)(
    "shows synthetic %s result without treating it as real traffic",
    async (scenario, state, httpStatus) => {
      setMockScenario(scenario);
      const { health } = await healthService.requestCheck(appId);
      const completed = await healthService.getJob(health.latestJob!.id);

      expect(completed.job.status).toBe("completed");
      expect(completed.health.result.state).toBe(state);
      await expect(healthService.getAppHealth(appId)).resolves.toMatchObject({
        health: {
          result: { state, fresh_until: "2026-09-22T00:27:00.000Z" },
        },
      });
      expect(getMockSnapshot().health_measurements[0]?.http_status).toBe(
        httpStatus,
      );
    },
  );

  it.each([
    ["health_job_failed", "failed"],
    ["health_job_cancelled", "cancelled"],
  ] as const)(
    "preserves the last result when work is %s",
    async (scenario, status) => {
      const before = await healthService.getAppHealth(appId);
      const accepted = await healthService.requestCheck(appId);
      setMockScenario(scenario);

      const completed = await healthService.getJob(
        accepted.health.latestJob!.id,
      );
      expect(completed.job.status).toBe(status);
      expect(completed.health.result).toEqual(before.health.result);
    },
  );

  it("returns active work and limits requests to ten per actor per minute", async () => {
    const first = await healthService.requestCheck(appId);
    await expect(healthService.requestCheck(appId)).resolves.toMatchObject({
      disposition: "active_reused",
    });
    for (let request = 2; request < 10; request += 1)
      await healthService.requestCheck(appId);

    await expect(healthService.requestCheck(appId)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      reasons: ["actor_rate_limit"],
      retryAt: "2026-09-22T00:13:00.000Z",
    });
    expect(first.disposition).toBe("created");
  });

  it("rejects stale-result reuse during app cooldown at the exact freshness boundary", async () => {
    setMockClock("2026-09-22T00:27:00.000Z");
    setMockScenario("health_app_cooldown");

    await expect(healthService.requestCheck(appId)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      reasons: ["app_cooldown"],
      retryAt: "2026-09-22T00:28:00.000Z",
    });
  });

  it("blocks change-only sessions and reports unavailable capability", async () => {
    await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });
    await expect(healthService.requestCheck(appId)).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
      httpStatus: 403,
    });

    await authService.logout();
    setMockScenario("health_check_unavailable");
    await expect(healthService.requestCheck(appId)).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("requires the current private-app read permission", async () => {
    await expect(
      healthService.getAppHealth(privateAppId),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    await expect(
      healthService.getAppHealth(privateAppId),
    ).resolves.toMatchObject({ appId: privateAppId });
    await authService.logout();
    await authService.login({ loginId: "과학덕후박샘", password: "1234" });
    await expect(
      healthService.getAppHealth(privateAppId),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("does not apply a late job response after the app URL version changes", async () => {
    setMockScenario("health_late_response");
    const accepted = await healthService.requestCheck(appId);
    const jobId = accepted.health.latestJob!.id;
    const pending = healthService.getJob(jobId);
    const app = getMockSnapshot().apps.find((item) => item.id === appId)!;
    setTimeout(() => {
      const changed = {
        ...app,
        url_version: app.url_version + 1,
        health: {
          ...app.health,
          result: {
            state: "unchecked" as const,
            checked_at: null,
            fresh_until: null,
          },
          latest_job: null,
        },
      } as components["schemas"]["AppDetail"];
      updateMockApp(changed);
    }, 10);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(
      getMockSnapshot().apps.find((item) => item.id === appId),
    ).toMatchObject({
      url_version: app.url_version + 1,
      health: { result: { state: "unchecked" }, latest_job: null },
    });
  });
});
