import {
  mapCheckAccepted,
  mapHealthJobResponse,
  mapHealthSnapshot,
} from "../../contracts/mappers";
import { getJson } from "./apps";
import { ServiceError } from "../service-error";
import type { HealthService } from "../health-service";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(id: string): string {
  if (!UUID.test(id))
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
};
