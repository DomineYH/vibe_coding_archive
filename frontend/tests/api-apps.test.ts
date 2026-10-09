import { afterEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/api/apps";
import { authService } from "../src/services/api/auth";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const requests = {
  "GET /meta": () => appsService.getMeta(),
  "GET /apps": () => appsService.list(),
  "GET /apps/{id}": () => appsService.get("missing"),
};

const allowedErrors = [
  { endpoint: "GET /meta", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps", status: 409, code: "AUTH_STATE_CHANGED" },
  { endpoint: "GET /apps", status: 409, code: "AUTH_TRANSITION_PENDING" },
  { endpoint: "GET /apps", status: 503, code: "DB_BUSY" },
  { endpoint: "GET /apps/{id}", status: 422, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps/{id}", status: 409, code: "AUTH_STATE_CHANGED" },
  { endpoint: "GET /apps/{id}", status: 409, code: "AUTH_TRANSITION_PENDING" },
  { endpoint: "GET /apps/{id}", status: 503, code: "DB_BUSY" },
  { endpoint: "GET /meta", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /meta", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps", status: 503, code: "SERVICE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 400, code: "VALIDATION_ERROR" },
  { endpoint: "GET /apps/{id}", status: 404, code: "NOT_FOUND" },
  { endpoint: "GET /apps/{id}", status: 401, code: "AUTH_REQUIRED" },
  { endpoint: "GET /apps/{id}", status: 403, code: "FORBIDDEN" },
  {
    endpoint: "GET /apps/{id}",
    status: 403,
    code: "PASSWORD_CHANGE_REQUIRED",
  },
  {
    endpoint: "GET /apps/{id}",
    status: 403,
    code: "SESSION_KIND_NOT_ALLOWED",
  },
  { endpoint: "GET /apps/{id}", status: 503, code: "FEATURE_UNAVAILABLE" },
  { endpoint: "GET /apps/{id}", status: 503, code: "SERVICE_UNAVAILABLE" },
] as const;

const invalidErrors = [
  { endpoint: "GET /apps/{id}", status: 503, code: "NOT_FOUND" },
  { endpoint: "GET /meta", status: 404, code: "NOT_FOUND" },
  { endpoint: "GET /apps", status: 429, code: "RATE_LIMITED" },
  { endpoint: "GET /apps", status: 503, code: "RATE_LIMITED" },
  { endpoint: "GET /apps/{id}", status: 403, code: "INVALID_CREDENTIALS" },
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

  it("keeps detail transport and successful-response contract errors distinct", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    await expect(appsService.get("offline")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      httpStatus: undefined,
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ item: { id: "incomplete" } }), {
          status: 200,
        }),
      ),
    );

    await expect(appsService.get("malformed")).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
    });
  });

  it("keeps public reads independent from auth and CSRF, including failures", async () => {
    const getCurrentAuthState = vi.spyOn(authService, "getCurrentAuthState");
    const getCsrf = vi.spyOn(authService, "getCsrf");
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              code: "SERVICE_UNAVAILABLE",
              message: "Public service error",
              request_id: "req-31",
            },
          }),
          { status: 503 },
        ),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    for (const request of Object.values(requests))
      await expect(request()).rejects.toMatchObject({
        code: "SERVICE_UNAVAILABLE",
        httpStatus: 503,
      });

    expect(getCurrentAuthState).not.toHaveBeenCalled();
    expect(getCsrf).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, request] of vi.mocked(fetch).mock.calls) {
      expect((request?.headers as Headers).has("X-EduVibe-Flow-Id")).toBe(
        false,
      );
      expect((request?.headers as Headers).has("X-CSRF-Token")).toBe(false);
    }
  });

  it("passes read cancellation to fetch and preserves aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      appsService.list({}, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("sends trimmed search text to the server without client-side folding", async () => {
    stubErrorResponse(503, "SERVICE_UNAVAILABLE");

    await expect(appsService.list({ q: "  Ꟍ  " })).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });

    const requestUrl = new URL(
      String(vi.mocked(fetch).mock.calls[0][0]),
      "http://localhost",
    );
    expect(requestUrl.pathname).toBe("/api/v1/apps");
    expect(requestUrl.searchParams.get("q")).toBe("Ꟍ");
  });

  it("preserves canonical public list input errors as validation errors", async () => {
    stubErrorResponse(400, "VALIDATION_ERROR", {
      fields: { q: "검색어는 정규화 후 100자 이하여야 해요." },
    });

    await expect(appsService.list()).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      httpStatus: 400,
      fields: { q: "검색어는 정규화 후 100자 이하여야 해요." },
    });
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

it("getMeta preserves configured support without auth requests", async () => {
  const { mockMetaWire } = await import("../src/services/mock/apps");
  const support = {
    email: "support@example.test",
    service_url: "https://service.example.test/help",
    announcement_url: "https://notice.example.test/updates",
  };
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ ...mockMetaWire, support }), {
      status: 200,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  expect((await appsService.getMeta()).support).toEqual(support);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toContain("/api/v1/meta");
});
