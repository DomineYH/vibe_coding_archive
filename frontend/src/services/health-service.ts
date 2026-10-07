import type {
  BatchAccepted,
  CheckAccepted,
  HealthBatch,
  HealthJobResponse,
  HealthSnapshot,
} from "../contracts/mappers";
import type { RequestOptions } from "./apps-service";
import type { ProtectedReadContext } from "./auth-state";

export type HealthReadOptions = RequestOptions & {
  readContext?: ProtectedReadContext;
};

export type HealthService = {
  getAppHealth(
    appId: string,
    options?: HealthReadOptions,
  ): Promise<HealthSnapshot>;
  requestCheck(appId: string): Promise<CheckAccepted>;
  getJob(
    jobId: string,
    options?: HealthReadOptions,
  ): Promise<HealthJobResponse>;
  requestBatch(): Promise<BatchAccepted>;
  getBatch(batchId: string, options?: HealthReadOptions): Promise<HealthBatch>;
};
