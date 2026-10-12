import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AUTH_FLOW_KEY,
  observeApiAuth,
  prepareApiAuthFlow,
  recoverApiAuthFlow,
} from "../src/services/api/auth-flow";
import type { AuthService } from "../src/services/auth-service";
import { ServiceError } from "../src/services/service-error";

const flowId = "00000000-0000-4000-8000-000000000232";
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    AUTH_FLOW_KEY,
    JSON.stringify({ flowId, revision: "4" }),
  );
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: () => Promise<unknown>,
      ) => callback(),
    },
  });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
function fixture(restartEligible = false) {
  const lost = new ServiceError("AUTH_REQUIRED", "proof missing");
  return {
    getRecoveryCsrf: vi.fn().mockRejectedValue(lost),
    getCsrf: vi.fn().mockRejectedValue(lost),
    getRestartEligibility: vi.fn().mockResolvedValue({ restartEligible }),
    getRecoveryContext: vi.fn().mockResolvedValue({ items: [] }),
    createFlow: vi
      .fn()
      .mockRejectedValue(new Error("explicit preparation reached")),
    login: vi.fn(),
    resetFlow: vi.fn(),
    abandonFlow: vi.fn(),
    getFlowState: vi.fn().mockResolvedValue({
      flowId,
      revision: "4",
      sessionGeneration: "2",
      lastIdentityChangeRevision: "3",
      sessionCookiePresent: false,
      recoveryReady: true,
      pendingTransition: null,
      requestedTransition: null,
    }),
  };
}
it("observes missing S with valid R as unresolved without issuing S or creating a flow", async () => {
  const service = fixture();
  service.getRecoveryCsrf.mockResolvedValue({ flowId, revision: "4" });
  await expect(
    observeApiAuth(service as unknown as AuthService),
  ).resolves.toMatchObject({
    status: "unresolved",
    user: null,
    sessionCookiePresent: false,
  });
  expect(service.getCsrf).not.toHaveBeenCalled();
  expect(service.createFlow).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(AUTH_FLOW_KEY)!)).toEqual({
    flowId,
    revision: "4",
  });
});
it.each([false, true])(
  "keeps an ID-only flow and requires explicit reset when eligibility=%s",
  async (eligible) => {
    const service = fixture(eligible);
    const auth = service as unknown as AuthService;
    await expect(observeApiAuth(auth)).rejects.toMatchObject({
      code: "AUTH_STATE_CHANGED",
    });
    await expect(prepareApiAuthFlow(auth)).rejects.toMatchObject({
      code: "AUTH_STATE_CHANGED",
    });
    expect(service.createFlow).not.toHaveBeenCalled();
    expect(service.login).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(AUTH_FLOW_KEY)!).flowId).toBe(
      flowId,
    );
    if (eligible) {
      await expect(recoverApiAuthFlow(auth, "reset")).rejects.toThrow(
        "explicit preparation reached",
      );
      expect(service.createFlow).toHaveBeenCalledWith({
        restartFrom: [flowId],
      });
    } else {
      await expect(recoverApiAuthFlow(auth, "reset")).rejects.toMatchObject({
        code: "AUTH_REQUIRED",
      });
      expect(service.createFlow).not.toHaveBeenCalled();
      expect(service.resetFlow).not.toHaveBeenCalled();
      expect(service.abandonFlow).not.toHaveBeenCalled();
    }
    expect(service.login).not.toHaveBeenCalled();
  },
);
