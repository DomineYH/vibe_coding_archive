import type {
  AuthFlowState,
  AuthTransitionPermit,
} from "../../contracts/mappers";
import { isUuid } from "../../contracts/uuid";
import type {
  AuthService,
  CurrentAuthState,
  AuthRequestOptions,
} from "../auth-service";
import { ServiceError } from "../service-error";

export const AUTH_FLOW_KEY = "eduvibe-auth-flow-v1";
const LOCK = "eduvibe-auth-v1:api";
type Target = {
  flowId: string;
  revision: string;
  proofKind: "recovery" | "session";
};
type Record = {
  flowId?: string;
  revision?: string;
  transitionId?: string;
  progress?: "preparing" | "executing";
  resetTargets?: Target[];
};
let observation = 0;
let unsavedRecord: Record | null = null;
let unsavedSnapshot: string | null = null;

function unsupported() {
  return new ServiceError(
    "FEATURE_UNAVAILABLE",
    "이 환경에서는 인증을 준비할 수 없어요. 쿠키와 저장소를 허용하는 지원 브라우저에서 다시 확인해 주세요. 공개 아카이브는 계속 열람할 수 있습니다.",
  );
}
function readRecord(): Record | null {
  const raw = localStorage.getItem(AUTH_FLOW_KEY);
  if (unsavedRecord && raw === unsavedSnapshot) {
    const pending = unsavedRecord;
    save(pending);
    return pending;
  }
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some(
        (key) =>
          ![
            "flowId",
            "revision",
            "transitionId",
            "progress",
            "resetTargets",
          ].includes(key),
      )
    )
      throw new Error();
    if (value.flowId !== undefined && !isUuid(value.flowId)) throw new Error();
    if (
      value.revision !== undefined &&
      (typeof value.revision !== "string" ||
        !/^(0|[1-9][0-9]*)$/.test(value.revision))
    )
      throw new Error();
    if (
      value.transitionId !== undefined &&
      (!value.flowId ||
        !value.transitionId.startsWith(value.flowId + ".") ||
        !/^(0|[1-9][0-9]*)$/.test(value.transitionId.split(".")[1]))
    )
      throw new Error();
    if (
      value.progress !== undefined &&
      !["preparing", "executing"].includes(value.progress)
    )
      throw new Error();
    if (
      value.resetTargets !== undefined &&
      (!Array.isArray(value.resetTargets) ||
        value.resetTargets.some(
          (item: Target) =>
            !item ||
            Object.keys(item).some(
              (key) => !["flowId", "revision", "proofKind"].includes(key),
            ) ||
            !isUuid(item.flowId) ||
            typeof item.revision !== "string" ||
            !/^(0|[1-9][0-9]*)$/.test(item.revision) ||
            !["session", "recovery"].includes(item.proofKind),
        ))
    )
      throw new Error();
    if (!value.flowId && !value.resetTargets) throw new Error();
    return value;
  } catch {
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "저장된 인증 흐름이 손상됐어요. 식별자를 지우지 않고 공개 열람만 허용합니다.",
    );
  }
}
function save(record: Record) {
  try {
    const value = JSON.stringify(record);
    unsavedRecord = record;
    unsavedSnapshot = localStorage.getItem(AUTH_FLOW_KEY);
    localStorage.setItem(AUTH_FLOW_KEY, value);
    if (localStorage.getItem(AUTH_FLOW_KEY) !== value) throw new Error();
    unsavedRecord = null;
  } catch {
    throw unsupported();
  }
}
async function locked<T>(
  callback: () => Promise<T>,
  options?: AuthRequestOptions,
): Promise<T> {
  if (
    !window.isSecureContext ||
    !navigator.locks ||
    !window.fetch ||
    !window.AbortController ||
    !window.StorageEvent
  )
    throw unsupported();
  const controller = new AbortController();
  controller.abort();
  if (!controller.signal.aborted) throw unsupported();
  try {
    const key = `${AUTH_FLOW_KEY}:probe`;
    localStorage.setItem(key, "1");
    if (localStorage.getItem(key) !== "1") throw new Error();
    localStorage.removeItem(key);
  } catch {
    throw unsupported();
  }
  let acquired = false;
  try {
    return await navigator.locks.request(
      LOCK,
      { signal: options?.signal },
      () => {
        acquired = true;
        return callback();
      },
    );
  } catch (error) {
    if (!acquired && !options?.signal?.aborted) throw unsupported();
    throw error;
  }
}
function current(state: AuthFlowState, record: Record): CurrentAuthState {
  const result = state.requestedTransition;
  const blockedResult =
    result?.availability === "unavailable" && result.executionBlocked !== true;
  const missing =
    state.sessionGeneration !== null && !state.sessionCookiePresent;
  const unresolved =
    !!state.pendingTransition ||
    blockedResult ||
    missing ||
    !state.recoveryReady;
  return {
    user: null,
    flow: {
      flowId: state.flowId,
      revision: state.revision,
      sessionGeneration: state.sessionGeneration,
      lastIdentityChangeRevision: state.lastIdentityChangeRevision,
    },
    observationGeneration: ++observation,
    sessionCookiePresent: state.sessionCookiePresent,
    status: unresolved ? "unresolved" : "ready",
    unresolvedTransitionId:
      state.pendingTransition?.transitionId ??
      (missing || blockedResult ? (record.transitionId ?? null) : null),
  };
}
async function observe(
  service: AuthService,
  record: Record,
  options?: AuthRequestOptions,
): Promise<CurrentAuthState> {
  if (!record.flowId || record.resetTargets)
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "브라우저 인증 초기화 대상을 모두 확인해야 합니다.",
    );
  try {
    await service.getRecoveryCsrf(record.flowId, options);
  } catch (error) {
    if (
      !(error instanceof ServiceError) ||
      !["AUTH_REQUIRED", "RECOVERY_REQUIRED"].includes(error.code)
    )
      throw error;
    try {
      const csrf = await service.getCsrf(options);
      if (!csrf.authContext || csrf.authContext.flowId !== record.flowId)
        throw unsupported();
      const recovered = await service.rotateRecoveryCookie(
        record.flowId,
        {
          expectedRevision: csrf.authContext.revision,
          expectedSessionGeneration: csrf.authContext.sessionGeneration,
        },
        options,
      );
      save({ ...record, revision: recovered.revision, progress: "preparing" });
      await service.confirmRecoveryCookie(record.flowId, {
        expectedRevision: recovered.revision,
      });
    } catch (failure) {
      if (
        !(failure instanceof ServiceError) ||
        !["AUTH_REQUIRED", "RECOVERY_REQUIRED"].includes(failure.code)
      )
        throw failure;
      const eligibility = await service.getRestartEligibility(
        record.flowId,
        options,
      );
      throw new ServiceError(
        "AUTH_STATE_CHANGED",
        eligibility.restartEligible
          ? "이전 흐름이 종료됐어요. 브라우저 인증을 초기화해 주세요."
          : "인증 증명을 잃었어요. 이전 흐름이 종료될 때까지 공개 열람만 가능합니다.",
      );
    }
  }
  let state = await service.getFlowState(record.transitionId, options);
  if (state.flowId !== record.flowId)
    throw new ServiceError(
      "CONTRACT_ERROR",
      "요청한 인증 흐름을 확인할 수 없어요.",
    );
  if (!state.recoveryReady) {
    await service.confirmRecoveryCookie(record.flowId, {
      expectedRevision: state.revision,
    });
    state = await service.getFlowState(record.transitionId, options);
  }
  const result = current(state, record);
  if (result.status === "ready") {
    if (state.sessionCookiePresent) {
      const csrf = await service.getCsrf(options);
      if (
        csrf.authContext?.revision !== state.revision ||
        csrf.authContext?.sessionGeneration !== state.sessionGeneration
      )
        throw new ServiceError(
          "AUTH_STATE_CHANGED",
          "현재 세션을 다시 확인해 주세요.",
        );
      // The member always comes from the server; an anonymous S is simply no member.
      try {
        result.user = await service.getMe(options);
      } catch (error) {
        if (!(error instanceof ServiceError) || error.code !== "AUTH_REQUIRED")
          throw error;
      }
    }
    save({ flowId: state.flowId, revision: state.revision });
  }
  return result;
}
export async function observeApiAuth(
  service: AuthService,
  options?: AuthRequestOptions,
) {
  return locked(async () => {
    const record = readRecord();
    if (!record)
      throw new ServiceError(
        "FEATURE_UNAVAILABLE",
        "인증 흐름을 먼저 준비해 주세요.",
      );
    return observe(service, record, options);
  }, options);
}
async function prepare(
  service: AuthService,
  restartFrom: string[] = [],
  options?: AuthRequestOptions,
): Promise<CurrentAuthState> {
  const context = await service.getRecoveryContext(options);
  if (context.items.length) {
    save({ resetTargets: context.items });
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "저장된 흐름 ID가 없어요. 브라우저 인증 초기화를 선택해 주세요.",
    );
  }
  const created = await service.createFlow({ restartFrom });
  const record: Record = {
    flowId: created.flowId,
    revision: created.revision,
    progress: "preparing",
  };
  save(record); // Failure here must never send the first R request.
  const recovery = await service.issueRecoveryCookie(created.flowId);
  save({ ...record, revision: recovery.revision });
  await service.confirmRecoveryCookie(created.flowId, {
    expectedRevision: recovery.revision,
  });
  const state = await service.getFlowState(undefined, options);
  if (!state.recoveryReady || !state.nextTransitionId)
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "복구 쿠키 수령을 확인해야 합니다.",
    );
  return startAnonymous(service, state, options);
}
async function startAnonymous(
  service: AuthService,
  state: AuthFlowState,
  options?: AuthRequestOptions,
) {
  if (
    !state.recoveryReady ||
    !state.nextTransitionId ||
    state.pendingTransition ||
    state.sessionGeneration
  )
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "익명 인증 준비 조건을 다시 확인해 주세요.",
    );
  const executing: Record = {
    flowId: state.flowId,
    revision: state.revision,
    transitionId: state.nextTransitionId,
    progress: "executing",
  };
  save(executing);
  const permit = await service.admitTransition({
    flowId: state.flowId,
    transitionId: state.nextTransitionId,
    kind: "anonymous_session",
    expectedRevision: state.revision,
    expectedSessionGeneration: null,
  });
  save({ ...executing, revision: permit.revision });
  await service.issueAnonymousSession({
    flowId: state.flowId,
    transitionId: permit.transitionId,
    expectedRevision: permit.revision,
  });
  return observe(service, executing, options);
}
export async function prepareApiAuthFlow(
  service: AuthService,
  options?: AuthRequestOptions,
) {
  return locked(async () => {
    const record = readRecord();
    if (!record) return prepare(service, [], options);
    const observed = await observe(service, record, options);
    if (observed.status === "ready" && observed.flow.sessionGeneration === null)
      return startAnonymous(
        service,
        await service.getFlowState(undefined, options),
        options,
      );
    return observed;
  }, options);
}
/**
 * Spend one member transition permit under the shared Web Lock. The transition ID is
 * stored before admission; a lost reply leaves it for flow-state/settle, and
 * nothing here ever replays the write.
 */
export async function runApiTransition<T>(
  service: AuthService,
  kind: "login" | "logout" | "password_change" | "reauthenticate",
  execute: (
    permit: AuthTransitionPermit | null,
    state: AuthFlowState,
  ) => Promise<T>,
  options?: AuthRequestOptions,
): Promise<T> {
  return locked(async () => {
    const record = readRecord();
    if (!record?.flowId || record.resetTargets)
      throw new ServiceError(
        "FEATURE_UNAVAILABLE",
        "인증 흐름을 먼저 준비해 주세요.",
      );
    const state = await service.getFlowState(undefined, options);
    if (state.flowId !== record.flowId)
      throw new ServiceError(
        "CONTRACT_ERROR",
        "요청한 인증 흐름을 확인할 수 없어요.",
      );
    // Without any S, logout is the Origin-only 204 that settles nothing.
    if (kind === "logout" && state.sessionGeneration === null)
      return execute(null, state);
    if (
      !state.recoveryReady ||
      !state.nextTransitionId ||
      state.pendingTransition ||
      state.sessionGeneration === null ||
      !state.sessionCookiePresent
    )
      throw new ServiceError(
        "AUTH_STATE_CHANGED",
        "인증 상태를 다시 확인해 주세요.",
      );
    const executing: Record = {
      flowId: state.flowId,
      revision: state.revision,
      transitionId: state.nextTransitionId,
      progress: "executing",
    };
    save(executing);
    let permit: AuthTransitionPermit;
    try {
      permit = await service.admitTransition({
        flowId: state.flowId,
        transitionId: state.nextTransitionId,
        kind,
        expectedRevision: state.revision,
        expectedSessionGeneration: state.sessionGeneration,
      });
    } catch (error) {
      // A definite refusal created no transition, so the stored ID blocks nothing.
      if (error instanceof ServiceError && error.outcome === "rejected")
        save({ flowId: state.flowId, revision: state.revision });
      throw error;
    }
    save({ ...executing, revision: permit.revision });
    return execute(permit, state);
  }, options);
}
export async function recoverApiAuthFlow(
  service: AuthService,
  action: "settle" | "discard" | "reset",
) {
  return locked(async () => {
    let record = readRecord();
    if (action === "reset") {
      if (!record) {
        const context = await service.getRecoveryContext();
        record = { resetTargets: context.items };
        save(record);
      }
      let targets = record.resetTargets;
      if (!targets) {
        targets = [];
        if (record.flowId) {
          let revision = record.revision ?? "0";
          let proofKind: "recovery" | "session" = "recovery";
          try {
            revision = (await service.getRecoveryCsrf(record.flowId)).revision;
          } catch (error) {
            if (
              !(error instanceof ServiceError) ||
              !["AUTH_REQUIRED", "RECOVERY_REQUIRED"].includes(error.code)
            )
              throw error;
            try {
              const csrf = await service.getCsrf();
              if (
                !csrf.authContext ||
                csrf.authContext.flowId !== record.flowId
              )
                throw error;
              revision = csrf.authContext.revision;
              proofKind = "session";
            } catch (failure) {
              if (
                !(failure instanceof ServiceError) ||
                !["AUTH_REQUIRED", "RECOVERY_REQUIRED"].includes(
                  failure.code,
                ) ||
                record.progress !== "preparing"
              ) {
                if (
                  !(await service.getRestartEligibility(record.flowId))
                    .restartEligible
                )
                  throw failure;
              }
            }
          }
          targets.push({ flowId: record.flowId, revision, proofKind });
        }
      }
      save({ ...record, resetTargets: targets });
      for (const target of targets) {
        if (
          (await service.getRestartEligibility(target.flowId)).restartEligible
        )
          continue;
        try {
          const csrf = await service.getRecoveryCsrf(target.flowId);
          if (csrf.revision !== target.revision)
            throw new ServiceError(
              "AUTH_STATE_CHANGED",
              "초기화 대상의 순번이 바뀌었어요. 원래 대상을 다시 확인해 주세요.",
            );
          await service.resetFlow(target.flowId, {
            expectedRevision: target.revision,
          });
        } catch (error) {
          if (
            !(error instanceof ServiceError) ||
            !["AUTH_REQUIRED", "RECOVERY_REQUIRED"].includes(error.code)
          )
            throw error;
          try {
            const csrf = await service.getCsrf();
            if (
              !csrf.authContext ||
              csrf.authContext.flowId !== target.flowId ||
              csrf.authContext.revision !== target.revision
            )
              throw error;
            await service.resetFlow(target.flowId, {
              expectedRevision: target.revision,
              expectedSessionGeneration: csrf.authContext.sessionGeneration,
            });
          } catch (failure) {
            if (
              !(failure instanceof ServiceError) ||
              !["AUTH_REQUIRED", "RECOVERY_REQUIRED"].includes(failure.code) ||
              record.progress !== "preparing"
            )
              throw failure;
            await service.abandonFlow(target.flowId);
          }
        }
      }
      for (const target of targets)
        if (
          !(await service.getRestartEligibility(target.flowId)).restartEligible
        )
          throw new ServiceError(
            "AUTH_STATE_CHANGED",
            "원래 초기화 대상을 모두 확인해야 합니다.",
          );
      return prepare(
        service,
        targets.map((item) => item.flowId),
      );
    }
    if (!record?.flowId || !record.transitionId)
      throw new ServiceError(
        "AUTH_STATE_CHANGED",
        "확인할 인증 전환을 찾을 수 없어요.",
      );
    await service.getRecoveryCsrf(record.flowId);
    const state = await service.getFlowState(record.transitionId);
    if (action === "discard") {
      const generation = state.requestedTransition?.resultSessionGeneration;
      if (!generation || state.sessionCookiePresent)
        throw new ServiceError(
          "AUTH_STATE_CHANGED",
          "미수령 결과 세션을 확인할 수 없어요.",
        );
      await service.discardSession(record.transitionId, {
        flowId: record.flowId,
        expectedRevision: state.revision,
        expectedSessionGeneration: generation,
      });
    } else {
      await service.settleTransition(record.transitionId, {
        flowId: record.flowId,
        expectedRevision: state.revision,
      });
    }
    return observe(service, record);
  });
}
