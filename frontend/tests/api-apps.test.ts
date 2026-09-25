import { afterEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/api/apps";

afterEach(() => vi.unstubAllGlobals());

const requests = {
  "GET /meta": () => appsService.getMeta(),
  "GET /apps": () => appsService.list(),
  "GET /apps/{id}": () => appsService.get("missing"),
};

const allowedErrors = [
  { endpoint: "GET /meta", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /meta", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 404, code: "NOT_FOUND" },
  { endpoint: "GET /apps/{id}", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 503, code: "SERVICE_UNAVAILABLE" },
] as const;

const invalidErrors = [
  { endpoint: "GET /apps/{id}", status: 503, code: "NOT_FOUND" },
  { endpoint: "GET /meta", status: 404, code: "NOT_FOUND" },
  { endpoint: "GET /apps", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps", status: 429, code: "RATE_LIMITED" },
  { endpoint: "GET /apps", status: 503, code: "RATE_LIMITED" },
  { endpoint: "GET /meta", status: 503, code: "AUTH_BUSY" },
  { endpoint: "GET /meta", status: 410, code: "SERVICE_MOVED" },
  { endpoint: "GET /apps", status: 503, code: "UNRECOGNIZED_CODE" },
  { endpoint: "GET /apps", status: 404, code: "UNRECOGNIZED_CODE" },
  { endpoint: "GET /apps/{id}", status: 404, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 400, code: "FEATURE_UNAVAILABLE" },
] as const;

function stubErrorResponse(
  status: number,
  code: string,
  details: Record<string, unknown> = {},
  envelopeExtras: Record<string, unknown> = {},
) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ...envelopeExtras,
          error: {
            code,
            message: "Public service error",
            request_id: "req-31",
            ...(code === "FEATURE_UNAVAILABLE"
              ? { reasons: ["operational_restriction"] }
              : {}),
            ...details,
          },
        }),
        { status },
      ),
    ),
  );
}

describe("API service errors", () => {
  it("uses one public message for missing and inaccessible detail reads", async () => {
    const notFound = (message: string) =>
      new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message, request_id: null },
        }),
        { status: 404 },
      );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(notFound("Private app"))
        .mockResolvedValueOnce(notFound("Missing app")),
    );

    for (const id of ["private", "missing"]) {
      await expect(appsService.get(id)).rejects.toMatchObject({
        code: "NOT_FOUND",
        httpStatus: 404,
        message: "아카이브 앱을 찾을 수 없어요.",
      });
    }
  });

  it.each(allowedErrors)(
    "accepts $endpoint $status $code",
    async ({ endpoint, status, code }) => {
      stubErrorResponse(status, code);

      await expect(requests[endpoint]()).rejects.toMatchObject({
        code,
        httpStatus: status,
        requestId: "req-31",
        ...(code === "FEATURE_UNAVAILABLE"
          ? { reasons: ["operational_restriction"] }
          : {}),
      });
    },
  );

  it.each(invalidErrors)(
    "rejects mismatched or unknown $endpoint $status $code",
    async ({ endpoint, status, code }) => {
      stubErrorResponse(status, code);

      await expect(requests[endpoint]()).rejects.toMatchObject({
        code: "CONTRACT_ERROR",
        httpStatus: status,
      });
    },
  );

  it("preserves validated optional error details on an allowed tuple", async () => {
    stubErrorResponse(503, "FEATURE_UNAVAILABLE", {
      reasons: ["operational_restriction"],
      retry_at: "2026-09-25T00:00:00Z",
      server_time: "2026-09-24T23:00:00Z",
    });

    await expect(appsService.getMeta()).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
      httpStatus: 503,
      requestId: "req-31",
      reasons: ["operational_restriction"],
      retryAt: "2026-09-25T00:00:00Z",
      serverTime: "2026-09-24T23:00:00Z",
    });
  });

  it("rejects fields outside the documented error envelope", async () => {
    stubErrorResponse(503, "FEATURE_UNAVAILABLE", {}, { debug: true });

    await expect(appsService.getMeta()).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
      httpStatus: 503,
    });
  });

  it.each([
    { fields: { q: 42 } },
    { reasons: ["not_implemented", 42] },
    { retry_at: "2026-02-30T00:00:00Z" },
    { server_time: "not-a-date" },
    { unexpected: true },
  ])("rejects malformed optional error details: %o", async (details) => {
    stubErrorResponse(503, "FEATURE_UNAVAILABLE", details);

    await expect(appsService.getMeta()).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
      httpStatus: 503,
    });
  });
});
