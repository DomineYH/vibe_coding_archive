export type ServiceErrorCode =
  | "CONTRACT_ERROR"
  | "NETWORK_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "FEATURE_UNAVAILABLE"
  | "MOCK_STORAGE_ERROR";

export type ErrorOutcome = "not_applicable" | "rejected" | "unknown";

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly outcome: ErrorOutcome;
  readonly httpStatus?: number;
  readonly fields?: Record<string, string>;
  readonly requestId?: string | null;
  readonly reasons?: string[];
  readonly retryAt?: string | null;
  readonly serverTime?: string | null;

  constructor(
    code: ServiceErrorCode,
    message: string,
    options: {
      outcome?: ErrorOutcome;
      httpStatus?: number;
      fields?: Record<string, string>;
      requestId?: string | null;
      reasons?: string[];
      retryAt?: string | null;
      serverTime?: string | null;
    } = {},
  ) {
    super(message);
    this.name = "ServiceError";
    this.code = code;
    this.outcome = options.outcome ?? "not_applicable";
    this.httpStatus = options.httpStatus;
    this.fields = options.fields;
    this.requestId = options.requestId;
    this.reasons = options.reasons;
    this.retryAt = options.retryAt;
    this.serverTime = options.serverTime;
  }
}

export function contractError(): ServiceError {
  return new ServiceError(
    "CONTRACT_ERROR",
    "서비스 응답 형식을 확인할 수 없어요.",
  );
}
