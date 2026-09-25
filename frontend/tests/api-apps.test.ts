import { afterEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/api/apps";

afterEach(() => vi.unstubAllGlobals());

describe("API service errors", () => {
  it("preserves validated error details from the API envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "검색 조건을 확인해 주세요.",
              fields: { q: "too_long" },
              request_id: "req-31",
              reasons: ["operational_restriction"],
              retry_at: "2026-09-25T00:00:00Z",
              server_time: "2026-09-24T23:00:00Z",
            },
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(appsService.list({ q: "archive" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      httpStatus: 400,
      outcome: "rejected",
      fields: { q: "too_long" },
      requestId: "req-31",
      reasons: ["operational_restriction"],
      retryAt: "2026-09-25T00:00:00Z",
      serverTime: "2026-09-24T23:00:00Z",
    });
  });

  it.each([
    {
      operation: () => appsService.get("missing"),
      status: 404,
      code: "NOT_FOUND",
    },
    {
      operation: () => appsService.getMeta(),
      status: 503,
      code: "FEATURE_UNAVAILABLE",
    },
    {
      operation: () => appsService.getMeta(),
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    },
  ])(
    "preserves documented error code $code",
    async ({ operation, status, code }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code,
                message: "Public service error",
                request_id: null,
                ...(code === "FEATURE_UNAVAILABLE"
                  ? { reasons: ["operational_restriction"] }
                  : {}),
              },
            }),
            { status },
          ),
        ),
      );

      await expect(operation()).rejects.toMatchObject({
        code,
        httpStatus: status,
        ...(code === "FEATURE_UNAVAILABLE"
          ? { reasons: ["operational_restriction"] }
          : {}),
      });
    },
  );

  it.each([
    { fields: { q: 42 } },
    { reasons: ["not_implemented", 42] },
    { retry_at: "2026-02-30T00:00:00Z" },
    { server_time: "not-a-date" },
  ])("rejects malformed optional error details: %o", async (details) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_ERROR",
              message: "Invalid query",
              request_id: "req-31",
              ...details,
            },
          }),
          { status: 400 },
        ),
      ),
    );

    await expect(appsService.list()).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
      httpStatus: 400,
    });
  });
});
