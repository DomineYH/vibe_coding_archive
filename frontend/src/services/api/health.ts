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
import type { HealthService } from "../health-service";

function requireUuid(id: string): string {
  if (!isUuid(id))
    throw new ServiceError("VALIDATION_ERROR", "검사 대상을 확인해 주세요.", {
      outcome: "rejected",
    });
  return encodeURIComponent(id);
}

export const healthService: HealthService = {
  async getAppHealth(appId, { signal } = {}) {
    return mapHealthSnapshot(
      await getJson(
        "GET /apps/{id}/health",
        `/apps/${requireUuid(appId)}/health`,
        { signal },
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

  async getJob(jobId, { signal } = {}) {
    return mapHealthJobResponse(
      await getJson(
        "GET /health-checks/{id}",
        `/health-checks/${requireUuid(jobId)}`,
        { signal },
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

  async getBatch(batchId, { signal } = {}) {
    return mapHealthBatch(
      await getJson(
        "GET /admin/health-check-batches/{id}",
        `/admin/health-check-batches/${requireUuid(batchId)}`,
        { authenticated: true, signal },
      ),
    );
  },
};
