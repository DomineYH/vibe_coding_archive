import { describe, expect, it } from "vitest";
import {
  mapHealthJobResponse,
  mapHealthSnapshot,
  mapCheckAccepted,
} from "../src/contracts/mappers";
import type { components } from "../src/contracts/api";

const appId = "00000000-0000-4000-8000-000000000001";
const jobId = "00000000-0000-4000-8000-000000000201";
const time = "2026-09-22T00:12:00.000Z";
const job: components["schemas"]["Job"] = {
  id: jobId,
  status: "completed",
  created_at: time,
  started_at: time,
  finished_at: time,
  failure_code: null,
};

function snapshot(result: unknown, latestJob: unknown = job) {
  return {
    app_id: appId,
    url_version: 3,
    server_time: time,
    health: {
      result,
      latest_job: latestJob,
      next_check_at: null,
    },
  };
}

const adminResult = (
  state: components["schemas"]["HealthState"],
  httpStatus: number | null,
  responseMs: number | null,
) => ({
  state,
  checked_at: state === "unchecked" ? null : time,
  fresh_until: state === "unchecked" ? null : "2026-09-22T00:27:00.000Z",
  http_status: httpStatus,
  response_ms: responseMs,
  error_kind: null,
  error_stage: null,
});

describe("health response mappers", () => {
  it.each([
    ["unchecked", null, null],
    ["healthy", 204, 0],
    ["healthy", null, null],
    ["http_error", 404, 12],
    ["timeout", null, null],
    ["network_error", null, null],
    ["blocked", null, null],
    ["redirect_error", 302, 8],
  ] as const)(
    "maps %s without changing measured nulls",
    (state, status, ms) => {
      const mapped = mapHealthSnapshot(
        snapshot(adminResult(state, status, ms)),
      );

      expect(mapped).toMatchObject({
        appId,
        urlVersion: 3,
        serverTime: time,
        health: {
          result: {
            state,
            http_status: status,
            response_ms: ms,
          },
        },
      });
    },
  );

  it("keeps public health results free of administrator measurements", () => {
    const mapped = mapHealthSnapshot(
      snapshot({
        state: "healthy",
        checked_at: time,
        fresh_until: "2026-09-22T00:27:00.000Z",
      }),
    );

    expect(mapped.health.result).toEqual({
      state: "healthy",
      checked_at: time,
      fresh_until: "2026-09-22T00:27:00.000Z",
    });
  });

  it.each(["queued", "running", "completed", "failed", "cancelled"] as const)(
    "maps the %s work status independently of its result",
    (status) => {
      const currentJob = {
        ...job,
        status,
        failure_code: status === "failed" ? "worker_unavailable" : null,
      };
      const mapped = mapHealthSnapshot(
        snapshot(adminResult("http_error", 503, 18), currentJob),
      );

      expect(mapped.health.latestJob).toMatchObject({ status });
      expect(mapped.health.result.state).toBe("http_error");
    },
  );

  it("maps accepted requests and job reads with their current health snapshot", () => {
    const accepted = mapCheckAccepted({
      ...snapshot(adminResult("healthy", 200, 4), {
        ...job,
        status: "running",
        finished_at: null,
      }),
      disposition: "created",
    });
    const lookup = mapHealthJobResponse({
      app_id: appId,
      url_version: 3,
      server_time: time,
      job: { ...job, status: "failed", failure_code: "worker_unavailable" },
      health: snapshot(adminResult("healthy", 200, 4)).health,
    });

    expect(accepted.disposition).toBe("created");
    expect(lookup.job.status).toBe("failed");
    expect(lookup.health.result.state).toBe("healthy");
  });

  it.each([
    { http_status: null, response_ms: 1 },
    { http_status: 204, response_ms: null },
    { http_status: 700, response_ms: 1 },
    { http_status: 204, response_ms: -1 },
    { http_status: 404, response_ms: 5, unexpected: true },
  ])("rejects malformed or partial administrator measurements: %o", (patch) => {
    expect(() =>
      mapHealthSnapshot(
        snapshot({
          ...adminResult("healthy", 204, 1),
          ...patch,
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("rejects an unknown job status and an unknown request disposition", () => {
    expect(() =>
      mapHealthSnapshot(
        snapshot(adminResult("healthy", 200, 3), {
          ...job,
          status: "success",
        }),
      ),
    ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() =>
      mapCheckAccepted({
        ...snapshot(adminResult("unchecked", null, null)),
        disposition: "new",
      }),
    ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() =>
      mapCheckAccepted(
        {
          ...snapshot(adminResult("healthy", 200, 3), {
            ...job,
            status: "running",
            finished_at: null,
          }),
          disposition: "created",
        },
        201,
      ),
    ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });
});
