import { afterEach, expect, it, vi } from "vitest";
import { appsService as apiApps } from "../src/services/api/apps";
import { appsService as mockApps } from "../src/services/mock/apps";
import { healthService as apiHealth } from "../src/services/api/health";
import { healthService as mockHealth } from "../src/services/mock/health";
import { authService } from "../src/services/mock/auth";
import { captureAuthObservation } from "../src/services/auth-state";
import { resetMockState } from "../src/services/mock/state";

const id = "00000000-0000-4000-8000-000000000001";
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it.each([apiApps, mockApps])(
  "rejects detail without a captured member before lookup",
  async (apps) => {
    resetMockState();
    vi.stubGlobal("fetch", vi.fn());
    await expect(apps.get(id)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);

it.each([apiHealth, mockHealth])(
  "rejects anonymous health reads, jobs and requests before lookup",
  async (health) => {
    resetMockState();
    vi.stubGlobal("fetch", vi.fn());
    for (const target of [id, "00000000-0000-4000-8000-000000000099"]) {
      await expect(health.getAppHealth(target)).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
      });
      await expect(health.getJob(target)).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
        httpStatus: 401,
      });
    }
    await expect(health.requestCheck(id)).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
    expect(fetch).not.toHaveBeenCalled();
  },
);

it("mock public detail requires a full member and rejects a stale captured identity", async () => {
  resetMockState();
  const anonymous = captureAuthObservation(
    await authService.getCurrentAuthState(),
    () => true,
  );
  await expect(
    mockApps.get(id, { readContext: anonymous }),
  ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
  await authService.login({ loginId: "교사김코딩", password: "1234" });
  const context = captureAuthObservation(
    await authService.getCurrentAuthState(),
    () => true,
  );
  await expect(
    mockApps.get(id, { readContext: context }),
  ).resolves.toMatchObject({ id, isPublic: true });
  await authService.logout();
  await expect(
    mockApps.get(id, { readContext: context }),
  ).rejects.toMatchObject({ name: "AbortError" });
});

it.each([
  { approved: false },
  { sessionKind: "change_only", mustChangePassword: true },
])(
  "rejects public detail for a non-full member observation %j",
  async (override) => {
    resetMockState();
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    const state = await authService.getCurrentAuthState();
    const context = captureAuthObservation(
      { ...state, user: { ...state.user!, ...override } } as typeof state,
      () => true,
    );
    vi.stubGlobal("fetch", vi.fn());
    for (const service of [apiApps, mockApps])
      await expect(
        service.get(id, { readContext: context }),
      ).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
    expect(fetch).not.toHaveBeenCalled();
  },
);
