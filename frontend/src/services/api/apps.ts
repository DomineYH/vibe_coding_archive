import {
  isDateTime,
  mapAppWriteOperation,
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
  type AppWriteOperation,
} from "../../contracts/mappers";
import {
  contractError,
  ServiceError,
  type ServiceErrorCode,
} from "../service-error";
import {
  appPatchToWire,
  appInputToWire,
  normalizeAppInput,
  normalizeQueryForService,
  type AppsService,
} from "../apps-service";
import { authService } from "./auth";

export type ApiEndpoint =
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

export async function getJson(
  endpoint: ApiEndpoint,
  path: string,
  {
    signal,
    method = "GET",
    requestBody,
    authenticated = false,
    write = false,
    allowAnonymousWrite = false,
    idempotencyKey,
    uncertain = false,
    noContent = false,
    includeStatus = false,
  }: {
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    requestBody?: unknown;
    authenticated?: boolean;
    write?: boolean;
    allowAnonymousWrite?: boolean;
    idempotencyKey?: string;
    uncertain?: boolean;
    noContent?: boolean;
    includeStatus?: boolean;
  } = {},
): Promise<unknown> {
  const headers = new Headers({ Accept: "application/json" });
  if (authenticated || write) {
    let auth;
    try {
      auth = await authService.getCurrentAuthState({ signal });
    } catch (error) {
      if (!uncertain) throw error;
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "현재 인증 상태를 확인할 수 없어 저장 결과를 확정할 수 없어요.",
        {
          httpStatus: error instanceof ServiceError ? error.httpStatus : 503,
          outcome: "unknown",
        },
      );
    }
    const user = auth.user;
    if (
      auth.status !== "ready" ||
      (!user && !allowAnonymousWrite) ||
      (user !== null && !user.approved)
    )
      throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
        outcome: uncertain ? "unknown" : "rejected",
        httpStatus: 401,
      });
    if (user?.mustChangePassword || user?.sessionKind === "change_only")
      throw new ServiceError(
        "PASSWORD_CHANGE_REQUIRED",
        "회원 기능을 사용하기 전에 비밀번호를 변경해 주세요.",
        { outcome: uncertain ? "unknown" : "rejected", httpStatus: 403 },
      );
    if (!auth.flow.sessionGeneration)
      throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
        outcome: uncertain ? "unknown" : "rejected",
        httpStatus: 401,
      });
    headers.set("X-EduVibe-Flow-Id", auth.flow.flowId);
    headers.set("X-EduVibe-Auth-Revision", auth.flow.revision);
    headers.set("X-EduVibe-Session-Generation", auth.flow.sessionGeneration);
    if (write) {
      let csrf;
      try {
        csrf = await authService.getCsrf({ signal });
      } catch (error) {
        if (!uncertain) throw error;
        throw new ServiceError(
          "SERVICE_UNAVAILABLE",
          "요청 권한을 확인할 수 없어 저장 결과를 확정할 수 없어요.",
          {
            httpStatus: error instanceof ServiceError ? error.httpStatus : 503,
            outcome: "unknown",
          },
        );
      }
      headers.set("X-CSRF-Token", csrf.csrfToken);
    }
  }
  if (requestBody !== undefined)
    headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method,
      credentials: "include",
      headers,
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      signal,
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
  if (!allowed) return apiContractError(httpStatus, uncertain);
  const message =
    endpoint === "GET /apps/{id}" && allowed.code === "NOT_FOUND"
      ? "아카이브 앱을 찾을 수 없어요."
      : endpoint === "GET /apps/{id}/health" && allowed.code === "NOT_FOUND"
        ? "아카이브 앱을 찾을 수 없어요."
        : endpoint === "GET /health-checks/{id}" && allowed.code === "NOT_FOUND"
          ? "연결 검사 작업을 찾을 수 없어요."
          : endpoint === "GET /admin/health-check-batches/{id}" &&
              allowed.code === "NOT_FOUND"
            ? "전체 검사 배치를 찾을 수 없어요."
            : fields.message;
  const resultLookup = endpoint === "GET /write-operations/{key}";
  const retryMayBeUnresolved =
    uncertain &&
    (httpStatus === 401 ||
      httpStatus === 403 ||
      httpStatus === 410 ||
      allowed.code === "AUTH_STATE_CHANGED" ||
      allowed.code === "AUTH_TRANSITION_PENDING");
  return new ServiceError(allowed.code, message, {
    httpStatus,
    outcome:
      resultLookup ||
      retryMayBeUnresolved ||
      ((endpoint === "POST /apps" ||
        endpoint === "PATCH /apps/{id}" ||
        endpoint === "DELETE /apps/{id}") &&
        allowed.code === "OPERATION_ALREADY_RESOLVED") ||
      allowed.code === "DELETION_CONFIRMATION_PENDING" ||
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

function apiContractError(httpStatus: number, uncertain = false): ServiceError {
  return new ServiceError(
    "CONTRACT_ERROR",
    "서비스 오류 응답 형식을 확인할 수 없어요.",
    { httpStatus, outcome: uncertain ? "unknown" : "not_applicable" },
  );
}

function mapWriteResult<T>(mapper: (value: unknown) => T, value: unknown): T {
  try {
    return mapper(value);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "CONTRACT_ERROR")
      throw new ServiceError(
        "CONTRACT_ERROR",
        "서비스 응답 형식을 확인할 수 없어요.",
        { httpStatus: 201, outcome: "unknown" },
      );
    throw error;
  }
}

function requireSucceededOperation(
  operation: AppWriteOperation,
  kind: AppWriteOperation["kind"],
  targetId: string,
) {
  if (
    operation.kind !== kind ||
    (operation.targetId !== null && operation.targetId !== targetId)
  )
    throw new ServiceError(
      "CONTRACT_ERROR",
      "저장 작업 결과를 확인할 수 없어요.",
      { outcome: "unknown" },
    );
  if (operation.state === "rejected")
    throw new ServiceError(
      operation.rejectionCode === "VERSION_CONFLICT"
        ? "VERSION_CONFLICT"
        : "VALIDATION_ERROR",
      "저장 작업이 거절되었어요.",
      { outcome: "rejected" },
    );
  if (operation.state !== "succeeded" || operation.targetId !== targetId)
    throw new ServiceError(
      "SERVICE_UNAVAILABLE",
      "저장 결과가 아직 확정되지 않았어요.",
      { outcome: "unknown" },
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

export const appsService: AppsService = {
  async getMeta({ signal } = {}) {
    return mapMeta(await getJson("GET /meta", "/meta", { signal }));
  },

  async list(query, { signal } = {}) {
    const normalized = normalizeQueryForService(query);
    const params = new URLSearchParams();
    if (normalized.q) params.set("q", normalized.q);
    if (normalized.subject) params.set("subject", normalized.subject);
    if (normalized.grade) params.set("grade", normalized.grade);
    params.set("limit", String(normalized.limit));
    params.set("offset", String(normalized.offset));
    return mapAppPage(
      await getJson("GET /apps", `/apps?${params}`, { signal }),
    );
  },

  async get(id, { signal } = {}) {
    return mapAppDetailResponse(
      await getJson("GET /apps/{id}", `/apps/${encodeURIComponent(id)}`, {
        signal,
      }),
    ).item;
  },

  async issueCreateOperation(input) {
    const normalized = normalizeAppInput(input);
    const operation = mapAppWriteOperation(
      await getJson("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        requestBody: {
          kind: "app_create",
          input: appInputToWire(normalized),
        },
      }),
    );
    if (operation.kind !== "app_create" || operation.state !== "unresolved")
      throw contractError();
    return operation;
  },

  async create(input, operationKey) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(operationKey))
      throw new ServiceError("VALIDATION_ERROR", "저장 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const saved = mapWriteResult(
      (value) => mapAppDetailResponse(value).item,
      await getJson("POST /apps", "/apps", {
        method: "POST",
        write: true,
        uncertain: true,
        idempotencyKey: operationKey,
        requestBody: appInputToWire(input),
      }),
    );
    const operation = await appsService.getCreateOperation(operationKey);
    requireSucceededOperation(operation, "app_create", saved.id);
    return saved;
  },

  async getCreateOperation(key, { signal } = {}) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(key))
      throw new ServiceError("VALIDATION_ERROR", "저장 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
        { authenticated: true, signal, uncertain: true },
      ),
    );
    if (operation.key !== key || operation.kind !== "app_create")
      throw apiContractError(200, true);
    return operation;
  },

  async issueUpdateOperation(id, patch, expectedVersion) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "수정 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        requestBody: {
          kind: "app_update",
          target_id: id,
          expected_version: expectedVersion,
          input: appPatchToWire(patch),
        },
      }),
    );
    if (
      operation.kind !== "app_update" ||
      operation.targetId !== id ||
      operation.state !== "unresolved"
    )
      throw contractError();
    return operation;
  },

  async update(id, patch, expectedVersion, operationKey) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(operationKey) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "수정 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    const input = appPatchToWire(patch);
    const saved = mapWriteResult(
      (value) => {
        const app = mapAppDetailResponse(value).item;
        if (app.id !== id) throw contractError();
        return app;
      },
      await getJson("PATCH /apps/{id}", `/apps/${encodeURIComponent(id)}`, {
        method: "PATCH",
        write: true,
        uncertain: true,
        idempotencyKey: operationKey,
        requestBody: { expected_version: expectedVersion, ...input },
      }),
    );
    const operation = await appsService.getUpdateOperation(operationKey);
    requireSucceededOperation(operation, "app_update", id);
    return saved;
  },

  async getUpdateOperation(key, { signal } = {}) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(key))
      throw new ServiceError("VALIDATION_ERROR", "저장 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
        { authenticated: true, signal, uncertain: true },
      ),
    );
    if (operation.key !== key || operation.kind !== "app_update")
      throw apiContractError(200, true);
    return operation;
  },

  async issueDeleteOperation(id, expectedVersion) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "삭제 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        requestBody: {
          kind: "app_delete",
          target_id: id,
          expected_version: expectedVersion,
        },
      }),
    );
    if (
      operation.kind !== "app_delete" ||
      operation.targetId !== id ||
      operation.state !== "unresolved"
    )
      throw contractError();
    return operation;
  },

  async delete(id, expectedVersion, operationKey) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(operationKey) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "삭제 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    await getJson("DELETE /apps/{id}", `/apps/${encodeURIComponent(id)}`, {
      method: "DELETE",
      write: true,
      uncertain: true,
      noContent: true,
      idempotencyKey: operationKey,
      requestBody: { expected_version: expectedVersion },
    });
    const operation = await appsService.getDeleteOperation(operationKey);
    requireSucceededOperation(operation, "app_delete", id);
  },

  async getDeleteOperation(key, { signal } = {}) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(key))
      throw new ServiceError("VALIDATION_ERROR", "삭제 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
        { authenticated: true, signal, uncertain: true },
      ),
    );
    if (operation.key !== key || operation.kind !== "app_delete")
      throw apiContractError(200, true);
    return operation;
  },
};
