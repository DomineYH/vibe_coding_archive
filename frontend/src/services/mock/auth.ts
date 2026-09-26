import {
  mapAnonymousSessionResult,
  mapAuthResult,
  mapAuthFlowCreated,
  mapAuthFlowContext,
  mapAuthFlowState,
  mapAuthTransitionPermit,
  mapFlowRevision,
  mapRecoveryContext,
  mapRecoveryCookieResult,
  mapRecoveryCsrf,
  mapRecoveryReady,
  mapRestartEligibility,
  mapSettledAuthTransition,
  mapCsrfToken,
  mapRegisteredUser,
  mapSelf,
} from "../../contracts/mappers";
import type { AuthTransitionKind } from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import type {
  AuthChangePasswordInput,
  AuthRegisterInput,
  AuthService,
} from "../auth-service";
import { mockMetaWire } from "./apps";
import { DEMO_ACCOUNTS } from "./accounts";
import {
  addMockRegisteredAccount,
  abandonMockAuthFlow,
  commitMockAnonymousSession,
  assertCurrentGeneration,
  completeMockReauthentication,
  confirmMockRecoveryCookie,
  completeMockPasswordChange,
  createMockAuthFlow,
  discardMockAuthSession,
  getMockNow,
  getMockAccounts,
  getMockSnapshot,
  getMockAuthFlowState,
  getMockRecoveryContext,
  getMockRecoveryCsrf,
  getMockRestartEligibility,
  admitMockAuthTransition,
  issueMockRecoveryCookie,
  resetMockAuthFlow,
  rotateMockRecoveryCookie,
  settleMockAuthTransition,
  finishMockAuthTransition,
  setMockPrincipal,
  MOCK_AUTH_STATE_EVENT,
  type MockPrincipalSession,
  type MockRegisteredAccount,
} from "./state";

const csrfExpiresAt = "2026-09-22T00:27:00.000Z";

function authRequired(): ServiceError {
  return new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
    httpStatus: 401,
    outcome: "rejected",
  });
}

type MockAccount = ReturnType<typeof getMockAccounts>[number];

function asSelf(account: MockAccount, session: MockPrincipalSession) {
  return {
    id: account.id,
    login_id: account.loginId,
    nickname: account.nickname,
    role: account.role,
    approved: account.approved,
    must_change_password: account.mustChangePassword,
    session_kind: session.session_kind,
    expires_at: session.expires_at,
    ...(session.session_kind === "full"
      ? {
          email: null,
          phone: null,
          recent_auth_until: session.recent_auth_until,
        }
      : {}),
  };
}

function accountFromState(state: ReturnType<typeof getMockSnapshot>) {
  const principalId = state.principal_id;
  return getMockAccounts(state, true).find((item) => item.id === principalId);
}

function isExpired(
  account: MockAccount,
  session: MockPrincipalSession,
  now: string,
) {
  return (
    Date.parse(now) >= Date.parse(session.expires_at) ||
    (account.mustChangePassword &&
      (!account.temporaryPasswordExpiresAt ||
        Date.parse(now) >= Date.parse(account.temporaryPasswordExpiresAt)))
  );
}

function fullSession(now: string): MockPrincipalSession {
  return {
    session_kind: "full",
    expires_at: new Date(Date.parse(now) + 8 * 60 * 60 * 1000).toISOString(),
    recent_auth_until: null,
  };
}

function changeOnlySession(
  now: string,
  temporaryPasswordExpiresAt: string,
): MockPrincipalSession {
  return {
    session_kind: "change_only",
    expires_at: new Date(
      Math.min(
        Date.parse(now) + 15 * 60 * 1000,
        Date.parse(temporaryPasswordExpiresAt),
      ),
    ).toISOString(),
    recent_auth_until: null,
  };
}

function checkSignal(signal?: AbortSignal) {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Request aborted", "AbortError");
}

function unavailable(): ServiceError {
  return new ServiceError(
    "SERVICE_UNAVAILABLE",
    "로그인하지 못했어요. 연결을 확인해 주세요.",
    { httpStatus: 503 },
  );
}

function unknownAuthOutcome(): ServiceError {
  return new ServiceError(
    "NETWORK_ERROR",
    "이전 인증 요청의 결과를 확인할 수 없습니다. 공개 열람은 계속할 수 있어요.",
    { outcome: "unknown" },
  );
}

function waitForAuthGate(expectedGeneration: number): Promise<void> {
  const state = getMockSnapshot();
  if (state.auth_flow.gate_open) return Promise.resolve();
  if (state.scenario !== "auth_transition_gate") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      window.removeEventListener("eduvibe:mock-auth-gate-open", inspect);
      window.removeEventListener("eduvibe:mock-reset", reset);
      window.removeEventListener(MOCK_AUTH_STATE_EVENT, inspect);
      window.removeEventListener("storage", storage);
    };
    const reset = () => {
      cleanup();
      reject(new DOMException("Mock auth transition reset", "AbortError"));
    };
    const inspect = () => {
      try {
        const latest = getMockSnapshot();
        if (latest.generation !== expectedGeneration) return reset();
        if (!latest.auth_flow.gate_open) return;
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === "eduvibe-archive-mock-v1") inspect();
    };
    window.addEventListener("eduvibe:mock-auth-gate-open", inspect);
    window.addEventListener("eduvibe:mock-reset", reset);
    window.addEventListener(MOCK_AUTH_STATE_EVENT, inspect);
    window.addEventListener("storage", storage);
    inspect();
  });
}

async function runAuthTransition<T>(
  kind: AuthTransitionKind,
  execute: (input: {
    transitionId: string;
    generation: number;
    scenario: ReturnType<typeof getMockSnapshot>["scenario"];
  }) => { value: T; identityChanged?: boolean },
  expected?: { flowId: string; expectedRevision: string; transitionId: string },
): Promise<T> {
  const before = getMockSnapshot();
  const flow = before.auth_flow;
  const transitionId =
    expected?.transitionId ?? `${flow.flow_id}.${flow.revision}`;
  admitMockAuthTransition({
    flowId: expected?.flowId ?? flow.flow_id,
    transitionId,
    kind,
    expectedRevision: expected?.expectedRevision ?? flow.revision,
    expectedSessionGeneration: flow.session_generation,
  });
  const admitted = getMockSnapshot();
  const simulatedAuthRequest = kind !== "anonymous_session";
  try {
    if (simulatedAuthRequest) await waitForAuthGate(admitted.generation);
    if (simulatedAuthRequest && admitted.scenario === "auth_delayed") {
      await new Promise((resolve) =>
        setTimeout(resolve, kind === "login" ? 1000 : 300),
      );
      assertCurrentGeneration(admitted.generation);
    }
    if (simulatedAuthRequest && admitted.scenario === "auth_network_error")
      throw unavailable();
    const current = getMockSnapshot();
    assertCurrentGeneration(admitted.generation);
    const outcome = execute({
      transitionId,
      generation: current.generation,
      scenario: current.scenario,
    });
    const latest = getMockSnapshot();
    const loseResult =
      simulatedAuthRequest && admitted.scenario === "auth_result_unavailable";
    const lostCookie =
      simulatedAuthRequest &&
      admitted.scenario === "auth_session_cookie_lost" &&
      (kind === "login" || kind === "password_change");
    const responseLost =
      simulatedAuthRequest &&
      (loseResult || lostCookie || admitted.scenario === "auth_response_lost");
    finishMockAuthTransition({
      transitionId,
      expectedGeneration: latest.generation,
      state: "succeeded",
      resultSessionGeneration: latest.auth_flow.session_generation,
      identityChanged: outcome.identityChanged,
      loseResult,
      responseLost,
    });
    if (responseLost) throw unknownAuthOutcome();
    if (kind === "anonymous_session" && outcome.value !== null) {
      const finalFlow = getMockSnapshot().auth_flow;
      return {
        ...(outcome.value as object),
        revision: finalFlow.revision,
      } as T;
    }
    return outcome.value;
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      const current = getMockSnapshot();
      if (current.auth_flow.pending_transition?.transition_id === transitionId)
        finishMockAuthTransition({
          transitionId,
          expectedGeneration: current.generation,
          state: "failed",
          failureCode:
            error instanceof ServiceError ? error.code : "AUTH_REQUEST_FAILED",
        });
    }
    throw error;
  }
}

function invalidRegistration(fields: Record<string, string>): ServiceError {
  return new ServiceError("VALIDATION_ERROR", "입력값을 확인해 주세요.", {
    httpStatus: 422,
    outcome: "rejected",
    fields,
  });
}

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function normalizeRegistration(input: AuthRegisterInput) {
  const fields: Record<string, string> = {};
  const loginId =
    typeof input?.loginId === "string"
      ? input.loginId.trim().normalize("NFC")
      : "";
  const password =
    typeof input?.password === "string" ? input.password.normalize("NFC") : "";
  const nickname =
    typeof input?.nickname === "string"
      ? input.nickname.trim().normalize("NFC")
      : "";

  if (
    codePointLength(loginId) < 2 ||
    codePointLength(loginId) > 32 ||
    !/^[가-힣A-Za-z0-9_.-]+$/u.test(loginId)
  )
    fields.login_id = "로그인 아이디를 확인해 주세요.";
  if (codePointLength(password) < 15 || codePointLength(password) > 128)
    fields.password = "비밀번호는 15~128자로 입력해 주세요.";
  if (
    codePointLength(nickname) < 2 ||
    codePointLength(nickname) > 20 ||
    /[\p{Cc}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(
      nickname,
    ) ||
    !nickname.replace(/[\p{White_Space}\p{Cf}\p{Cc}\p{M}]/gu, "")
  )
    fields.nickname = "별명을 확인해 주세요.";

  const email = normalizeEmail(input?.email, fields);
  const phone = normalizePhone(input?.phone, fields);
  if (email && mockMetaWire.capabilities.email_collection.enabled !== true)
    fields.email = "현재 이메일 수집 기능은 비활성화되어 있어 비워 주세요.";
  if (phone && mockMetaWire.capabilities.phone_collection.enabled !== true)
    fields.phone = "현재 연락처 수집 기능은 비활성화되어 있어 비워 주세요.";
  if (Object.keys(fields).length) throw invalidRegistration(fields);

  return { loginId, password, nickname, email, phone };
}

function normalizeEmail(
  input: string | null | undefined,
  fields: Record<string, string>,
): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") {
    fields.email = "이메일 주소를 확인해 주세요.";
    return null;
  }
  const value = input.trim();
  if (!value) return null;
  const separator = value.indexOf("@");
  const local = value.slice(0, separator);
  const domain = value.slice(separator + 1);
  const labels = domain.split(".");
  if (
    separator < 1 ||
    separator !== value.lastIndexOf("@") ||
    codePointLength(local) > 64 ||
    !/^[\p{L}\p{N}!#$%&'*+/=?^_`{|}~.-]+$/u.test(local) ||
    local.startsWith(".") ||
    local.endsWith(".") ||
    local.includes("..") ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[\p{L}\p{N}-]+$/u.test(label),
    )
  ) {
    fields.email = "이메일 주소를 확인해 주세요.";
    return null;
  }
  let normalizedDomain: string;
  try {
    normalizedDomain = new URL(`http://${domain}`).hostname;
  } catch {
    fields.email = "이메일 주소를 확인해 주세요.";
    return null;
  }
  const isIpv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalizedDomain);
  const normalized = `${local}@${normalizedDomain}`;
  if (
    isIpv4 ||
    normalizedDomain.includes(":") ||
    codePointLength(normalized) > 254
  ) {
    fields.email = "이메일 주소를 확인해 주세요.";
    return null;
  }
  return normalized;
}

function normalizePhone(
  input: string | null | undefined,
  fields: Record<string, string>,
): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "string") {
    fields.phone = "연락처 형식을 확인해 주세요.";
    return null;
  }
  const value = input.trim();
  if (!value) return null;
  const digits = value.match(/[0-9]/g)?.length ?? 0;
  if (
    codePointLength(value) > 32 ||
    !/^\+?[0-9](?:[0-9 -]*[0-9])?$/.test(value) ||
    digits < 7 ||
    digits > 15
  ) {
    fields.phone = "연락처 형식을 확인해 주세요.";
    return null;
  }
  return value;
}

export const authService: AuthService = {
  async getCurrentAuthState({ signal } = {}) {
    checkSignal(signal);
    let state = getMockSnapshot();
    if (state.scenario === "auth_observation_error")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "로그인 상태를 확인할 수 없어요. 연결을 확인해 주세요.",
        { httpStatus: 503 },
      );
    if (state.scenario === "auth_delayed") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      assertCurrentGeneration(state.generation, signal);
    }
    let account: MockAccount | undefined | null = accountFromState(state);
    let session = state.principal_session;
    if (
      account &&
      session &&
      !state.auth_flow.pending_transition &&
      !state.auth_flow.unresolved_transition_id &&
      isExpired(account, session, getMockNow(state))
    ) {
      setMockPrincipal(null, state.generation);
      state = getMockSnapshot();
      account = null;
      session = null;
    }
    const flow = state.auth_flow;
    const unresolvedTransitionId =
      flow.pending_transition?.transition_id ?? flow.unresolved_transition_id;
    const observedFlow = mapAuthFlowState(
      getMockAuthFlowState(unresolvedTransitionId ?? undefined),
    );
    const authStatus =
      unresolvedTransitionId ||
      !observedFlow.recoveryReady ||
      Date.parse(observedFlow.serverTime) >=
        Date.parse(observedFlow.expiresAt) ||
      (!observedFlow.sessionCookiePresent &&
        observedFlow.sessionGeneration !== null)
        ? "unresolved"
        : "ready";
    return {
      user:
        account &&
        session &&
        observedFlow.sessionCookiePresent &&
        authStatus === "ready"
          ? mapSelf(asSelf(account, session))
          : null,
      flow: mapAuthFlowContext({
        flow_id: flow.flow_id,
        revision: flow.revision,
        session_generation: flow.session_generation,
        last_identity_change_revision: flow.last_identity_change_revision,
      }),
      observationGeneration: state.observation_generation,
      sessionCookiePresent: observedFlow.sessionCookiePresent,
      status: authStatus,
      unresolvedTransitionId,
    };
  },

  async getFlowState(transitionId, { signal } = {}) {
    checkSignal(signal);
    return mapAuthFlowState(getMockAuthFlowState(transitionId));
  },

  async createFlow(input) {
    return mapAuthFlowCreated(createMockAuthFlow(input.restartFrom));
  },

  async issueRecoveryCookie(flowId) {
    return mapRecoveryCookieResult(issueMockRecoveryCookie(flowId));
  },

  async confirmRecoveryCookie(flowId, input) {
    return mapRecoveryReady(
      confirmMockRecoveryCookie(flowId, input.expectedRevision),
    );
  },

  async abandonFlow(flowId) {
    return mapRestartEligibility(abandonMockAuthFlow(flowId));
  },

  async getRecoveryContext() {
    return mapRecoveryContext(getMockRecoveryContext());
  },

  async getRecoveryCsrf(flowId) {
    return mapRecoveryCsrf(getMockRecoveryCsrf(flowId));
  },

  async rotateRecoveryCookie(flowId, input) {
    return mapRecoveryCookieResult(
      rotateMockRecoveryCookie({ flowId, ...input }),
    );
  },

  async getRestartEligibility(flowId) {
    return mapRestartEligibility(getMockRestartEligibility(flowId));
  },

  async admitTransition(input) {
    return mapAuthTransitionPermit(admitMockAuthTransition(input));
  },

  async settleTransition(transitionId, input) {
    return mapSettledAuthTransition(
      settleMockAuthTransition({ transitionId, ...input }),
    );
  },

  async issueAnonymousSession(input) {
    return mapAnonymousSessionResult(
      await runAuthTransition(
        "anonymous_session",
        ({ transitionId, generation, scenario }) => ({
          value: commitMockAnonymousSession({
            transitionId,
            expectedGeneration: generation,
            sessionCookiePresent: scenario !== "auth_session_cookie_lost",
          }),
        }),
        input,
      ),
    );
  },

  async discardSession(transitionId, input) {
    return mapFlowRevision(discardMockAuthSession({ transitionId, ...input }));
  },

  async resetFlow(flowId, input) {
    return mapRestartEligibility(resetMockAuthFlow({ flowId, ...input }));
  },

  async getMe({ signal } = {}) {
    checkSignal(signal);
    const state = getMockSnapshot();
    if (
      state.auth_flow.pending_transition ||
      state.auth_flow.unresolved_transition_id ||
      !state.auth_flow.recovery_ready ||
      Date.parse(state.mock_now) >= Date.parse(state.auth_flow.expires_at) ||
      !state.auth_flow.session_cookie_present
    )
      throw authRequired();
    const account = accountFromState(state);
    const session = state.principal_session;
    if (!account || !session) throw authRequired();
    if (isExpired(account, session, getMockNow(state))) {
      setMockPrincipal(null, state.generation);
      throw authRequired();
    }
    return mapSelf(asSelf(account, session));
  },

  async getCsrf({ signal } = {}) {
    checkSignal(signal);
    const state = getMockSnapshot();
    if (
      !state.auth_flow.session_cookie_present ||
      state.auth_flow.pending_transition ||
      state.auth_flow.unresolved_transition_id ||
      Date.parse(state.mock_now) >= Date.parse(state.auth_flow.expires_at)
    )
      throw authRequired();
    return mapCsrfToken({
      csrf_token: "mock-only-csrf-token",
      expires_at: csrfExpiresAt,
    });
  },

  async register(input) {
    const state = getMockSnapshot();
    if (
      state.auth_flow.pending_transition ||
      state.auth_flow.unresolved_transition_id ||
      !state.auth_flow.recovery_ready ||
      Date.parse(state.mock_now) >= Date.parse(state.auth_flow.expires_at)
    )
      throw new ServiceError(
        "AUTH_TRANSITION_PENDING",
        "인증 결과를 확인하거나 흐름을 초기화한 뒤 다시 시도해 주세요.",
        { httpStatus: 409, outcome: "rejected" },
      );
    if (state.scenario === "auth_network_error") throw unavailable();
    if (state.scenario === "auth_delayed") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      assertCurrentGeneration(state.generation);
    }
    if (state.principal_id !== null)
      throw new ServiceError(
        "ALREADY_AUTHENTICATED",
        "가입 신청 전에 먼저 로그아웃해 주세요.",
        { httpStatus: 409, outcome: "rejected" },
      );
    const normalized = normalizeRegistration(input);
    const accounts = getMockAccounts(state, true);
    if (
      accounts.some(
        (account) =>
          account.loginId.toLowerCase() === normalized.loginId.toLowerCase(),
      )
    )
      throw new ServiceError("LOGIN_ID_TAKEN", "이미 사용 중인 아이디예요.", {
        httpStatus: 409,
        outcome: "rejected",
        fields: { login_id: "이미 사용 중인 아이디예요." },
      });

    const idNumber =
      100 + DEMO_ACCOUNTS.length + state.registered_accounts.length;
    const id = `00000000-0000-4000-8000-${String(idNumber).padStart(12, "0")}`;
    const pendingExpiresAt = new Date(
      Date.parse(mockMetaWire.server_time) +
        mockMetaWire.initial_pending_days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const account: MockRegisteredAccount = {
      id,
      loginId: normalized.loginId,
      password: normalized.password,
      nickname: normalized.nickname,
      pendingExpiresAt,
    };
    addMockRegisteredAccount(account);
    return mapRegisteredUser({
      id,
      login_id: normalized.loginId,
      nickname: normalized.nickname,
      approved: false,
      pending_expires_at: pendingExpiresAt,
    });
  },

  async login(input) {
    let state = getMockSnapshot();
    if (state.principal_id !== null) {
      const activeAccount = accountFromState(state);
      if (
        activeAccount &&
        state.principal_session &&
        isExpired(activeAccount, state.principal_session, getMockNow(state))
      ) {
        setMockPrincipal(null, state.generation);
        state = getMockSnapshot();
      }
    }
    return runAuthTransition(
      "login",
      ({ transitionId, generation, scenario }) => {
        const current = getMockSnapshot();
        assertCurrentGeneration(generation);
        if (current.principal_id !== null)
          throw new ServiceError(
            "ALREADY_AUTHENTICATED",
            "다른 계정으로 로그인하려면 먼저 로그아웃해 주세요.",
            { httpStatus: 409, outcome: "rejected" },
          );
        if (
          !input ||
          typeof input.loginId !== "string" ||
          typeof input.password !== "string"
        )
          throw new ServiceError(
            "VALIDATION_ERROR",
            "입력값을 확인해 주세요.",
            {
              outcome: "rejected",
            },
          );

        const loginId = input.loginId.trim().normalize("NFC").toLowerCase();
        const account = getMockAccounts(current, true).find(
          (item) => item.loginId.toLowerCase() === loginId,
        );
        if (!account || account.password !== input.password.normalize("NFC"))
          throw new ServiceError(
            "INVALID_CREDENTIALS",
            "로그인 아이디 또는 비밀번호를 확인해 주세요.",
            { httpStatus: 401, outcome: "rejected" },
          );
        if (!account.approved)
          throw new ServiceError(
            "ACCOUNT_NOT_APPROVED",
            "승인 대기 중인 계정입니다. 관리자 승인 후 로그인해 주세요.",
            { httpStatus: 403, outcome: "rejected" },
          );
        const now = getMockNow(current);
        if (
          account.mustChangePassword &&
          (!account.temporaryPasswordExpiresAt ||
            Date.parse(now) >= Date.parse(account.temporaryPasswordExpiresAt))
        )
          throw new ServiceError(
            "TEMP_PASSWORD_EXPIRED",
            "임시 비밀번호가 만료되었어요. 관리자에게 다시 요청해 주세요.",
            { httpStatus: 403, outcome: "rejected" },
          );
        const session = account.mustChangePassword
          ? changeOnlySession(now, account.temporaryPasswordExpiresAt!)
          : fullSession(now);
        setMockPrincipal(account.id, generation, session, {
          transitionId,
          sessionCookiePresent: scenario !== "auth_session_cookie_lost",
        });
        return {
          value: mapAuthResult({
            user: asSelf(account, session),
            csrf_token: "mock-only-csrf-token",
          }),
          identityChanged: true,
        };
      },
    );
  },

  async changePassword(input: AuthChangePasswordInput) {
    return runAuthTransition(
      "password_change",
      ({ transitionId, generation, scenario }) => {
        const current = getMockSnapshot();
        const account = accountFromState(current);
        const session = current.principal_session;
        if (!account || !session) throw authRequired();
        if (session.session_kind !== "change_only")
          throw new ServiceError(
            "SESSION_KIND_NOT_ALLOWED",
            "임시 비밀번호 로그인 상태에서만 변경할 수 있어요.",
            { httpStatus: 403, outcome: "rejected" },
          );
        if (isExpired(account, session, getMockNow(current))) {
          throw authRequired();
        }
        if (!input || typeof input.password !== "string")
          throw invalidRegistration({
            password: "새 비밀번호를 확인해 주세요.",
          });

        const password = input.password.normalize("NFC");
        const passwordLength = codePointLength(password);
        if (passwordLength < 15 || passwordLength > 128)
          throw invalidRegistration({
            password: "비밀번호는 15~128자로 입력해 주세요.",
          });
        if (password === account.password.normalize("NFC"))
          throw invalidRegistration({
            password: "새 비밀번호는 임시 비밀번호와 달라야 해요.",
          });

        completeMockPasswordChange({
          accountId: account.id,
          password,
          expectedGeneration: generation,
          transitionId,
          sessionCookiePresent: scenario !== "auth_session_cookie_lost",
        });
        const updated = getMockSnapshot();
        const updatedAccount = accountFromState(updated);
        const updatedSession = updated.principal_session;
        if (!updatedAccount || !updatedSession) throw authRequired();
        return {
          value: mapAuthResult({
            user: asSelf(updatedAccount, updatedSession),
            csrf_token: "mock-only-csrf-token",
          }),
        };
      },
    );
  },

  async reauthenticate(input) {
    return runAuthTransition(
      "reauthenticate",
      ({ transitionId, generation }) => {
        const current = getMockSnapshot();
        const account = accountFromState(current);
        const session = current.principal_session;
        if (!account || !session || session.session_kind !== "full")
          throw authRequired();
        if (isExpired(account, session, getMockNow(current)))
          throw authRequired();
        if (
          typeof input?.password !== "string" ||
          account.password !== input.password.normalize("NFC")
        )
          throw new ServiceError(
            "INVALID_CREDENTIALS",
            "비밀번호를 확인해 주세요.",
            { httpStatus: 401, outcome: "rejected" },
          );
        completeMockReauthentication({
          accountId: account.id,
          expectedGeneration: generation,
          transitionId,
        });
        const updated = getMockSnapshot();
        const updatedAccount = accountFromState(updated);
        const updatedSession = updated.principal_session;
        if (!updatedAccount || !updatedSession) throw authRequired();
        return {
          value: mapAuthResult({
            user: asSelf(updatedAccount, updatedSession),
            csrf_token: "mock-only-csrf-token",
          }),
        };
      },
    );
  },

  async logout() {
    return runAuthTransition("logout", ({ generation, transitionId }) => {
      const current = getMockSnapshot();
      setMockPrincipal(null, generation, undefined, { transitionId });
      return {
        value: undefined,
        identityChanged: current.principal_id !== null,
      };
    });
  },
};
