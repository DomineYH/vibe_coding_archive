import {
  mapCheckAccepted,
  mapHealthJobResponse,
  mapHealthSnapshot,
} from "../../contracts/mappers";
import type { components } from "../../contracts/api";
import { ServiceError } from "../service-error";
import type { HealthService } from "../health-service";
import { authService } from "./auth";
import { appsService } from "./apps";
import {
  assertCurrentGeneration,
  getMockSnapshot,
  MOCK_HEALTH_RESET_EVENT,
  updateMockApp,
  type MockHealthMeasurement,
} from "./state";

type MockApp = components["schemas"]["AppDetail"];
const REQUEST_WINDOWS_KEY = "eduvibe-archive-health-request-windows-v1";
window.addEventListener(MOCK_HEALTH_RESET_EVENT, () => {
  try {
    sessionStorage.removeItem(REQUEST_WINDOWS_KEY);
  } catch {
    // Reset remains available when browser storage is restricted.
  }
});

function readRequestWindows(): Record<string, number[]> {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(REQUEST_WINDOWS_KEY);
  } catch {
    throw new ServiceError(
      "MOCK_STORAGE_ERROR",
      "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
    );
  }
  if (raw === null) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ServiceError(
      "MOCK_STORAGE_ERROR",
      "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ServiceError(
      "MOCK_STORAGE_ERROR",
      "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
    );
  for (const times of Object.values(value))
    if (
      !Array.isArray(times) ||
      times.length > 10 ||
      !times.every((time) => Number.isSafeInteger(time) && time >= 0) ||
      times.some((time, index) => index > 0 && time < times[index - 1])
    )
      throw new ServiceError(
        "MOCK_STORAGE_ERROR",
        "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
      );
  return value as Record<string, number[]>;
}

function recentRequests(actor: string, now: string) {
  const timestamp = Date.parse(now);
  const windows = readRequestWindows();
  const recent = (windows[actor] ?? []).filter(
    (at) => timestamp >= at && timestamp - at < 60_000,
  );
  return { windows, recent, timestamp };
}

const resultMeasures: Record<
  Exclude<components["schemas"]["HealthState"], "unchecked">,
  Omit<MockHealthMeasurement, "app_id" | "url_version">
> = {
  healthy: {
    http_status: 204,
    response_ms: 26,
    error_kind: null,
    error_stage: null,
  },
  http_error: {
    http_status: 404,
    response_ms: 43,
    error_kind: null,
    error_stage: null,
  },
  timeout: {
    http_status: null,
    response_ms: null,
    error_kind: "timeout",
    error_stage: "response",
  },
  network_error: {
    http_status: null,
    response_ms: null,
    error_kind: "dns_failure",
    error_stage: "dns",
  },
  blocked: {
    http_status: null,
    response_ms: null,
    error_kind: "destination_blocked",
    error_stage: "policy",
  },
  redirect_error: {
    http_status: 302,
    response_ms: 18,
    error_kind: "redirect_error",
    error_stage: "redirect",
  },
};

function notFound(job = false): ServiceError {
  return new ServiceError(
    "NOT_FOUND",
    job ? "연결 검사 작업을 찾을 수 없어요." : "아카이브 앱을 찾을 수 없어요.",
    { httpStatus: 404, outcome: "rejected" },
  );
}

function allApps(state: ReturnType<typeof getMockSnapshot>): MockApp[] {
  return [...state.apps, ...state.private_apps] as unknown as MockApp[];
}

function rawApp(id: string, state = getMockSnapshot()): MockApp | undefined {
  return allApps(state).find((item) => item.id === id);
}

function rawJob(id: string) {
  const state = getMockSnapshot();
  const app = allApps(state).find((item) => item.health.latest_job?.id === id);
  return app ? { state, app, job: app.health.latest_job! } : null;
}

async function readableApp(appId: string, signal?: AbortSignal) {
  const observed = getMockSnapshot();
  await appsService.get(appId, { signal });
  assertCurrentGeneration(observed.generation, signal);
  const state = getMockSnapshot();
  const app = rawApp(appId, state);
  if (!app) throw notFound();
  return { state, app };
}

function healthView(
  app: MockApp,
  state: ReturnType<typeof getMockSnapshot>,
  admin: boolean,
) {
  const measurement = state.health_measurements.find(
    (item) => item.app_id === app.id && item.url_version === app.url_version,
  );
  return {
    ...app.health,
    result: admin
      ? {
          ...app.health.result,
          http_status: measurement?.http_status ?? null,
          response_ms: measurement?.response_ms ?? null,
          error_kind: measurement?.error_kind ?? null,
          error_stage: measurement?.error_stage ?? null,
        }
      : app.health.result,
  };
}

async function isAdmin() {
  const { user } = await authService.getCurrentAuthState();
  return Boolean(
    user?.approved &&
    user.role === "admin" &&
    user.sessionKind === "full" &&
    !user.mustChangePassword,
  );
}

function snapshot(
  app: MockApp,
  state: ReturnType<typeof getMockSnapshot>,
  admin: boolean,
) {
  return mapHealthSnapshot({
    app_id: app.id,
    url_version: app.url_version,
    server_time: state.mock_now,
    health: healthView(app, state, admin),
  });
}

function accepted(
  app: MockApp,
  state: ReturnType<typeof getMockSnapshot>,
  admin: boolean,
  disposition: "created" | "active_reused" | "result_reused",
  status: 200 | 202,
) {
  return mapCheckAccepted(
    {
      app_id: app.id,
      url_version: app.url_version,
      server_time: state.mock_now,
      health: healthView(app, state, admin),
      disposition,
    },
    status,
  );
}

function throwRateLimit(
  reason: "actor_rate_limit" | "app_cooldown",
  retryAt: string,
  now: string,
) {
  throw new ServiceError(
    "RATE_LIMITED",
    reason === "actor_rate_limit"
      ? "검사 요청 횟수 제한에 도달했습니다."
      : "이 앱은 재검사 대기 중이며, 표시할 완료 결과가 없습니다.",
    {
      httpStatus: 429,
      outcome: "rejected",
      reasons: [reason],
      retryAt,
      serverTime: now,
    },
  );
}

function future(now: string, milliseconds: number) {
  return new Date(Date.parse(now) + milliseconds).toISOString();
}

function checkCapability(state: ReturnType<typeof getMockSnapshot>) {
  if (state.scenario === "health_check_unavailable")
    throw new ServiceError(
      "FEATURE_UNAVAILABLE",
      "현재 연결 검사 기능을 사용할 수 없습니다.",
      { httpStatus: 503, reasons: ["operational_restriction"] },
    );
}

export const healthService: HealthService = {
  async getAppHealth(appId, { signal } = {}) {
    const { state, app } = await readableApp(appId, signal);
    return snapshot(app, state, await isAdmin());
  },

  async requestCheck(appId) {
    const { app } = await readableApp(appId);
    const auth = await authService.getCurrentAuthState();
    if (auth.status !== "ready")
      throw new ServiceError(
        "AUTH_TRANSITION_PENDING",
        "인증 상태를 확인한 뒤 다시 시도해 주세요.",
        { httpStatus: 409, outcome: "rejected" },
      );
    if (
      auth.user &&
      (!auth.user.approved ||
        auth.user.mustChangePassword ||
        auth.user.sessionKind !== "full")
    )
      throw new ServiceError(
        auth.user.mustChangePassword || auth.user.sessionKind !== "full"
          ? "PASSWORD_CHANGE_REQUIRED"
          : "FORBIDDEN",
        "연결 검사를 요청할 권한이 없어요.",
        { httpStatus: 403, outcome: "rejected" },
      );

    const state = getMockSnapshot();
    checkCapability(state);
    const now = state.mock_now;
    const actor = auth.user?.id ?? auth.flow?.flowId ?? "anonymous";
    const { windows, recent, timestamp } = recentRequests(actor, now);
    if (state.scenario === "health_actor_rate_limit" || recent.length >= 10)
      throwRateLimit(
        "actor_rate_limit",
        recent.length >= 10
          ? new Date(recent[0] + 60_000).toISOString()
          : future(now, 60_000),
        now,
      );
    for (const [requestActor, times] of Object.entries(windows)) {
      const active = times.filter(
        (at) => timestamp >= at && timestamp - at < 60_000,
      );
      if (active.length) windows[requestActor] = active;
      else delete windows[requestActor];
    }
    windows[actor] = [...recent, timestamp];
    try {
      sessionStorage.setItem(REQUEST_WINDOWS_KEY, JSON.stringify(windows));
    } catch {
      throw new ServiceError(
        "MOCK_STORAGE_ERROR",
        "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
      );
    }

    const current = rawApp(appId, state);
    if (!current || current.url_version !== app.url_version) throw notFound();
    const currentJob = current.health.latest_job;
    if (currentJob && ["queued", "running"].includes(currentJob.status))
      return accepted(
        current,
        state,
        auth.user?.role === "admin",
        "active_reused",
        202,
      );

    const nextCheckAt =
      state.scenario === "health_app_cooldown"
        ? (current.health.next_check_at ?? future(now, 60_000))
        : current.health.next_check_at;
    const coolingDown =
      nextCheckAt !== null && Date.parse(now) < Date.parse(nextCheckAt);
    if (coolingDown) {
      if (
        current.health.result.state !== "unchecked" &&
        current.health.result.fresh_until !== null &&
        Date.parse(now) < Date.parse(current.health.result.fresh_until)
      )
        return accepted(
          current,
          state,
          auth.user?.role === "admin",
          "result_reused",
          200,
        );
      throwRateLimit("app_cooldown", nextCheckAt, now);
    }

    const status =
      state.scenario === "health_job_queued" ? "queued" : "running";
    const job: NonNullable<MockApp["health"]["latest_job"]> = {
      id: crypto.randomUUID(),
      status,
      created_at: now,
      started_at: status === "running" ? now : null,
      finished_at: null,
      failure_code: null,
    };
    const updated: MockApp = {
      ...current,
      health: {
        ...current.health,
        latest_job: job,
        next_check_at:
          status === "running"
            ? future(now, 60_000)
            : current.health.next_check_at,
      },
    };
    updateMockApp(updated);
    const nextState = getMockSnapshot();
    return accepted(
      updated,
      nextState,
      auth.user?.role === "admin",
      "created",
      202,
    );
  },

  async getJob(jobId, { signal } = {}) {
    const found = rawJob(jobId);
    if (!found) throw notFound(true);
    const observedGeneration = found.state.generation;
    await readableApp(found.app.id, signal);
    if (found.state.scenario === "health_job_query_failure")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "검사 진행 상태를 조회하지 못했습니다.",
        { httpStatus: 503 },
      );
    if (found.state.scenario === "health_late_response") {
      await new Promise((resolve) => setTimeout(resolve, 150));
      assertCurrentGeneration(observedGeneration, signal);
    }

    let state = getMockSnapshot();
    let app = rawApp(found.app.id, state);
    if (
      !app ||
      app.url_version !== found.app.url_version ||
      app.health.latest_job?.id !== jobId
    )
      throw notFound(true);
    const latestJob = app.health.latest_job;
    if (!latestJob) throw notFound(true);
    let job = latestJob;
    if (
      ["queued", "running"].includes(job.status) &&
      ![
        "health_job_queued",
        "health_job_running",
        "health_late_response",
      ].includes(state.scenario)
    ) {
      const finishedAt = state.mock_now;
      if (
        state.scenario === "health_job_failed" ||
        state.scenario === "health_job_cancelled"
      ) {
        job = {
          ...job,
          status:
            state.scenario === "health_job_failed" ? "failed" : "cancelled",
          finished_at: finishedAt,
          failure_code:
            state.scenario === "health_job_failed"
              ? "worker_unavailable"
              : null,
        };
        app = { ...app, health: { ...app.health, latest_job: job } };
        updateMockApp(app);
      } else {
        const resultState = state.scenario.startsWith("health_result_")
          ? state.scenario.slice("health_result_".length)
          : "healthy";
        if (resultState === "unchecked" || !(resultState in resultMeasures))
          throw new TypeError("Unsupported health result scenario");
        const stateName = resultState as keyof typeof resultMeasures;
        job = { ...job, status: "completed", finished_at: finishedAt };
        app = {
          ...app,
          health: {
            ...app.health,
            result: {
              state: stateName,
              checked_at: finishedAt,
              fresh_until: future(finishedAt, 15 * 60_000),
            },
            latest_job: job,
          },
        };
        updateMockApp(app, {
          app_id: app.id,
          url_version: app.url_version,
          ...resultMeasures[stateName],
        });
      }
      state = getMockSnapshot();
      app = rawApp(found.app.id, state)!;
      job = app.health.latest_job!;
    }

    if (!app || !job) throw notFound(true);
    return mapHealthJobResponse({
      app_id: app.id,
      url_version: app.url_version,
      server_time: state.mock_now,
      job,
      health: healthView(app, state, await isAdmin()),
    });
  },
};
