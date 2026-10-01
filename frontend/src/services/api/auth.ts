import {
  mapAnonymousSessionResult,
  mapAuthFlowCreated,
  mapAuthResult,
  mapAuthFlowState,
  mapAuthTransitionPermit,
  mapCsrfToken,
  mapFlowRevision,
  mapRecoveryContext,
  mapRecoveryCookieResult,
  mapRecoveryCsrf,
  mapRecoveryReady,
  mapRestartEligibility,
  mapSelf,
  mapRegisteredUser,
  mapSettledAuthTransition,
} from "../../contracts/mappers";
import { isUuid } from "../../contracts/uuid";
import { contractError } from "../service-error";
import type { AuthService, AuthRequestOptions } from "../auth-service";
import { ServiceError } from "../service-error";
import {
  observeApiAuth,
  prepareApiAuthFlow,
  recoverApiAuthFlow,
  runApiTransition,
} from "./auth-flow";
import { requestJson } from "./transport";

function checked<T>(mapper: (value: unknown) => T, value: unknown): T {
  try {
    return mapper(value);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "CONTRACT_ERROR")
      throw new ServiceError("CONTRACT_ERROR", error.message, {
        outcome: "unknown",
      });
    throw error;
  }
}

let selectedFlow: string | null = null;
const recoveryTokens = new Map<string, string>();

function unavailable(): ServiceError {
  return new ServiceError(
    "FEATURE_UNAVAILABLE",
    "회원 인증 실행은 아직 준비 중이에요.",
  );
}

function flowId(): string {
  if (selectedFlow) return selectedFlow;
  const saved = localStorage.getItem("eduvibe-auth-flow-v1");
  if (!saved) throw unavailable();
  try {
    const parsed = JSON.parse(saved);
    if (typeof parsed.flowId === "string") return parsed.flowId;
  } catch {
    /* Preserve damaged identifiers for explicit recovery. */
  }
  throw new ServiceError(
    "AUTH_STATE_CHANGED",
    "저장된 인증 흐름을 확인할 수 없어요.",
  );
}

async function read(
  path: `/auth/${string}`,
  options?: { signal?: AbortSignal },
  headers = new Headers(),
) {
  return requestJson(`GET ${path}`, path, { ...options, headers });
}
async function write(
  path: `/auth/${string}`,
  body?: unknown,
  token?: string,
  extra?: Record<string, string>,
) {
  const headers = new Headers(extra);
  if (token) headers.set("X-CSRF-Token", token);
  return requestJson(`POST ${path}`, path, {
    method: "POST",
    requestBody: body,
    headers,
    uncertain: true,
  });
}
// Member operations are bound to the current S, its CSRF and the spent permit.
async function memberHeaders(
  csrf: string,
  flow: string,
  revision: string,
  generation: string,
  transitionId: string,
) {
  return new Headers({
    "X-CSRF-Token": csrf,
    "X-EduVibe-Flow-Id": flow,
    "X-EduVibe-Auth-Revision": revision,
    "X-EduVibe-Session-Generation": generation,
    "X-EduVibe-Transition-Id": transitionId,
  });
}
async function recoveryToken(id: string) {
  return (
    recoveryTokens.get(id) ??
    (await authService.getRecoveryCsrf(id)).recoveryCsrfToken
  );
}

async function memberTransition(
  kind: "login" | "password_change",
  path: "/auth/login" | "/auth/password",
  body: unknown,
) {
  return runApiTransition(authService, kind, async (permit, state) => {
    if (!permit || state.sessionGeneration === null) throw contractError();
    const csrf = await authService.getCsrf();
    const value = (await requestJson(`POST ${path}`, path, {
      method: "POST",
      requestBody: body,
      headers: await memberHeaders(
        csrf.csrfToken,
        permit.flowId,
        permit.revision,
        state.sessionGeneration,
        permit.transitionId,
      ),
      uncertain: true,
      includeHeaders: true,
    })) as { body: unknown; headers: Headers };
    const result = checked(mapAuthResult, value.body);
    // A committed member transition rotates S: the reply must name a newer revision and generation.
    const revision = value.headers.get("X-EduVibe-Auth-Revision");
    const generation = value.headers.get("X-EduVibe-Session-Generation");
    if (
      value.headers.get("X-EduVibe-Flow-Id") !== permit.flowId ||
      !revision ||
      revision === permit.revision ||
      !generation ||
      generation === state.sessionGeneration
    )
      throw new ServiceError(
        "CONTRACT_ERROR",
        "인증 응답의 연결 정보를 확인할 수 없어요.",
        { outcome: "unknown" },
      );
    return result;
  });
}

export const authService: AuthService = {
  getCurrentAuthState(options) {
    return observeApiAuth(authService, options);
  },
  async getFlowState(transitionId, options) {
    const query = transitionId
      ? `?transition_id=${encodeURIComponent(transitionId)}`
      : "";
    return mapAuthFlowState(
      await read(
        `/auth/flow-state${query}`,
        options,
        new Headers({ "X-EduVibe-Flow-Id": flowId() }),
      ),
    );
  },
  async createFlow(input) {
    const result = checked(
      mapAuthFlowCreated,
      await write("/auth/flows", { restart_from: input.restartFrom }),
    );
    selectedFlow = result.flowId;
    return result;
  },
  async issueRecoveryCookie(id) {
    const result = checked(
      mapRecoveryCookieResult,
      await write(`/auth/flows/${id}/recovery-cookie`),
    );
    selectedFlow = id;
    recoveryTokens.set(id, result.recoveryCsrfToken);
    return result;
  },
  async confirmRecoveryCookie(id, input) {
    return checked(
      mapRecoveryReady,
      await write(
        `/auth/flows/${id}/ready`,
        { expected_revision: input.expectedRevision },
        await recoveryToken(id),
      ),
    );
  },
  async abandonFlow(id) {
    return checked(
      mapRestartEligibility,
      await write(`/auth/flows/${id}/abandon`),
    );
  },
  async getRecoveryContext(options) {
    return mapRecoveryContext(await read("/auth/recovery-context", options));
  },
  async getRecoveryCsrf(id, options) {
    selectedFlow = id;
    const result = mapRecoveryCsrf(
      await read(`/auth/flows/${id}/recovery-csrf`, options),
    );
    recoveryTokens.set(id, result.recoveryCsrfToken);
    return result;
  },
  async rotateRecoveryCookie(id, input, options) {
    selectedFlow = id;
    const csrf = await authService.getCsrf(options);
    const result = checked(
      mapRecoveryCookieResult,
      await write(
        `/auth/flows/${id}/recovery-cookie/rotate`,
        {
          expected_revision: input.expectedRevision,
          expected_session_generation: input.expectedSessionGeneration,
        },
        csrf.csrfToken,
      ),
    );
    recoveryTokens.set(id, result.recoveryCsrfToken);
    return result;
  },
  async getRestartEligibility(id, options) {
    return mapRestartEligibility(
      await read(`/auth/flows/${id}/restart-eligibility`, options),
    );
  },
  async admitTransition(input) {
    const result = await write(
      "/auth/transitions",
      {
        flow_id: input.flowId,
        transition_id: input.transitionId,
        kind: input.kind,
        expected_revision: input.expectedRevision,
        expected_session_generation: input.expectedSessionGeneration,
      },
      ["login", "logout", "password_change"].includes(input.kind)
        ? (await authService.getCsrf()).csrfToken
        : await recoveryToken(input.flowId),
    );
    return checked(mapAuthTransitionPermit, result);
  },
  async issueAnonymousSession(input) {
    const value = (await requestJson(
      "POST /auth/anonymous-session",
      "/auth/anonymous-session",
      {
        method: "POST",
        requestBody: { expected_revision: input.expectedRevision },
        headers: new Headers({
          "X-CSRF-Token": await recoveryToken(input.flowId),
          "X-EduVibe-Flow-Id": input.flowId,
          "X-EduVibe-Auth-Revision": input.expectedRevision,
          "X-EduVibe-Transition-Id": input.transitionId,
        }),
        uncertain: true,
        includeHeaders: true,
      },
    )) as { body: unknown; headers: Headers };
    const result = checked(mapAnonymousSessionResult, value.body);
    if (
      result.flowId !== input.flowId ||
      value.headers.get("X-EduVibe-Flow-Id") !== result.flowId ||
      value.headers.get("X-EduVibe-Auth-Revision") !== result.revision ||
      value.headers.get("X-EduVibe-Session-Generation") !==
        result.sessionGeneration
    )
      throw new ServiceError(
        "CONTRACT_ERROR",
        "인증 응답의 연결 정보를 확인할 수 없어요.",
        { outcome: "unknown" },
      );
    return result;
  },
  async settleTransition(id, input) {
    return checked(
      mapSettledAuthTransition,
      await write(
        `/auth/transitions/${id}/settle`,
        { flow_id: input.flowId, expected_revision: input.expectedRevision },
        await recoveryToken(input.flowId),
      ),
    );
  },
  async discardSession(id, input) {
    return checked(
      mapFlowRevision,
      await write(
        `/auth/transitions/${id}/discard-session`,
        {
          flow_id: input.flowId,
          expected_revision: input.expectedRevision,
          expected_session_generation: input.expectedSessionGeneration,
        },
        await recoveryToken(input.flowId),
      ),
    );
  },
  async resetFlow(id, input) {
    selectedFlow = id;
    const token = input.expectedSessionGeneration
      ? (await authService.getCsrf()).csrfToken
      : await recoveryToken(id);
    return checked(
      mapRestartEligibility,
      await write(
        `/auth/flows/${id}/reset`,
        {
          expected_revision: input.expectedRevision,
          ...(input.expectedSessionGeneration
            ? { expected_session_generation: input.expectedSessionGeneration }
            : {}),
        },
        token,
      ),
    );
  },
  async getCsrf(options) {
    if (!selectedFlow && !localStorage.getItem("eduvibe-auth-flow-v1"))
      throw unavailable();
    const id = flowId();
    const value = (await requestJson("GET /auth/csrf", "/auth/csrf", {
      ...options,
      headers: new Headers({ "X-EduVibe-Flow-Id": id }),
      includeHeaders: true,
    })) as { body: unknown; headers: Headers };
    const returnedId = value.headers.get("X-EduVibe-Flow-Id");
    const revision = value.headers.get("X-EduVibe-Auth-Revision");
    const sessionGeneration = value.headers.get("X-EduVibe-Session-Generation");
    if (
      returnedId !== id ||
      !isUuid(returnedId) ||
      !revision ||
      !/^(0|[1-9][0-9]*)$/.test(revision) ||
      !sessionGeneration ||
      !/^(0|[1-9][0-9]*)$/.test(sessionGeneration)
    )
      throw contractError();
    return {
      ...mapCsrfToken(value.body),
      authContext: { flowId: id, revision, sessionGeneration },
    };
  },
  async getMe(options) {
    const context = (await authService.getCsrf(options)).authContext;
    if (!context) throw contractError();
    const value = (await requestJson("GET /auth/me", "/auth/me", {
      ...options,
      headers: new Headers({
        "X-EduVibe-Flow-Id": context.flowId,
        "X-EduVibe-Auth-Revision": context.revision,
        "X-EduVibe-Session-Generation": context.sessionGeneration,
      }),
      includeHeaders: true,
    })) as { body: unknown; headers: Headers };
    if (
      value.headers.get("X-EduVibe-Flow-Id") !== context.flowId ||
      value.headers.get("X-EduVibe-Auth-Revision") !== context.revision ||
      value.headers.get("X-EduVibe-Session-Generation") !==
        context.sessionGeneration
    )
      throw contractError();
    return mapSelf(value.body);
  },
  async register(input) {
    const csrf = await authService.getCsrf();
    if (!csrf.authContext) throw contractError();
    const value = await write(
      "/auth/register",
      {
        login_id: input.loginId,
        password: input.password,
        nickname: input.nickname,
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
      csrf.csrfToken,
      {
        "X-EduVibe-Flow-Id": csrf.authContext.flowId,
        "X-EduVibe-Auth-Revision": csrf.authContext.revision,
        "X-EduVibe-Session-Generation": csrf.authContext.sessionGeneration,
      },
    );
    return checked(mapRegisteredUser, value);
  },
  async login(input) {
    return memberTransition("login", "/auth/login", {
      login_id: input.loginId,
      password: input.password,
    });
  },
  async changePassword(input) {
    return memberTransition("password_change", "/auth/password", {
      password: input.password,
    });
  },
  async reauthenticate() {
    throw unavailable();
  },
  async logout() {
    return runApiTransition(authService, "logout", async (permit, state) => {
      const headers =
        permit && state.sessionGeneration !== null
          ? await memberHeaders(
              (await authService.getCsrf()).csrfToken,
              permit.flowId,
              permit.revision,
              state.sessionGeneration,
              permit.transitionId,
            )
          : new Headers();
      await requestJson("POST /auth/logout", "/auth/logout", {
        method: "POST",
        headers,
        noContent: true,
        uncertain: true,
      });
    });
  },
};

export const prepareApiAuth = (options?: AuthRequestOptions) =>
  prepareApiAuthFlow(authService, options);
export const recoverApiAuth = (action: "settle" | "discard" | "reset") =>
  recoverApiAuthFlow(authService, action);
