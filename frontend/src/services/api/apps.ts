import {
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
} from "../../contracts/mappers";
import { ServiceError, type ServiceErrorCode } from "../service-error";
import { normalizeQuery, type AppsService } from "../apps-service";

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
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
  if (!response.ok) throw mapApiError(body, response.status);
  return body;
}

function mapApiError(body: unknown, httpStatus: number): ServiceError {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
  }
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
    typeof fields.code !== "string" ||
    typeof fields.message !== "string" ||
    !(typeof fields.request_id === "string" || fields.request_id === null)
  ) {
    return new ServiceError(
      "CONTRACT_ERROR",
      "서비스 오류 응답 형식을 확인할 수 없어요.",
      { httpStatus },
    );
  }
  const knownCodes: Record<string, ServiceErrorCode> = {
    NOT_FOUND: "NOT_FOUND",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  };
  const code =
    knownCodes[fields.code] ??
    (httpStatus === 503 ? "SERVICE_UNAVAILABLE" : "CONTRACT_ERROR");
  return new ServiceError(code, fields.message, {
    httpStatus,
    outcome:
      httpStatus === 400 || httpStatus === 404 ? "rejected" : "not_applicable",
  });
}

export const appsService: AppsService = {
  async getMeta({ signal } = {}) {
    return mapMeta(await getJson("/meta", signal));
  },

  async list(query, { signal } = {}) {
    let normalized;
    try {
      normalized = normalizeQuery(query);
    } catch {
      throw new ServiceError("VALIDATION_ERROR", "검색 조건을 확인해 주세요.", {
        outcome: "rejected",
      });
    }
    const params = new URLSearchParams();
    if (normalized.q) params.set("q", normalized.q);
    if (normalized.subject) params.set("subject", normalized.subject);
    if (normalized.grade) params.set("grade", normalized.grade);
    params.set("limit", String(normalized.limit));
    params.set("offset", String(normalized.offset));
    return mapAppPage(await getJson(`/apps?${params}`, signal));
  },

  async get(id, { signal } = {}) {
    return mapAppDetailResponse(
      await getJson(`/apps/${encodeURIComponent(id)}`, signal),
    ).item;
  },
};
