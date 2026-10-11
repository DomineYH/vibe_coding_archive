import {
  memberState,
  memberReadContext,
  memberHeaders,
} from "./member-read-fixture";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import uuidCases from "../../contracts/fixtures/uuid-cases.json";
import type { CurrentAuthState } from "../src/services/auth-service";
import { authService } from "../src/services/api/auth";
import { healthService } from "../src/services/api/health";

const appId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000201";
const time = "2026-09-22T00:12:00.000Z";

function health(status = "running") {
  return {
    result: { state: "unchecked", checked_at: null, fresh_until: null },
    latest_job: {
      id: jobId,
      status,
      created_at: time,
      started_at: status === "queued" ? null : time,
      finished_at: null,
      failure_code: null,
    },
    next_check_at: "2026-09-22T00:13:00.000Z",
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...memberHeaders },
  });
}

function memberSession(): CurrentAuthState {
  return memberState;
}

beforeEach(() =>
  localStorage.setItem(
    "eduvibe-auth-flow-v1",
    JSON.stringify({ flowId: memberState.flow.flowId }),
  ),
);

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("health API service", () => {
  it("reads the current app health without creating a check", async () => {
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse({
        app_id: appId,
        url_version: 3,
        server_time: time,
        health: health(),
      }),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(
      healthService.getAppHealth(appId, { readContext: memberReadContext }),
    ).resolves.toMatchObject({
      appId,
      urlVersion: 3,
      health: { latestJob: { status: "running" } },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/apps/${appId}/health`);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET" });
  });

  it("sends an empty POST with the approved member session and maps 202", async () => {
    vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
      memberSession(),
    );
    vi.spyOn(authService, "getCsrf").mockResolvedValue({
      csrfToken: "csrf-test",
      expiresAt: "2026-09-22T01:12:00.000Z",
    });
    const fetch = vi.fn().mockResolvedValue(
      jsonResponse(
        {
          app_id: appId,
          url_version: 3,
          server_time: time,
          health: health("queued"),
          disposition: "created",
        },
        202,
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(healthService.requestCheck(appId)).resolves.toMatchObject({
      disposition: "created",
      health: { latestJob: { status: "queued" } },
    });
    expect(fetch.mock.calls[0][0]).toBe(`/api/v1/apps/${appId}/health-checks`);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: undefined,
    });
    const headers = new Headers(fetch.mock.calls[0][1].headers);
    expect(headers.get("X-EduVibe-Flow-Id")).toBe(
      "00000000-0000-4000-8000-000000000200",
    );
    expect(headers.get("X-EduVibe-Auth-Revision")).toBe("1");
    expect(headers.get("X-EduVibe-Session-Generation")).toBe("2");
    expect(headers.get("X-CSRF-Token")).toBe("csrf-test");
  });

  it("rejects a 200 response that claims a newly created check", async () => {
    vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
      memberSession(),
    );
    vi.spyOn(authService, "getCsrf").mockResolvedValue({
      csrfToken: "csrf-test",
      expiresAt: "2026-09-22T01:12:00.000Z",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            app_id: appId,
            url_version: 3,
            server_time: time,
            health: health("running"),
            disposition: "created",
          },
          200,
        ),
      ),
    );

    await expect(healthService.requestCheck(appId)).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
    });
  });

  it("preserves a rate limit and never retries the check automatically", async () => {
    vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
      memberSession(),
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
            message: "검사 요청 횟수 제한에 도달했습니다.",
            request_id: "req-health-1",
            reasons: ["actor_rate_limit"],
            retry_at: "2026-09-22T00:13:00.000Z",
            server_time: time,
          },
        },
        429,
      ),
    );
    vi.stubGlobal("fetch", fetch);

    await expect(healthService.requestCheck(appId)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      reasons: ["actor_rate_limit"],
      retryAt: "2026-09-22T00:13:00.000Z",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads a job by ID and keeps its current result separate", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          app_id: appId,
          url_version: 3,
          server_time: time,
          job: {
            id: jobId,
            status: "failed",
            created_at: time,
            started_at: time,
            finished_at: time,
            failure_code: "worker_unavailable",
          },
          health: {
            result: {
              state: "healthy",
              checked_at: time,
              fresh_until: "2026-09-22T00:27:00.000Z",
            },
            latest_job: null,
            next_check_at: null,
          },
        }),
      ),
    );

    await expect(
      healthService.getJob(jobId, { readContext: memberReadContext }),
    ).resolves.toMatchObject({
      job: { status: "failed" },
      health: { result: { state: "healthy" }, latestJob: null },
    });
  });
});

describe("health input UUID boundaries", () => {
  it.each(uuidCases.valid)(
    "accepts app ID %j and maps the response",
    async (id) => {
      const fetch = vi.fn().mockResolvedValue(
        jsonResponse({
          app_id: id,
          url_version: 3,
          server_time: time,
          health: health(),
        }),
      );
      vi.stubGlobal("fetch", fetch);
      await expect(
        healthService.getAppHealth(id, { readContext: memberReadContext }),
      ).resolves.toMatchObject({
        appId: id,
      });
      expect(fetch.mock.calls[0][0]).toBe(`/api/v1/apps/${id}/health`);
    },
  );

  it.each(uuidCases.invalid)(
    "rejects app, job, and batch ID %j before any request",
    async (id) => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      for (const request of [
        healthService.getAppHealth,
        healthService.requestCheck,
        healthService.getJob,
        healthService.getBatch,
      ])
        await expect(request(id)).rejects.toMatchObject({
          code: "VALIDATION_ERROR",
          outcome: "rejected",
        });
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

it("binds health polling to the captured member observation and drops a retired response", async () => {
  let current = true;
  const state = memberSession();
  const readContext = { state, isCurrent: () => current };
  let resolveResponse!: (value: Response) => void;
  const fetch = vi.fn().mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        resolveResponse = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetch);
  const pending = healthService.getAppHealth(appId, { readContext });
  await Promise.resolve();
  const headers = new Headers(fetch.mock.calls[0][1].headers);
  expect(headers.get("X-EduVibe-Flow-Id")).toBe(state.flow.flowId);
  expect(headers.get("X-EduVibe-Auth-Revision")).toBe(state.flow.revision);
  expect(headers.get("X-EduVibe-Session-Generation")).toBe(
    state.flow.sessionGeneration,
  );
  current = false;
  resolveResponse(
    jsonResponse({
      app_id: appId,
      url_version: 3,
      server_time: time,
      health: health(),
    }),
  );
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});

it("preserves stale authentication errors from private health polling", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "AUTH_STATE_CHANGED",
            message: "인증 상태가 바뀌었어요.",
            request_id: "health-read",
          },
        },
        409,
      ),
    ),
  );
  await expect(
    healthService.getAppHealth(appId, { readContext: memberReadContext }),
  ).rejects.toMatchObject({
    code: "AUTH_STATE_CHANGED",
    httpStatus: 409,
  });
});

it("preserves uppercase administrator results through snapshot, admission and polling", async () => {
  vi.spyOn(authService, "getCurrentAuthState").mockResolvedValue(
    memberSession(),
  );
  vi.spyOn(authService, "getCsrf").mockResolvedValue({
    csrfToken: "csrf-test",
    expiresAt: "2026-09-22T01:12:00.000Z",
  });
  const result = {
    state: "blocked",
    checked_at: time,
    fresh_until: "2026-09-22T00:27:00.000Z",
    http_status: null,
    response_ms: null,
    error_kind: "DESTINATION_BLOCKED",
    error_stage: "dns",
  };
  const snapshot = {
    app_id: appId,
    url_version: 3,
    server_time: time,
    health: { ...health(), result },
  };
  const job = {
    ...health().latest_job,
    status: "completed",
    finished_at: time,
  };
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(snapshot))
    .mockResolvedValueOnce(
      jsonResponse({ ...snapshot, disposition: "created" }, 202),
    )
    .mockResolvedValueOnce(jsonResponse({ ...snapshot, job }))
    .mockResolvedValueOnce(
      jsonResponse({
        ...snapshot,
        health: { ...snapshot.health, latest_job: null },
        disposition: "result_reused",
      }),
    );
  vi.stubGlobal("fetch", fetch);
  expect(
    (
      await healthService.getAppHealth(appId, {
        readContext: memberReadContext,
      })
    ).health.result,
  ).toEqual(result);
  expect((await healthService.requestCheck(appId)).health.result).toEqual(
    result,
  );
  expect(
    (await healthService.getJob(jobId, { readContext: memberReadContext }))
      .health.result,
  ).toEqual(result);
  const reused = await healthService.requestCheck(appId);
  expect(reused.disposition).toBe("result_reused");
  expect(reused.health.result).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(4);
});
