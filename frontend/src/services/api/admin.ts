import {
  isDateTime,
  mapAdminAppPage,
  mapAdminUser,
  mapAdminUserPage,
  mapApprovalOperation,
  mapPasswordResetOperation,
  mapUserDeleteOperation,
} from "../../contracts/mappers";
import { authService } from "./auth";
import type { ServiceErrorCode } from "../service-error";
import { ServiceError } from "../service-error";
import {
  normalizeAdminUsersQuery,
  normalizeAdminAppsQuery,
  normalizeResetPassword,
  type AdminService,
} from "../admin-service";

type ApiEndpoint =
  | "GET /admin/users"
  | "GET /admin/apps"
  | "GET /admin/users/{id}"
  | "POST /write-operations"
  | "PATCH /admin/users/{id}/approval"
  | "POST /admin/users/{id}/password-reset"
  | "DELETE /admin/users/{id}"
  | "GET /write-operations/{key}"
  | "POST /write-operations/{key}/cancel";

type ErrorCodesByStatus = Partial<Record<number, readonly ServiceErrorCode[]>>;

const ADMIN_READ_ERRORS: ErrorCodesByStatus = {
  401: ["AUTH_REQUIRED"],
  403: [
    "FORBIDDEN",
    "PASSWORD_CHANGE_REQUIRED",
    "SESSION_KIND_NOT_ALLOWED",
    "REAUTH_REQUIRED",
  ],
  409: ["AUTH_STATE_CHANGED", "AUTH_TRANSITION_PENDING"],
  503: ["FEATURE_UNAVAILABLE", "SERVICE_UNAVAILABLE", "DB_BUSY", "AUTH_BUSY"],
};
const TARGET_READ_ERRORS: ErrorCodesByStatus = {
  ...ADMIN_READ_ERRORS,
  404: ["USER_NOT_FOUND"],
};
const KEY_READ_ERRORS: ErrorCodesByStatus = {
  ...ADMIN_READ_ERRORS,
  403: ["FORBIDDEN", "PASSWORD_CHANGE_REQUIRED", "SESSION_KIND_NOT_ALLOWED"],
  422: ["VALIDATION_ERROR"],
  404: ["OPERATION_NOT_FOUND"],
  410: ["OPERATION_EXPIRED"],
};
const ISSUE_ERRORS: ErrorCodesByStatus = {
  ...ADMIN_READ_ERRORS,
  400: ["BAD_REQUEST", "VALIDATION_ERROR"],
  403: [
    "FORBIDDEN",
    "PASSWORD_CHANGE_REQUIRED",
    "SESSION_KIND_NOT_ALLOWED",
    "ADMIN_ACCOUNT_PROTECTED",
    "REAUTH_REQUIRED",
    "CSRF_INVALID",
    "ORIGIN_REJECTED",
  ],
  404: ["USER_NOT_FOUND"],
  409: [
    "USER_STATE_CONFLICT",
    "APP_COUNT_CONFLICT",
    "AUTH_STATE_CHANGED",
    "AUTH_TRANSITION_PENDING",
  ],
  413: ["PAYLOAD_TOO_LARGE"],
  422: ["VALIDATION_ERROR"],
};
const EXECUTE_ERRORS: ErrorCodesByStatus = {
  ...ISSUE_ERRORS,
  404: ["USER_NOT_FOUND", "OPERATION_NOT_FOUND"],
  409: [
    "USER_STATE_CONFLICT",
    "OPERATION_KEY_MISMATCH",
    "OPERATION_ALREADY_RESOLVED",
    "OPERATION_INVALIDATED",
    "AUTH_STATE_CHANGED",
    "AUTH_TRANSITION_PENDING",
  ],
  410: ["OPERATION_EXPIRED"],
};
const RESET_ERRORS: ErrorCodesByStatus = {
  ...EXECUTE_ERRORS,
};
const USER_DELETE_ERRORS: ErrorCodesByStatus = {
  ...EXECUTE_ERRORS,
  409: [
    "APP_COUNT_CONFLICT",
    "USER_NOT_FOUND",
    "OPERATION_KEY_MISMATCH",
    "OPERATION_ALREADY_RESOLVED",
    "OPERATION_INVALIDATED",
    "AUTH_STATE_CHANGED",
    "AUTH_TRANSITION_PENDING",
  ],
  503: [
    "DELETION_CONFIRMATION_PENDING",
    "FEATURE_UNAVAILABLE",
    "SERVICE_UNAVAILABLE",
    "DB_BUSY",
    "AUTH_BUSY",
  ],
};
const CANCEL_ERRORS: ErrorCodesByStatus = {
  ...ADMIN_READ_ERRORS,
  422: ["VALIDATION_ERROR"],
  400: ["BAD_REQUEST"],
  413: ["PAYLOAD_TOO_LARGE"],
  403: [
    "FORBIDDEN",
    "PASSWORD_CHANGE_REQUIRED",
    "SESSION_KIND_NOT_ALLOWED",
    "CSRF_INVALID",
    "ORIGIN_REJECTED",
  ],
  404: ["OPERATION_NOT_FOUND"],
  409: [
    "OPERATION_KIND_NOT_CANCELLABLE",
    "AUTH_STATE_CHANGED",
    "AUTH_TRANSITION_PENDING",
  ],
  410: ["OPERATION_EXPIRED"],
};

const ERROR_CODES_BY_ENDPOINT: Record<ApiEndpoint, ErrorCodesByStatus> = {
  "GET /admin/users": ADMIN_READ_ERRORS,
  "GET /admin/apps": ADMIN_READ_ERRORS,
  "GET /admin/users/{id}": TARGET_READ_ERRORS,
  "POST /write-operations": ISSUE_ERRORS,
  "PATCH /admin/users/{id}/approval": EXECUTE_ERRORS,
  "POST /admin/users/{id}/password-reset": RESET_ERRORS,
  "DELETE /admin/users/{id}": USER_DELETE_ERRORS,
  "GET /write-operations/{key}": KEY_READ_ERRORS,
  "POST /write-operations/{key}/cancel": CANCEL_ERRORS,
};

async function requestHeaders(write: boolean, signal?: AbortSignal) {
  const auth = await authService.getCurrentAuthState({ signal });
  if (!auth.user || auth.user.role !== "admin" || !auth.user.approved)
    throw new ServiceError("FORBIDDEN", "관리자 권한이 필요해요.", {
      httpStatus: 403,
      outcome: "rejected",
    });
  if (!auth.flow.sessionGeneration)
    throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
      httpStatus: 401,
      outcome: "rejected",
    });
  const headers = new Headers({
    Accept: "application/json",
    "X-EduVibe-Flow-Id": auth.flow.flowId,
    "X-EduVibe-Auth-Revision": auth.flow.revision,
    "X-EduVibe-Session-Generation": auth.flow.sessionGeneration,
  });
  if (write) {
    const csrf = await authService.getCsrf({ signal });
    if (
      csrf.authContext?.flowId !== auth.flow.flowId ||
      csrf.authContext.revision !== auth.flow.revision ||
      csrf.authContext.sessionGeneration !== auth.flow.sessionGeneration
    )
      throw new ServiceError(
        "AUTH_STATE_CHANGED",
        "인증 상태가 바뀌었어요. 다시 확인해 주세요.",
        {
          httpStatus: 409,
          outcome: "rejected",
        },
      );
    headers.set("X-CSRF-Token", csrf.csrfToken);
  }
  return headers;
}

function contractError(status: number, uncertain: boolean) {
  return new ServiceError(
    "CONTRACT_ERROR",
    "서비스 응답 형식을 확인할 수 없어요.",
    { httpStatus: status, outcome: uncertain ? "unknown" : "not_applicable" },
  );
}

function mapApiError(
  endpoint: ApiEndpoint,
  value: unknown,
  status: number,
  uncertain: boolean,
) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => key !== "error")
  )
    return contractError(status, uncertain);
  const envelope = (value as Record<string, unknown>).error;
  if (
    envelope === null ||
    typeof envelope !== "object" ||
    Array.isArray(envelope)
  )
    return contractError(status, uncertain);
  const error = envelope as Record<string, unknown>;
  if (
    Object.keys(error).some(
      (key) =>
        ![
          "code",
          "message",
          "request_id",
          "fields",
          "reasons",
          "retry_at",
          "server_time",
        ].includes(key),
    ) ||
    typeof error.code !== "string" ||
    typeof error.message !== "string" ||
    !(typeof error.request_id === "string" || error.request_id === null) ||
    (error.fields !== undefined && !isStringMap(error.fields)) ||
    (error.reasons !== undefined && !isStringArray(error.reasons)) ||
    (error.retry_at !== undefined && !isNullableDateTime(error.retry_at)) ||
    (error.server_time !== undefined && !isNullableDateTime(error.server_time))
  )
    return contractError(status, uncertain);
  const allowedCodes = ERROR_CODES_BY_ENDPOINT[endpoint][status];
  if (!allowedCodes?.includes(error.code as ServiceErrorCode))
    return contractError(status, uncertain);
  return new ServiceError(error.code as ServiceErrorCode, error.message, {
    httpStatus: status,
    requestId: error.request_id,
    outcome: uncertain && status >= 500 ? "unknown" : "rejected",
    fields: error.fields as Record<string, string> | undefined,
    reasons: error.reasons as string[] | undefined,
    retryAt: error.retry_at as string | null | undefined,
    serverTime: error.server_time as string | null | undefined,
  });
}

async function request(
  endpoint: ApiEndpoint,
  path: string,
  {
    method = "GET",
    body,
    signal,
    idempotencyKey,
    write = false,
    uncertain = false,
    noContent = false,
  }: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    idempotencyKey?: string;
    write?: boolean;
    uncertain?: boolean;
    noContent?: boolean;
  } = {},
): Promise<unknown> {
  const headers = await requestHeaders(write, signal);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      if (uncertain)
        throw new ServiceError("NETWORK_ERROR", "서비스에 연결할 수 없어요.", {
          outcome: "unknown",
        });
      throw error;
    }
    throw new ServiceError("NETWORK_ERROR", "서비스에 연결할 수 없어요.", {
      outcome: uncertain ? "unknown" : "not_applicable",
    });
  }
  if (!response.ok) {
    let errorBody: unknown;
    try {
      errorBody = await response.json();
    } catch {
      throw contractError(response.status, uncertain);
    }
    throw mapApiError(endpoint, errorBody, response.status, uncertain);
  }
  for (const name of [
    "X-EduVibe-Flow-Id",
    "X-EduVibe-Auth-Revision",
    "X-EduVibe-Session-Generation",
  ]) {
    if (response.headers.get(name) !== headers.get(name))
      throw contractError(response.status, uncertain);
  }
  if (noContent) {
    if (response.status !== 204)
      throw contractError(response.status, uncertain);
    return undefined;
  }
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw contractError(response.status, uncertain);
  }
  return value;
}

function mapWriteResult<T>(mapper: (value: unknown) => T, value: unknown): T {
  try {
    return mapper(value);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "CONTRACT_ERROR")
      throw contractError(200, true);
    throw error;
  }
}

export const adminService: AdminService = {
  async listUsers(query, { signal } = {}) {
    const normalized = normalizeAdminUsersQuery(query);
    const params = new URLSearchParams({
      limit: String(normalized.limit),
      offset: String(normalized.offset),
    });
    return mapAdminUserPage(
      await request("GET /admin/users", `/admin/users?${params}`, { signal }),
    );
  },

  async listApps(query, { signal } = {}) {
    const normalized = normalizeAdminAppsQuery(query);
    const params = new URLSearchParams({
      limit: String(normalized.limit),
      offset: String(normalized.offset),
    });
    return mapAdminAppPage(
      await request("GET /admin/apps", `/admin/apps?${params}`, { signal }),
    );
  },

  async getUser(id, { signal } = {}) {
    return mapAdminUser(
      await request(
        "GET /admin/users/{id}",
        `/admin/users/${encodeURIComponent(id)}`,
        { signal },
      ),
    );
  },

  async createApprovalOperation(input) {
    return mapApprovalOperation(
      await request("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        body: {
          kind: "user_approval",
          target_id: input.targetId,
          expected_account_version: input.expectedAccountVersion,
          approved: input.approved,
        },
      }),
    );
  },

  async createPasswordResetOperation(input) {
    const newPassword = normalizeResetPassword(input.newPassword);
    return mapPasswordResetOperation(
      await request("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        body: {
          kind: "user_password_reset",
          target_id: input.targetId,
          expected_account_version: input.expectedAccountVersion,
          new_password: newPassword,
        },
      }),
    );
  },

  async createUserDeleteOperation(input) {
    return mapUserDeleteOperation(
      await request("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        body: {
          kind: "user_delete",
          target_id: input.targetId,
          expected_app_count: input.expectedAppCount,
        },
      }),
    );
  },

  async setApproval(id, approved, expectedAccountVersion, operationKey) {
    return mapWriteResult(
      mapAdminUser,
      await request(
        "PATCH /admin/users/{id}/approval",
        `/admin/users/${encodeURIComponent(id)}/approval`,
        {
          method: "PATCH",
          write: true,
          uncertain: true,
          idempotencyKey: operationKey,
          body: {
            approved,
            expected_account_version: expectedAccountVersion,
          },
        },
      ),
    );
  },

  async setPasswordReset(
    id,
    newPassword,
    expectedAccountVersion,
    operationKey,
  ) {
    await request(
      "POST /admin/users/{id}/password-reset",
      `/admin/users/${encodeURIComponent(id)}/password-reset`,
      {
        method: "POST",
        write: true,
        uncertain: true,
        noContent: true,
        idempotencyKey: operationKey,
        body: {
          new_password: normalizeResetPassword(newPassword),
          expected_account_version: expectedAccountVersion,
        },
      },
    );
  },

  async deleteUser(id, expectedAppCount, operationKey) {
    await request(
      "DELETE /admin/users/{id}",
      `/admin/users/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
        write: true,
        uncertain: true,
        noContent: true,
        idempotencyKey: operationKey,
        body: { expected_app_count: expectedAppCount },
      },
    );
  },

  async getUserDeleteOperation(key) {
    return mapUserDeleteOperation(
      await request(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
      ),
    );
  },

  async getPasswordResetOperation(key) {
    return mapPasswordResetOperation(
      await request(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
      ),
    );
  },

  async getApprovalOperation(key) {
    return mapApprovalOperation(
      await request(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
      ),
    );
  },

  async cancelApprovalOperation(key) {
    return mapWriteResult(
      mapApprovalOperation,
      await request(
        "POST /write-operations/{key}/cancel",
        `/write-operations/${encodeURIComponent(key)}/cancel`,
        {
          method: "POST",
          write: true,
          uncertain: true,
        },
      ),
    );
  },

  async cancelPasswordResetOperation(key) {
    return mapPasswordResetOperation(
      await request(
        "POST /write-operations/{key}/cancel",
        `/write-operations/${encodeURIComponent(key)}/cancel`,
        {
          method: "POST",
          write: true,
          uncertain: true,
        },
      ),
    );
  },
};

function isStringMap(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isNullableDateTime(value: unknown): value is string | null {
  return value === null || isDateTime(value);
}
