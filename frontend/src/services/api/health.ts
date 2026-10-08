import {
  mapBatchAccepted,
  mapCheckAccepted,
  mapHealthBatch,
  mapHealthJobResponse,
  mapHealthSnapshot,
} from "../../contracts/mappers";
import { getJson } from "./apps";
import { isUuid } from "../../contracts/uuid";
import { ServiceError } from "../service-error";
import type { HealthReadOptions, HealthService } from "../health-service";
import { assertAuthObservation } from "../auth-state";
import { requestJson, apiContractError, type ApiEndpoint } from "./transport";

function requireUuid(id: string): string {
  if (!isUuid(id))
    throw new ServiceError("VALIDATION_ERROR", "검사 대상을 확인해 주세요.", {
      outcome: "rejected",
    });
  return encodeURIComponent(id);
}

async function readHealth(
  endpoint: ApiEndpoint,
  path: string,
  { signal, readContext }: HealthReadOptions,
  authenticated = false,
) {
  if (!readContext) return getJson(endpoint, path, { signal, authenticated });
  assertAuthObservation(readContext);
  const { flow, status } = readContext.state;
  if (status !== "ready" || !flow.sessionGeneration)
    throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
      httpStatus: 401,
    });
  try {
    const result = (await requestJson(endpoint, path, {
      signal,
      cache: "no-store",
      includeHeaders: true,
      headers: new Headers({
        Accept: "application/json",
        "X-EduVibe-Flow-Id": flow.flowId,
        "X-EduVibe-Auth-Revision": flow.revision,
        "X-EduVibe-Session-Generation": flow.sessionGeneration,
      }),
    })) as { body: unknown; headers: Headers };
    assertAuthObservation(readContext);
    if (result.headers.get("Cache-Control") !== "private, no-store")
      throw apiContractError(200);
    for (const [name, expected] of [
      ["X-EduVibe-Flow-Id", flow.flowId],
      ["X-EduVibe-Auth-Revision", flow.revision],
      ["X-EduVibe-Session-Generation", flow.sessionGeneration],
    ]) {
      const actual = result.headers.get(name);
      if (!actual) throw apiContractError(200);
      if (actual !== expected)
        throw new DOMException("Authentication context changed", "AbortError");
    }
    return result.body;
  } catch (error) {
    assertAuthObservation(readContext);
    throw error;
  }
}

export const healthService: HealthService = {
  async getAppHealth(appId, options = {}) {
    return mapHealthSnapshot(
      await readHealth(
        "GET /apps/{id}/health",
        `/apps/${requireUuid(appId)}/health`,
        options,
      ),
    );
  },

  async requestCheck(appId) {
    const response = (await getJson(
      "POST /apps/{id}/health-checks",
      `/apps/${requireUuid(appId)}/health-checks`,
      {
        method: "POST",
        write: true,
        allowAnonymousWrite: true,
        includeStatus: true,
      },
    )) as { status: number; body: unknown };
    return mapCheckAccepted(response.body, response.status);
  },

  async getJob(jobId, options = {}) {
    return mapHealthJobResponse(
      await readHealth(
        "GET /health-checks/{id}",
        `/health-checks/${requireUuid(jobId)}`,
        options,
      ),
    );
  },

  async requestBatch() {
    const response = (await getJson(
      "POST /admin/health-check-batches",
      "/admin/health-check-batches",
      { method: "POST", write: true, includeStatus: true },
    )) as { status: number; body: unknown };
    return mapBatchAccepted(response.body, response.status);
  },

  async getBatch(batchId, options = {}) {
    return mapHealthBatch(
      await readHealth(
        "GET /admin/health-check-batches/{id}",
        `/admin/health-check-batches/${requireUuid(batchId)}`,
        options,
        true,
      ),
    );
  },
};
