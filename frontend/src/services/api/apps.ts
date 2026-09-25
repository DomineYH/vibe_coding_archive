import {
  isDateTime,
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
} from "../../contracts/mappers";
import { ServiceError, type ServiceErrorCode } from "../service-error";
import { normalizeQueryForService, type AppsService } from "../apps-service";

type ApiEndpoint = "GET /meta" | "GET /apps" | "GET /apps/{id}";

const API_ERROR_TRIPLES = [
  { endpoint: "GET /meta", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /meta", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 404, code: "NOT_FOUND" },
  { endpoint: "GET /apps/{id}", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 503, code: "SERVICE_UNAVAILABLE" },
] as const satisfies readonly {
  endpoint: ApiEndpoint;
  status: number;
  code: ServiceErrorCode;
}[];

async function getJson(
  endpoint: ApiEndpoint,
  path: string,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    throw new ServiceError("NETWORK_ERROR", "서비스에 연결할 수 없어요.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ServiceError(
      "CONTRACT_ERROR",
      "서비스 응답 형식을 확인할 수 없어요.",
      { httpStatus: response.status },
    );
  }
  if (!response.ok) throw mapApiError(endpoint, body, response.status);
  return body;
}

function mapApiError(
  endpoint: ApiEndpoint,
  body: unknown,
  httpStatus: number,
): ServiceError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
  }
  const envelope = body as Record<string, unknown>;
  if (!hasOnlyKeys(envelope, ["error"]))
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
  const error = (body as { error?: unknown }).error;
  if (error === null || typeof error !== "object" || Array.isArray(error)) {
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
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
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
  }
  const allowed = API_ERROR_TRIPLES.find(
    (entry) =>
      entry.endpoint === endpoint &&
      entry.status === httpStatus &&
      entry.code === fields.code,
  );
  if (!allowed)
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
  return new ServiceError(allowed.code, fields.message, {
    httpStatus,
    outcome: httpStatus === 404 ? "rejected" : "not_applicable",
    fields: fields.fields as Record<string, string> | undefined,
    requestId: fields.request_id as string | null,
    reasons: fields.reasons as string[] | undefined,
    retryAt: fields.retry_at as string | null | undefined,
    serverTime: fields.server_time as string | null | undefined,
  });
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
    return mapMeta(await getJson("GET /meta", "/meta", signal));
  },

  async list(query, { signal } = {}) {
    const normalized = normalizeQueryForService(query);
    const params = new URLSearchParams();
    if (normalized.q) params.set("q", normalized.q);
    if (normalized.subject) params.set("subject", normalized.subject);
    if (normalized.grade) params.set("grade", normalized.grade);
    params.set("limit", String(normalized.limit));
    params.set("offset", String(normalized.offset));
    return mapAppPage(await getJson("GET /apps", `/apps?${params}`, signal));
  },

  async get(id, { signal } = {}) {
    return mapAppDetailResponse(
      await getJson(
        "GET /apps/{id}",
        `/apps/${encodeURIComponent(id)}`,
        signal,
      ),
    ).item;
  },
};
