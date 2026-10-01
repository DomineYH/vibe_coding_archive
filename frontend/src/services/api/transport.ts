import { isDateTime } from "../../contracts/mappers";
import { ServiceError, type ServiceErrorCode } from "../service-error";

export type ApiEndpoint =
  | `${"GET" | "POST"} /auth/${string}`
  | "GET /meta"
  | "GET /apps"
  | "GET /apps/{id}"
  | "GET /apps/{id}/health"
  | "POST /apps/{id}/health-checks"
  | "GET /health-checks/{id}"
  | "POST /admin/health-check-batches"
  | "GET /admin/health-check-batches/{id}"
  | "POST /write-operations"
  | "POST /apps"
  | "PATCH /apps/{id}"
  | "DELETE /apps/{id}"
  | "GET /write-operations/{key}";

const API_ERROR_TRIPLES = [
  { endpoint: "GET /meta", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /meta", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps/{id}", status: 404, code: "NOT_FOUND" },
  { endpoint: "GET /apps/{id}", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "GET /apps/{id}", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "GET /apps/{id}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "GET /apps/{id}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  { endpoint: "GET /apps/{id}", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "POST /write-operations", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "POST /write-operations", status: 404, code: "NOT_FOUND" },
  { endpoint: "POST /write-operations", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "POST /write-operations", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "POST /write-operations",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "POST /write-operations",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  { endpoint: "POST /write-operations", status: 403, code: "CSRF_INVALID" },
  { endpoint: "POST /write-operations", status: 403, code: "ORIGIN_REJECTED" },
  {
    endpoint: "POST /write-operations",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "POST /write-operations",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "POST /write-operations",
    status: 409,
    code: "VERSION_CONFLICT",
  },
  { endpoint: "POST /write-operations", status: 422, code: "VALIDATION_ERROR" },
  {
    endpoint: "POST /write-operations",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  { endpoint: "POST /write-operations", status: 503, code: "DB_BUSY" },
  { endpoint: "POST /write-operations", status: 503, code: "AUTH_BUSY" },
  { endpoint: "POST /apps", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "POST /apps", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "POST /apps", status: 403, code: "FORBIDDEN" },
  { endpoint: "POST /apps", status: 403, code: "PASSWORD_CHANGE_REQUIRED" },
  { endpoint: "POST /apps", status: 403, code: "SESSION_KIND_NOT_ALLOWED" },
  { endpoint: "POST /apps", status: 403, code: "CSRF_INVALID" },
  { endpoint: "POST /apps", status: 403, code: "ORIGIN_REJECTED" },
  { endpoint: "POST /apps", status: 404, code: "OPERATION_NOT_FOUND" },
  { endpoint: "POST /apps", status: 409, code: "OPERATION_KEY_MISMATCH" },
  {
    endpoint: "POST /apps",
    status: 409,
    code: "OPERATION_ALREADY_RESOLVED",
  },
  { endpoint: "POST /apps", status: 409, code: "OPERATION_INVALIDATED" },
  { endpoint: "POST /apps", status: 409, code: "AUTH_STATE_CHANGED" },
  { endpoint: "POST /apps", status: 409, code: "AUTH_TRANSITION_PENDING" },
  { endpoint: "POST /apps", status: 410, code: "OPERATION_EXPIRED" },
  { endpoint: "POST /apps", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "POST /apps", status: 429, code: "RATE_LIMITED" },
  { endpoint: "POST /apps", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "POST /apps", status: 503, code: "DB_BUSY" },
  { endpoint: "POST /apps", status: 503, code: "AUTH_BUSY" },
  { endpoint: "PATCH /apps/{id}", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "PATCH /apps/{id}", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "PATCH /apps/{id}", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "PATCH /apps/{id}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  { endpoint: "PATCH /apps/{id}", status: 403, code: "CSRF_INVALID" },
  { endpoint: "PATCH /apps/{id}", status: 403, code: "ORIGIN_REJECTED" },
  { endpoint: "PATCH /apps/{id}", status: 404, code: "NOT_FOUND" },
  {
    endpoint: "PATCH /apps/{id}",
    status: 404,
    code: "OPERATION_NOT_FOUND",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 409,
    code: "OPERATION_KEY_MISMATCH",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 409,
    code: "OPERATION_ALREADY_RESOLVED",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 409,
    code: "OPERATION_INVALIDATED",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "PATCH /apps/{id}",
    status: 409,
    code: "VERSION_CONFLICT",
  },
  { endpoint: "PATCH /apps/{id}", status: 410, code: "OPERATION_EXPIRED" },
  { endpoint: "PATCH /apps/{id}", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "PATCH /apps/{id}", status: 429, code: "RATE_LIMITED" },
  {
    endpoint: "PATCH /apps/{id}",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  { endpoint: "PATCH /apps/{id}", status: 503, code: "DB_BUSY" },
  { endpoint: "PATCH /apps/{id}", status: 503, code: "AUTH_BUSY" },
  { endpoint: "DELETE /apps/{id}", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "DELETE /apps/{id}", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "DELETE /apps/{id}", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "DELETE /apps/{id}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  { endpoint: "DELETE /apps/{id}", status: 403, code: "CSRF_INVALID" },
  { endpoint: "DELETE /apps/{id}", status: 403, code: "ORIGIN_REJECTED" },
  { endpoint: "DELETE /apps/{id}", status: 404, code: "NOT_FOUND" },
  {
    endpoint: "DELETE /apps/{id}",
    status: 404,
    code: "OPERATION_NOT_FOUND",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 409,
    code: "OPERATION_KEY_MISMATCH",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 409,
    code: "OPERATION_ALREADY_RESOLVED",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 409,
    code: "OPERATION_INVALIDATED",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 409,
    code: "VERSION_CONFLICT",
  },
  { endpoint: "DELETE /apps/{id}", status: 410, code: "OPERATION_EXPIRED" },
  { endpoint: "DELETE /apps/{id}", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "DELETE /apps/{id}", status: 429, code: "RATE_LIMITED" },
  {
    endpoint: "DELETE /apps/{id}",
    status: 503,
    code: "DELETION_CONFIRMATION_PENDING",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 503,
    code: "FEATURE_UNAVAILABLE",
  },
  {
    endpoint: "DELETE /apps/{id}",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  { endpoint: "DELETE /apps/{id}", status: 503, code: "DB_BUSY" },
  { endpoint: "DELETE /apps/{id}", status: 503, code: "AUTH_BUSY" },
  {
    endpoint: "GET /write-operations/{key}",
    status: 401,
    code: "AUTH_REQUIRED",
  },
  { endpoint: "GET /write-operations/{key}", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "GET /write-operations/{key}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "GET /write-operations/{key}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  {
    endpoint: "GET /write-operations/{key}",
    status: 404,
    code: "OPERATION_NOT_FOUND",
  },
  {
    endpoint: "GET /write-operations/{key}",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "GET /write-operations/{key}",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "GET /write-operations/{key}",
    status: 410,
    code: "OPERATION_EXPIRED",
  },
  {
    endpoint: "GET /write-operations/{key}",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  { endpoint: "GET /write-operations/{key}", status: 503, code: "DB_BUSY" },
  { endpoint: "GET /write-operations/{key}", status: 503, code: "AUTH_BUSY" },
  { endpoint: "GET /apps/{id}/health", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "GET /apps/{id}/health", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "GET /apps/{id}/health",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "GET /apps/{id}/health",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  { endpoint: "GET /apps/{id}/health", status: 404, code: "NOT_FOUND" },
  {
    endpoint: "GET /apps/{id}/health",
    status: 503,
    code: "FEATURE_UNAVAILABLE",
  },
  {
    endpoint: "GET /apps/{id}/health",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 400,
    code: "VALIDATION_ERROR",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 401,
    code: "AUTH_REQUIRED",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 403,
    code: "FORBIDDEN",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 403,
    code: "CSRF_INVALID",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 403,
    code: "ORIGIN_REJECTED",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 404,
    code: "NOT_FOUND",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 429,
    code: "RATE_LIMITED",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 503,
    code: "AUTH_BUSY",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 503,
    code: "FEATURE_UNAVAILABLE",
  },
  {
    endpoint: "POST /apps/{id}/health-checks",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 401,
    code: "AUTH_REQUIRED",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 403,
    code: "FORBIDDEN",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 404,
    code: "NOT_FOUND",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 503,
    code: "FEATURE_UNAVAILABLE",
  },
  {
    endpoint: "GET /health-checks/{id}",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 401,
    code: "AUTH_REQUIRED",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 403,
    code: "FORBIDDEN",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 403,
    code: "CSRF_INVALID",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 403,
    code: "ORIGIN_REJECTED",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 429,
    code: "RATE_LIMITED",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 503,
    code: "FEATURE_UNAVAILABLE",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 503,
    code: "DB_BUSY",
  },
  {
    endpoint: "POST /admin/health-check-batches",
    status: 503,
    code: "AUTH_BUSY",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 401,
    code: "AUTH_REQUIRED",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 403,
    code: "FORBIDDEN",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 404,
    code: "NOT_FOUND",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 409,
    code: "AUTH_STATE_CHANGED",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 409,
    code: "AUTH_TRANSITION_PENDING",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 503,
    code: "FEATURE_UNAVAILABLE",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 503,
    code: "SERVICE_UNAVAILABLE",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 503,
    code: "DB_BUSY",
  },
  {
    endpoint: "GET /admin/health-check-batches/{id}",
    status: 503,
    code: "AUTH_BUSY",
  },
] as const satisfies readonly {
  endpoint: ApiEndpoint;
  status: number;
  code: ServiceErrorCode;
}[];

export async function requestJson(
  endpoint: ApiEndpoint,
  path: string,
  {
    signal,
    method = "GET",
    requestBody,
    headers = new Headers({ Accept: "application/json" }),
    uncertain = false,
    noContent = false,
    includeStatus = false,
    includeHeaders = false,
  }: {
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    requestBody?: unknown;
    headers?: Headers;
    uncertain?: boolean;
    noContent?: boolean;
    includeStatus?: boolean;
    includeHeaders?: boolean;
  } = {},
): Promise<unknown> {
  if (requestBody !== undefined)
    headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers,
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      signal,
      keepalive: false,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    throw new ServiceError("NETWORK_ERROR", "서비스에 연결할 수 없어요.", {
      outcome: uncertain ? "unknown" : "not_applicable",
    });
  }

  if (noContent && response.status === 204) return undefined;
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new ServiceError(
      "CONTRACT_ERROR",
      "서비스 응답 형식을 확인할 수 없어요.",
      {
        httpStatus: response.status,
        outcome: uncertain ? "unknown" : "not_applicable",
      },
    );
  }
  if (!response.ok)
    throw mapApiError(endpoint, responseBody, response.status, uncertain);
  if (noContent)
    throw new ServiceError(
      "CONTRACT_ERROR",
      "서비스 응답 형식을 확인할 수 없어요.",
      {
        httpStatus: response.status,
        outcome: uncertain ? "unknown" : "not_applicable",
      },
    );
  if (includeHeaders) return { body: responseBody, headers: response.headers };
  return includeStatus
    ? { status: response.status, body: responseBody }
    : responseBody;
}

function mapApiError(
  endpoint: ApiEndpoint,
  body: unknown,
  httpStatus: number,
  uncertain = false,
): ServiceError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return apiContractError(httpStatus, uncertain);
  }
  const envelope = body as Record<string, unknown>;
  if (!hasOnlyKeys(envelope, ["error"]))
    return apiContractError(httpStatus, uncertain);
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== "object" || Array.isArray(error)) {
    return apiContractError(httpStatus, uncertain);
  }
  const fields = error as Record<string, unknown>;
  if (
    !hasOnlyKeys(fields, [
      "code",
      "message",
      "request_id",
      "fields",
      "reasons",
      "retry_at",
      "server_time",
    ]) ||
    typeof fields.code !== "string" ||
    typeof fields.message !== "string" ||
    !(typeof fields.request_id === "string" || fields.request_id === null) ||
    (fields.fields !== undefined && !isStringMap(fields.fields)) ||
    (fields.reasons !== undefined && !isStringArray(fields.reasons)) ||
    (fields.retry_at !== undefined && !isNullableDateTime(fields.retry_at)) ||
    (fields.server_time !== undefined &&
      !isNullableDateTime(fields.server_time))
  ) {
    return apiContractError(httpStatus, uncertain);
  }
  const allowed = API_ERROR_TRIPLES.find(
    (entry) =>
      entry.endpoint === endpoint &&
      entry.status === httpStatus &&
      entry.code === fields.code,
  );
  const authCode = fields.code as ServiceErrorCode;
  const authStatuses: Partial<Record<ServiceErrorCode, number>> = {
    FEATURE_UNAVAILABLE: 503,
    SERVICE_UNAVAILABLE: 503,
    DB_BUSY: 503,
    AUTH_BUSY: 503,
    AUTH_REQUIRED: 401,
    RECOVERY_REQUIRED: 401,
    BAD_REQUEST: 400,
    PAYLOAD_TOO_LARGE: 413,
    CSRF_INVALID: 403,
    ORIGIN_REJECTED: 403,
    AUTH_STATE_CHANGED: 409,
    AUTH_TRANSITION_PENDING: 409,
    AUTH_COOKIE_BUDGET_EXCEEDED: 409,
    VALIDATION_ERROR: 422,
    RATE_LIMITED: 429,
  };
  const accepted =
    allowed ??
    (endpoint.includes(" /auth/") &&
    (authStatuses[authCode] === httpStatus ||
      (authCode === "VALIDATION_ERROR" && [400, 413].includes(httpStatus)))
      ? { code: authCode }
      : undefined);
  if (!accepted) return apiContractError(httpStatus, uncertain);
  const message =
    endpoint === "GET /apps/{id}" && accepted.code === "NOT_FOUND"
      ? "아카이브 앱을 찾을 수 없어요."
      : endpoint === "GET /apps/{id}/health" && accepted.code === "NOT_FOUND"
        ? "아카이브 앱을 찾을 수 없어요."
        : endpoint === "GET /health-checks/{id}" &&
            accepted.code === "NOT_FOUND"
          ? "연결 검사 작업을 찾을 수 없어요."
          : endpoint === "GET /admin/health-check-batches/{id}" &&
              accepted.code === "NOT_FOUND"
            ? "전체 검사 배치를 찾을 수 없어요."
            : fields.message;
  const resultLookup = endpoint === "GET /write-operations/{key}";
  const retryMayBeUnresolved =
    uncertain &&
    (httpStatus === 401 ||
      httpStatus === 403 ||
      httpStatus === 410 ||
      accepted.code === "AUTH_STATE_CHANGED" ||
      accepted.code === "AUTH_TRANSITION_PENDING");
  return new ServiceError(accepted.code, message, {
    httpStatus,
    outcome:
      resultLookup ||
      retryMayBeUnresolved ||
      ((endpoint === "POST /apps" ||
        endpoint === "PATCH /apps/{id}" ||
        endpoint === "DELETE /apps/{id}") &&
        accepted.code === "OPERATION_ALREADY_RESOLVED") ||
      accepted.code === "DELETION_CONFIRMATION_PENDING" ||
      (uncertain && httpStatus >= 500)
        ? "unknown"
        : httpStatus === 404 || httpStatus === 409 || httpStatus === 410
          ? "rejected"
          : "not_applicable",
    fields: fields.fields as Record<string, string> | undefined,
    requestId: fields.request_id as string | null,
    reasons: fields.reasons as string[] | undefined,
    retryAt: fields.retry_at as string | null | undefined,
    serverTime: fields.server_time as string | null | undefined,
  });
}

export function apiContractError(
  httpStatus: number,
  uncertain = false,
): ServiceError {
  return new ServiceError(
    "CONTRACT_ERROR",
    "서비스 오류 응답 형식을 확인할 수 없어요.",
    { httpStatus, outcome: uncertain ? "unknown" : "not_applicable" },
  );
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

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
