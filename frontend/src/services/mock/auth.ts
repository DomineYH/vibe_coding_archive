import { mapAuthResult, mapCsrfToken, mapSelf } from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import type { AuthService } from "../auth-service";
import { DEMO_ACCOUNTS } from "./accounts";
import { getMockSnapshot, setMockPrincipal } from "./state";

const expiresAt = "2026-09-22T08:12:00.000Z";
const csrfExpiresAt = "2026-09-22T00:27:00.000Z";

function authRequired(): ServiceError {
  return new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
    httpStatus: 401,
    outcome: "rejected",
  });
}

function asSelf(account: (typeof DEMO_ACCOUNTS)[number]) {
  return {
    id: account.id,
    login_id: account.loginId,
    nickname: account.nickname,
    role: account.role,
    approved: account.approved,
    must_change_password: false,
    session_kind: "full",
    expires_at: expiresAt,
    email: null,
    phone: null,
    recent_auth_until: null,
  };
}

function currentAccount() {
  const principalId = getMockSnapshot().principal_id;
  const account = DEMO_ACCOUNTS.find((item) => item.id === principalId);
  if (!account) throw authRequired();
  return account;
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

export const authService: AuthService = {
  async getMe({ signal } = {}) {
    checkSignal(signal);
    return mapSelf(asSelf(currentAccount()));
  },

  async getCsrf({ signal } = {}) {
    checkSignal(signal);
    return mapCsrfToken({
      csrf_token: "mock-only-csrf-token",
      expires_at: csrfExpiresAt,
    });
  },

  async login(input) {
    const state = getMockSnapshot();
    if (state.scenario === "auth_network_error") throw unavailable();
    if (state.scenario === "auth_delayed")
      await new Promise((resolve) => setTimeout(resolve, 300));
    if (state.principal_id !== null)
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
      throw new ServiceError("VALIDATION_ERROR", "입력값을 확인해 주세요.", {
        outcome: "rejected",
      });

    const loginId = input.loginId.trim().normalize("NFC").toLowerCase();
    const account = DEMO_ACCOUNTS.find(
      (item) => item.loginId.toLowerCase() === loginId,
    );
    if (!account || account.password !== input.password)
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

    setMockPrincipal(account.id);
    return mapAuthResult({
      user: asSelf(account),
      csrf_token: "mock-only-csrf-token",
    });
  },

  async logout() {
    const state = getMockSnapshot();
    if (state.scenario === "auth_network_error") throw unavailable();
    setMockPrincipal(null);
  },
};
