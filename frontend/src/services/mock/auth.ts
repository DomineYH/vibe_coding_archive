import {
  mapAuthResult,
  mapCsrfToken,
  mapRegisteredUser,
  mapSelf,
} from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import type { AuthRegisterInput, AuthService } from "../auth-service";
import { mockMetaWire } from "./apps";
import { DEMO_ACCOUNTS } from "./accounts";
import {
  addMockRegisteredAccount,
  assertCurrentGeneration,
  getMockSnapshot,
  setMockPrincipal,
  type MockRegisteredAccount,
} from "./state";

const expiresAt = "2026-09-22T08:12:00.000Z";
const csrfExpiresAt = "2026-09-22T00:27:00.000Z";

function authRequired(): ServiceError {
  return new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
    httpStatus: 401,
    outcome: "rejected",
  });
}

type MockAccount =
  | (typeof DEMO_ACCOUNTS)[number]
  | (MockRegisteredAccount & { role: "user"; approved: false });

function asSelf(account: MockAccount) {
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
  const state = getMockSnapshot();
  const principalId = state.principal_id;
  const account =
    DEMO_ACCOUNTS.find((item) => item.id === principalId) ??
    state.registered_accounts
      .filter((item) => item.id === principalId)
      .map((item) => ({
        ...item,
        role: "user" as const,
        approved: false as const,
      }))[0];
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

  async register(input) {
    const state = getMockSnapshot();
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
    const accounts = [...DEMO_ACCOUNTS, ...state.registered_accounts];
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
    const account =
      DEMO_ACCOUNTS.find((item) => item.loginId.toLowerCase() === loginId) ??
      state.registered_accounts
        .filter((item) => item.loginId.toLowerCase() === loginId)
        .map((item) => ({
          ...item,
          role: "user" as const,
          approved: false as const,
        }))[0];
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
