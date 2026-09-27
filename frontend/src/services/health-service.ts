import type {
  CheckAccepted,
  HealthJobResponse,
  HealthSnapshot,
} from "../contracts/mappers";
import type { RequestOptions } from "./apps-service";

export type HealthService = {
  getAppHealth(
    appId: string,
    options?: RequestOptions,
  ): Promise<HealthSnapshot>;
  requestCheck(appId: string): Promise<CheckAccepted>;
  getJob(jobId: string, options?: RequestOptions): Promise<HealthJobResponse>;
};
