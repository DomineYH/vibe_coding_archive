import {
  mapBatchAccepted,
  mapCheckAccepted,
  mapHealthBatch,
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
  MOCK_RESET_EVENT,
  MOCK_HEALTH_RESET_EVENT,
  nextMockHealthId,
  saveMockHealthBatch,
  updateMockApp,
  type MockHealthBatch,
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

async function requireAdmin() {
  const auth = await authService.getCurrentAuthState();
  if (auth.status !== "ready")
    throw new ServiceError(
      "AUTH_TRANSITION_PENDING",
      "인증 상태를 확인한 뒤 다시 시도해 주세요.",
      { httpStatus: 409, outcome: "rejected" },
    );
  if (!auth.user || !auth.user.approved || auth.user.role !== "admin")
    throw new ServiceError("FORBIDDEN", "관리자 권한이 필요해요.", {
      httpStatus: auth.user ? 403 : 401,
      outcome: "rejected",
    });
  if (auth.user.mustChangePassword || auth.user.sessionKind !== "full")
    throw new ServiceError(
      "PASSWORD_CHANGE_REQUIRED",
      "관리자 기능을 사용하기 전에 비밀번호를 변경해 주세요.",
      { httpStatus: 403, outcome: "rejected" },
    );
}

function healthBatchWire(
  batch: MockHealthBatch,
  state: ReturnType<typeof getMockSnapshot>,
) {
  const counts = {
    queued: 0,
    running: 0,
    result_obtained: 0,
    failed: 0,
    cancelled: 0,
    reused: 0,
  };
  for (const target of batch.targets) {
    counts[target.state] += 1;
    if (target.reused) counts.reused += 1;
  }
  return {
    id: batch.id,
    created_at: batch.created_at,
    finished_at: batch.finished_at,
    is_finished: batch.finished_at !== null,
    server_time: state.mock_now,
    target_count: batch.targets.length,
    processed_count: counts.result_obtained + counts.failed + counts.cancelled,
    counts,
  };
}

function healthBatch(
  batch: MockHealthBatch,
  state: ReturnType<typeof getMockSnapshot>,
) {
  return mapHealthBatch(healthBatchWire(batch, state));
}

function acceptedBatch(
  batch: MockHealthBatch,
  state: ReturnType<typeof getMockSnapshot>,
  disposition: "created" | "active_reused",
) {
  return mapBatchAccepted(
    { disposition, batch: healthBatchWire(batch, state) },
    202,
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

  async requestBatch() {
    await requireAdmin();
    const state = getMockSnapshot();
    checkCapability(state);
    const active = state.health_batches.find(
      (batch) => batch.finished_at === null,
    );
    if (active) return acceptedBatch(active, state, "active_reused");

    const latest = [...state.health_batches].sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        right.id.localeCompare(left.id),
    )[0];
    if (latest) {
      const retryAt = future(latest.created_at, 5 * 60_000);
      if (Date.parse(state.mock_now) < Date.parse(retryAt))
        throw new ServiceError("RATE_LIMITED", "전체 재검사 대기 시간입니다.", {
          httpStatus: 429,
          outcome: "rejected",
          reasons: ["batch_cooldown"],
          retryAt,
          serverTime: state.mock_now,
        });
    }

    const apps = state.scenario === "health_batch_empty" ? [] : allApps(state);
    const now = state.mock_now;
    const batch: MockHealthBatch = {
      id: nextMockHealthId(),
      created_at: now,
      finished_at: null,
      targets: [],
    };
    for (const app of apps) {
      const job = app.health.latest_job;
      if (job && ["queued", "running"].includes(job.status)) {
        const jobState = job.status === "queued" ? "queued" : "running";
        batch.targets.push({
          app_id: app.id,
          url_version: app.url_version,
          job_id: job.id,
          state: jobState,
          reused: false,
        });
        continue;
      }
      const coolingDown =
        app.health.next_check_at !== null &&
        Date.parse(app.health.next_check_at) > Date.parse(now);
      if (
        coolingDown &&
        app.health.result.checked_at !== null &&
        app.health.result.fresh_until !== null &&
        Date.parse(now) < Date.parse(app.health.result.fresh_until)
      ) {
        batch.targets.push({
          app_id: app.id,
          url_version: app.url_version,
          job_id: null,
          state: "result_obtained",
          reused: true,
        });
        continue;
      }
      const jobId = nextMockHealthId();
      batch.targets.push({
        app_id: app.id,
        url_version: app.url_version,
        job_id: jobId,
        state: "queued",
        reused: false,
      });
      updateMockApp(
        {
          ...app,
          health: {
            ...app.health,
            latest_job: {
              id: jobId,
              status: "queued",
              created_at: now,
              started_at: null,
              finished_at: null,
              failure_code: null,
            },
          },
        },
        undefined,
        false,
      );
    }
    if (
      !batch.targets.some(
        (target) => target.state === "queued" || target.state === "running",
      )
    )
      batch.finished_at = now;
    saveMockHealthBatch(batch);
    window.dispatchEvent(new Event(MOCK_RESET_EVENT));
    return acceptedBatch(batch, getMockSnapshot(), "created");
  },

  async getBatch(batchId, { signal } = {}) {
    await requireAdmin();
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    if (!/^[0-9a-f-]{36}$/i.test(batchId))
      throw new ServiceError(
        "VALIDATION_ERROR",
        "전체 검사 배치를 확인해 주세요.",
        { outcome: "rejected" },
      );
    let state = getMockSnapshot();
    const current = state.health_batches.find((batch) => batch.id === batchId);
    if (!current)
      throw new ServiceError("NOT_FOUND", "전체 검사 배치를 찾을 수 없어요.", {
        httpStatus: 404,
        outcome: "rejected",
      });
    if (state.scenario === "health_batch_query_failure")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "전체 검사 진행을 조회하지 못했습니다.",
        { httpStatus: 503 },
      );
    if (current.finished_at !== null) return healthBatch(current, state);

    const now = state.mock_now;
    const targets = current.targets.map((target) => ({ ...target }));
    const wasRunning = targets.flatMap((target, index) =>
      target.state === "running" ? [index] : [],
    );
    for (const index of wasRunning) {
      const target = targets[index];
      const app = target.app_id ? rawApp(target.app_id) : undefined;
      const job = app?.health.latest_job;
      if (
        !app ||
        app.url_version !== target.url_version ||
        job?.id !== target.job_id
      ) {
        targets[index] = {
          ...target,
          app_id: null,
          job_id: null,
          state: "cancelled",
          reused: false,
        };
        continue;
      }
      const mixed = state.scenario === "health_batch_mixed";
      const outcome =
        mixed && index === 1
          ? "failed"
          : mixed && index === 2
            ? "cancelled"
            : "result_obtained";
      const finishedAt = now;
      const latestJob = {
        ...job,
        status:
          outcome === "result_obtained"
            ? ("completed" as const)
            : (outcome as "failed" | "cancelled"),
        started_at: job.started_at ?? now,
        finished_at: finishedAt,
        failure_code: outcome === "failed" ? "worker_unavailable" : null,
      };
      if (outcome === "result_obtained") {
        const resultState = mixed && index === 0 ? "http_error" : "healthy";
        const measurement = resultMeasures[resultState];
        updateMockApp(
          {
            ...app,
            health: {
              ...app.health,
              result: {
                state: resultState,
                checked_at: finishedAt,
                fresh_until: future(finishedAt, 15 * 60_000),
              },
              latest_job: latestJob,
              next_check_at: future(latestJob.started_at, 60_000),
            },
          },
          {
            app_id: app.id,
            url_version: app.url_version,
            ...measurement,
          },
          false,
        );
      } else {
        updateMockApp(
          {
            ...app,
            health: { ...app.health, latest_job: latestJob },
          },
          undefined,
          false,
        );
      }
      targets[index] = { ...target, state: outcome, reused: false };
    }

    const startLimit = Math.max(1, Math.ceil(targets.length / 3));
    const queued = targets.flatMap((target, index) =>
      target.state === "queued" ? [index] : [],
    );
    for (const index of queued.slice(0, startLimit)) {
      const target = targets[index];
      const app = target.app_id ? rawApp(target.app_id) : undefined;
      const job = app?.health.latest_job;
      if (
        !app ||
        app.url_version !== target.url_version ||
        job?.id !== target.job_id
      ) {
        targets[index] = {
          ...target,
          app_id: null,
          job_id: null,
          state: "cancelled",
          reused: false,
        };
        continue;
      }
      if (
        app.health.next_check_at !== null &&
        Date.parse(app.health.next_check_at) > Date.parse(now)
      )
        continue;
      if (job.status === "queued")
        updateMockApp(
          {
            ...app,
            health: {
              ...app.health,
              latest_job: { ...job, status: "running", started_at: now },
              next_check_at: future(now, 60_000),
            },
          },
          undefined,
          false,
        );
      targets[index] = { ...target, state: "running" };
    }

    const updatedBatch: MockHealthBatch = {
      ...current,
      targets,
      finished_at: targets.some(
        (target) => target.state === "queued" || target.state === "running",
      )
        ? null
        : now,
    };
    saveMockHealthBatch(updatedBatch);
    window.dispatchEvent(new Event(MOCK_RESET_EVENT));
    state = getMockSnapshot();
    return healthBatch(
      state.health_batches.find((batch) => batch.id === batchId) ??
        updatedBatch,
      state,
    );
  },
};
