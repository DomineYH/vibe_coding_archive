import { afterEach, describe, expect, it, vi } from "vitest";
import type { CurrentAuthState } from "../src/services/auth-service";
import { authService } from "../src/services/api/auth";
import { healthService } from "../src/services/api/health";

const batchId = "00000000-0000-4000-8000-000000000301";
const time = "2026-09-22T00:12:00.000Z";

function batch() {
  return {
    id: batchId,
    created_at: time,
    finished_at: null,
    is_finished: false,
    server_time: time,
    target_count: 2,
    processed_count: 0,
    counts: {
      queued: 2,
      running: 0,
      result_obtained: 0,
      failed: 0,
      cancelled: 0,
      reused: 0,
    },
  };
}

function adminSession(): CurrentAuthState {
  return {
    user: {
      id: "00000000-0000-4000-8000-000000000100",
      loginId: "admin",
      nickname: "관리자",
      role: "admin",
      approved: true,
      mustChangePassword: false,
      sessionKind: "full",
      expiresAt: "2026-09-22T01:12:00.000Z",
      email: null,
      phone: null,
      recentAuthUntil: null,
    },
    flow: {
      flowId: "00000000-0000-4000-8000-000000000200",
      revision: "1",
      sessionGeneration: "2",
      lastIdentityChangeRevision: "0",
    },
    observationGeneration: 0,
    sessionCookiePresent: true,
    status: "ready",
    unresolvedTransitionId: null,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("health batch API service", () => {
  it("posts once with the current admin session and maps the accepted batch", async () => {
    vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
      adminSession(),
    );
    vi.spyOn(authService, "getCsrf").mockResolvedValue({
      csrfToken: "csrf-test",
      expiresAt: "2026-09-22T01:12:00.000Z",
    });
    const fetch = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ disposition: "created", batch: batch() }, 202),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(healthService.requestBatch()).resolves.toMatchObject({
      disposition: "created",
      batch: { id: batchId, targetCount: 2, processedCount: 0 },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe("/api/v1/admin/health-check-batches");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: undefined,
    });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get("X-EduVibe-Flow-Id")).toBe(
      "00000000-0000-4000-8000-000000000200",
    );
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test");
  });

  it("reads a known batch by ID and forwards cancellation", async () => {
    vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
      adminSession(),
    );
    const controller = new AbortController();
    const fetch = vi.fn().mockResolvedValue(jsonResponse(batch()));
    vi.stubGlobal("fetch", fetch);

    await expect(
      healthService.getBatch(batchId, { signal: controller.signal }),
    ).resolves.toMatchObject({ id: batchId, isFinished: false });
    expect(fetch.mock.calls[0][0]).toBe(
      `/api/v1/admin/health-check-batches/${batchId}`,
    );
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "GET",
      signal: controller.signal,
    });
  });

  it("preserves the batch cooldown instead of retrying a write", async () => {
    vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
      adminSession(),
    );
    vi.spyOn(authService, "getCsrf").mockResolvedValue({
      csrfToken: "csrf-test",
      expiresAt: "2026-09-22T01:12:00.000Z",
    });
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "RATE_LIMITED",
            message: "전체 재검사 대기 시간입니다.",
            request_id: null,
            reasons: ["batch_cooldown"],
            retry_at: "2026-09-22T00:17:00.000Z",
            server_time: time,
          },
        },
        429,
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(healthService.requestBatch()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      reasons: ["batch_cooldown"],
      retryAt: "2026-09-22T00:17:00.000Z",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
