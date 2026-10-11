import { afterEach, expect, it, vi } from "vitest";
import { healthService } from "../src/services/api/health";
import { authService } from "../src/services/api/auth";

const app = "00000000-0000-4000-8000-000000000001";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("rejects a fresh visitor without preparing anonymous proof or sending a check", async () => {
  localStorage.clear();
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await expect(healthService.requestCheck(app)).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
    httpStatus: 401,
  });
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves an existing anonymous recovery record without sending a check", async () => {
  const record = JSON.stringify({
    flowId: "00000000-0000-4000-8000-000000000115",
    revision: "4",
  });
  localStorage.setItem("eduvibe-auth-flow-v1", record);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue({
    user: null,
    status: "ready",
    sessionCookiePresent: true,
    observationGeneration: 0,
    unresolvedTransitionId: null,
    flow: {
      flowId: "00000000-0000-4000-8000-000000000115",
      revision: "4",
      sessionGeneration: "1",
      lastIdentityChangeRevision: "0",
    },
  });
  await expect(healthService.requestCheck(app)).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
    httpStatus: 401,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem("eduvibe-auth-flow-v1")).toBe(record);
});
