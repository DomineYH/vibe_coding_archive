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
it("keeps an ID-only flow and requires explicit reset when eligibility=false", async () => {
  const service = fixture(false);
  const auth = service as unknown as AuthService;
  await expect(observeApiAuth(auth)).rejects.toMatchObject({
    code: "AUTH_STATE_CHANGED",
  });
  await expect(prepareApiAuthFlow(auth)).rejects.toMatchObject({
    code: "AUTH_STATE_CHANGED",
  });
  expect(service.createFlow).not.toHaveBeenCalled();
  expect(service.login).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(AUTH_FLOW_KEY)!).flowId).toBe(flowId);
  await expect(recoverApiAuthFlow(auth, "reset")).rejects.toMatchObject({
    code: "AUTH_REQUIRED",
  });
  expect(service.createFlow).not.toHaveBeenCalled();
  expect(service.resetFlow).not.toHaveBeenCalled();
  expect(service.abandonFlow).not.toHaveBeenCalled();
  expect(service.login).not.toHaveBeenCalled();
});
const newId = "00000000-0000-4000-8000-000000000307";
function replacement(service: ReturnType<typeof fixture>) {
  service.createFlow.mockResolvedValue({ flowId: newId, revision: "0" });
  Object.assign(service, {
    issueRecoveryCookie: vi.fn().mockResolvedValue({ revision: "1" }),
    confirmRecoveryCookie: vi.fn().mockResolvedValue(undefined),
  });
  service.getFlowState.mockResolvedValue({
    flowId: newId,
    revision: "2",
    sessionGeneration: null,
    lastIdentityChangeRevision: "0",
    sessionCookiePresent: false,
    recoveryReady: true,
    nextTransitionId: `${newId}.2`,
    pendingTransition: null,
    requestedTransition: null,
  });
  return service as unknown as AuthService;
}
it("replaces an ended flow automatically when eligibility=true", async () => {
  const service = fixture(true);
  await expect(observeApiAuth(replacement(service))).resolves.toMatchObject({
    status: "ready",
    user: null,
    flow: { flowId: newId, sessionGeneration: null },
  });
  expect(service.createFlow).toHaveBeenCalledWith({ restartFrom: [flowId] });
  expect(service.abandonFlow).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(AUTH_FLOW_KEY)!)).toEqual({
    flowId: newId,
    revision: "2",
  });
  expect(service.login).not.toHaveBeenCalled();
});
it("abandons a half-prepared ended flow before replacing it", async () => {
  localStorage.setItem(
    AUTH_FLOW_KEY,
    JSON.stringify({ flowId, revision: "4", progress: "preparing" }),
  );
  const service = fixture(false);
  service.abandonFlow.mockResolvedValue({ restartEligible: true });
  await expect(observeApiAuth(replacement(service))).resolves.toMatchObject({
    status: "ready",
    flow: { flowId: newId },
  });
  expect(service.abandonFlow).toHaveBeenCalledWith(flowId);
  expect(service.abandonFlow.mock.invocationCallOrder[0]).toBeLessThan(
    service.createFlow.mock.invocationCallOrder[0],
  );
  expect(service.createFlow).toHaveBeenCalledWith({ restartFrom: [flowId] });
});
it("keeps the ended flow when its replacement cannot be created", async () => {
  const service = fixture(true);
  const failure = new ServiceError("NETWORK_ERROR", "offline");
  replacement(service);
  service.createFlow.mockRejectedValue(failure);
  await expect(observeApiAuth(service as unknown as AuthService)).rejects.toBe(
    failure,
  );
  expect(JSON.parse(localStorage.getItem(AUTH_FLOW_KEY)!)).toEqual({
    flowId,
    revision: "4",
  });
  expect(service.getRestartEligibility).toHaveBeenCalledTimes(1);
});
const preparing = { flowId, revision: "4", progress: "preparing" };
it.each(["AUTH_REQUIRED", "RECOVERY_REQUIRED"])(
  "replaces a purged half-prepared flow when abandon answers %s",
  async (code) => {
    localStorage.setItem(AUTH_FLOW_KEY, JSON.stringify(preparing));
    const service = fixture(true);
    service.abandonFlow.mockRejectedValue(new ServiceError(code, "gone"));
    await expect(observeApiAuth(replacement(service))).resolves.toMatchObject({
      status: "ready",
      user: null,
      flow: { flowId: newId, sessionGeneration: null },
    });
    expect(service.getRestartEligibility).toHaveBeenCalledWith(
      flowId,
      undefined,
    );
    expect(service.createFlow).toHaveBeenCalledWith({ restartFrom: [flowId] });
  },
);
it("keeps an ever-ready preparing flow when abandon is refused and eligibility=false", async () => {
  localStorage.setItem(AUTH_FLOW_KEY, JSON.stringify(preparing));
  const service = fixture(false);
  service.abandonFlow.mockRejectedValue(
    new ServiceError("AUTH_STATE_CHANGED", "ever ready"),
  );
  await expect(observeApiAuth(replacement(service))).rejects.toMatchObject({
    code: "AUTH_STATE_CHANGED",
    message:
      "인증 증명을 잃었어요. 이전 흐름이 종료될 때까지 공개 열람만 가능합니다.",
  });
  expect(service.createFlow).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(AUTH_FLOW_KEY)!)).toEqual(preparing);
});
