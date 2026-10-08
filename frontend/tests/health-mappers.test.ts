import { describe, expect, it } from "vitest";
import {
  mapHealthJobResponse,
  mapHealthSnapshot,
  mapCheckAccepted,
} from "../src/contracts/mappers";
import type { components } from "../src/contracts/api";

import {
  healthErrorCases,
  invalidHealthIdentifiers,
} from "./health-identifiers.fixture";

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
    ["redirect_error", 302, 0],
    ["redirect_error", null, null],
  ] as const)(
    "maps %s without changing measured nulls",
    (state, status, ms) => {
      const mapped = mapHealthSnapshot(
        snapshot(adminResult(state, status, ms)),
      );

      expect(mapped.health.result).toEqual(adminResult(state, status, ms));
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

describe("administrator health identifiers", () => {
  it.each(healthErrorCases)(
    "preserves %s / %s / %s through every response",
    (state, kind, stage, status, ms) => {
      const result = {
        ...adminResult(state, status, ms),
        error_kind: kind,
        error_stage: stage,
      };
      const wire = snapshot(result);
      expect(mapHealthSnapshot(wire).health.result).toEqual(result);
      expect(
        mapCheckAccepted({ ...wire, disposition: "result_reused" }, 200).health
          .result,
      ).toEqual(result);
      expect(
        mapCheckAccepted(
          {
            ...snapshot(result, {
              ...job,
              status: "running",
              finished_at: null,
            }),
            disposition: "created",
          },
          202,
        ).health.result,
      ).toEqual(result);
      expect(
        mapHealthJobResponse({ ...wire, job, health: wire.health }).health
          .result,
      ).toEqual(result);
    },
  );
  it.each([
    null,
    "dns_failure",
    "MiXeD_123",
    "a",
    "Z",
    "a".repeat(64),
    "Z".repeat(64),
  ])("preserves nullable/extensible identifier %j", (identifier) => {
    const result = {
      ...adminResult("network_error", null, null),
      error_kind: identifier,
      error_stage: identifier,
    };
    expect(mapHealthSnapshot(snapshot(result)).health.result).toEqual(result);
  });
  for (const field of ["error_kind", "error_stage"]) {
    it.each(invalidHealthIdentifiers)(
      `rejects malformed ${field} %j`,
      (identifier) => {
        expect(() =>
          mapHealthSnapshot(
            snapshot({
              ...adminResult("network_error", null, null),
              [field]: identifier,
            }),
          ),
        ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
      },
    );
    it(`rejects missing ${field}`, () => {
      const result = { ...adminResult("network_error", null, null) };
      Reflect.deleteProperty(result, field);
      expect(() => mapHealthSnapshot(snapshot(result))).toThrowError(
        expect.objectContaining({ code: "CONTRACT_ERROR" }),
      );
    });
  }
  it.each([
    ["healthy", { http_status: 99 }],
    ["healthy", { http_status: 600 }],
    ["healthy", { http_status: 204.5 }],
    ["healthy", { http_status: "204" }],
    ["healthy", { response_ms: NaN }],
    ["healthy", { response_ms: Infinity }],
    ["healthy", { response_ms: "0" }],
    ["healthy", { http_status: 404 }],
    ["http_error", { http_status: 204 }],
    ["timeout", {}],
    ["network_error", {}],
    ["blocked", {}],
    ["redirect_error", { http_status: 204 }],
    ["unchecked", { error_kind: "DNS_FAILURE" }],
    ["unchecked", { error_stage: "dns" }],
    ["unchecked", { http_status: 204, response_ms: 0 }],
    ["healthy", { checked_at: null }],
    ["healthy", { fresh_until: time }],
  ] as const)(
    "keeps %s measurement/state validation for %o",
    (state, patch) => {
      const result = adminResult(
        state,
        state === "unchecked" ? null : 204,
        state === "unchecked" ? null : 0,
      );
      expect(() =>
        mapHealthSnapshot(snapshot({ ...result, ...patch })),
      ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    },
  );
});
