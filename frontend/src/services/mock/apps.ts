import catalog from "../../../../contracts/catalog.json";
import {
  mapAppWriteOperation,
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
} from "../../contracts/mappers";
import type { components } from "../../contracts/api";
import { ServiceError } from "../service-error";
import {
  appPatchToWire,
  appInputToWire,
  caseFold,
  normalizeAppInput,
  normalizeAppPatch,
  normalizeQueryForService,
  type AppsService,
} from "../apps-service";
import {
  assertCurrentGeneration,
  createMockApp,
  deleteMockApp,
  getMockAccounts,
  getMockSnapshot,
  MOCK_WRITE_OPERATIONS_RESET_EVENT,
  MOCK_ACCOUNT_DELETED_EVENT,
  updateMockApp,
} from "./state";

type WireAppDetail = components["schemas"]["AppDetail"];
type MockMeta = components["schemas"]["Meta"];
const subjects = catalog.subjects as MockMeta["subjects"];
const grades = catalog.grades as MockMeta["grades"];
const fixedTime = "2026-09-22T00:12:00.000Z";
const readDelayMs = 300;
const createDelayMs = 500;
const operationLifetimeMs = 24 * 60 * 60 * 1000;
type MockAppWriteOperation = {
  key: string;
  kind: "app_create" | "app_update" | "app_delete";
  actorId: string;
  input:
    | ReturnType<typeof normalizeAppInput>
    | ReturnType<typeof normalizeAppPatch>
    | null;
  expectedVersion: number | null;
  issuedAt: string;
  expiresAt: string;
  state: "unresolved" | "confirming_deletion" | "succeeded" | "rejected";
  targetId: string | null;
  dbAppliedAt: string | null;
  finalizedAt: string | null;
  resultVersion: number | null;
  rejectionCode: string | null;
};
const appWriteOperations = new Map<string, MockAppWriteOperation>();
window.addEventListener(MOCK_WRITE_OPERATIONS_RESET_EVENT, () =>
  appWriteOperations.clear(),
);
window.addEventListener(MOCK_ACCOUNT_DELETED_EVENT, (event) => {
  const accountId = (event as CustomEvent<{ accountId: string }>).detail
    .accountId;
  for (const [key, operation] of appWriteOperations) {
    if (operation.actorId === accountId) appWriteOperations.delete(key);
  }
});
const longCopy = Array.from(
  { length: 32 },
  (_, index) =>
    `${index + 1}. 학생의 풀이를 먼저 묻고, 개념을 설명한 뒤 새로운 예제로 이해를 확인합니다. 정답보다 풀이 과정을 격려하고, 필요한 경우 단계별 힌트를 제공합니다.`,
).join("\n\n");
const capabilities = {
  apps_read: { enabled: true, reasons: [] },
  auth_register: { enabled: true, reasons: [] },
  auth_login: { enabled: true, reasons: [] },
  auth_logout: { enabled: true, reasons: [] },
  auth_password_change: { enabled: true, reasons: [] },
  admin_users_read: { enabled: false, reasons: ["not_implemented"] },
  admin_approval: { enabled: false, reasons: ["not_implemented"] },
  admin_summary: { enabled: false, reasons: ["not_implemented"] },
  apps_create: { enabled: true, reasons: [] },
  apps_update_own: { enabled: true, reasons: [] },
  apps_delete_own: { enabled: true, reasons: [] },
  admin_apps_read: { enabled: true, reasons: [] },
  admin_apps_manage: { enabled: true, reasons: [] },
  admin_reauth: { enabled: false, reasons: ["not_implemented"] },
  admin_password_reset: { enabled: false, reasons: ["not_implemented"] },
  admin_user_delete: { enabled: false, reasons: ["not_implemented"] },
  health_read: { enabled: false, reasons: ["not_implemented"] },
  health_check: { enabled: false, reasons: ["not_implemented"] },
  health_batch: { enabled: false, reasons: ["not_implemented"] },
  email_collection: { enabled: false, reasons: ["collection_disabled"] },
  phone_collection: { enabled: false, reasons: ["collection_disabled"] },
} satisfies MockMeta["capabilities"];

const mockMeta: MockMeta = {
  subjects,
  grades,
  themes: catalog.themes as MockMeta["themes"],
  server_time: fixedTime,
  capabilities,
  support: { email: null, service_url: null, announcement_url: null },
  initial_pending_days: 90,
};

function toCard(app: WireAppDetail): components["schemas"]["AppCard"] {
  const {
    id,
    owner,
    name,
    subject,
    grades,
    is_public,
    theme_id,
    version,
    url_version,
    health,
  } = app;
  return {
    id,
    owner,
    name,
    subject,
    grades,
    is_public,
    theme_id,
    version,
    url_version,
    health,
  };
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Request aborted", "AbortError");
}

function scenarioApps(state: Awaited<ReturnType<typeof beginRead>>) {
  const apps = state.apps as WireAppDetail[];
  if (
    state.scenario === "long_list" ||
    state.scenario === "duplicate_pages" ||
    state.scenario === "no_progress" ||
    state.scenario === "next_page_failure"
  ) {
    const expanded = [
      ...apps,
      ...Array.from({ length: 12 }, (_, index) => {
        const app = apps[index % apps.length];
        const createdAt = new Date(
          Date.parse(fixedTime) - index * 1000,
        ).toISOString();
        return {
          ...app,
          id: `00000000-0000-4000-8000-${String(index + 201).padStart(12, "0")}`,
          name: `${app.name} · 긴 목록 ${index + 1}`,
          created_at: createdAt,
          updated_at: createdAt,
        };
      }),
    ].sort(sortApps);
    if (
      state.scenario === "long_list" ||
      state.scenario === "no_progress" ||
      state.scenario === "next_page_failure"
    )
      return expanded;

    const firstPage = expanded.slice(0, 24);
    const duplicatePage = firstPage.map((app) => ({
      ...app,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    }));
    const lastPage = firstPage.slice(0, 4).map((app, index) => ({
      ...app,
      id: `00000000-0000-4000-8000-${String(index + 301).padStart(12, "0")}`,
      name: `${app.name} · 마지막 페이지 ${index + 1}`,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    }));
    return [...firstPage, ...duplicatePage, ...lastPage];
  }
  if (state.scenario === "long_copy")
    return apps.map((app, index) =>
      index === 0 ? { ...app, description: longCopy, prompt: longCopy } : app,
    );
  return apps;
}

function sortApps(left: WireAppDetail, right: WireAppDetail): number {
  return (
    Date.parse(right.created_at) - Date.parse(left.created_at) ||
    right.id.localeCompare(left.id)
  );
}

async function beginRead(signal?: AbortSignal) {
  checkSignal(signal);
  const state = getMockSnapshot();
  await Promise.resolve();
  assertCurrentGeneration(state.generation, signal);
  return state;
}

function currentMember() {
  const state = getMockSnapshot();
  const session = state.principal_session;
  if (
    !state.auth_flow.recovery_ready ||
    Date.parse(state.mock_now) >= Date.parse(state.auth_flow.expires_at) ||
    !state.auth_flow.session_cookie_present ||
    state.auth_flow.pending_transition ||
    state.auth_flow.unresolved_transition_id ||
    !session ||
    Date.parse(state.mock_now) >= Date.parse(session.expires_at)
  )
    throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
      httpStatus: 401,
      outcome: "rejected",
    });
  if (session.session_kind !== "full")
    throw new ServiceError(
      "PASSWORD_CHANGE_REQUIRED",
      "회원 기능을 사용하기 전에 비밀번호를 변경해 주세요.",
      { httpStatus: 403, outcome: "rejected" },
    );
  const account = getMockAccounts(state).find(
    (item) => item.id === state.principal_id,
  );
  if (!account || !account.approved)
    throw new ServiceError(
      "FORBIDDEN",
      "승인된 회원만 앱을 등록할 수 있어요.",
      {
        httpStatus: 403,
        outcome: "rejected",
      },
    );
  if (account.mustChangePassword)
    throw new ServiceError(
      "PASSWORD_CHANGE_REQUIRED",
      "비밀번호를 먼저 변경해 주세요.",
      { httpStatus: 403, outcome: "rejected" },
    );
  return { state, account };
}

function operationWire(operation: MockAppWriteOperation) {
  return mapAppWriteOperation({
    key: operation.key,
    kind: operation.kind,
    target_id: operation.targetId,
    issued_at: operation.issuedAt,
    expires_at: operation.expiresAt,
    state: operation.state,
    db_applied_at: operation.dbAppliedAt,
    finalized_at: operation.finalizedAt,
    result_version: operation.resultVersion,
    rejection_code: operation.rejectionCode,
    server_time: getMockSnapshot().mock_now,
  });
}

function ownedOperation(key: string, actorId: string) {
  const operation = appWriteOperations.get(key);
  if (!operation || operation.actorId !== actorId)
    throw new ServiceError(
      "OPERATION_NOT_FOUND",
      "저장 작업을 찾을 수 없어요.",
      {
        httpStatus: 404,
        outcome: "rejected",
      },
    );
  return operation;
}

function assertOperationNotExpired(
  operation: MockAppWriteOperation,
  now: string,
) {
  if (Date.parse(now) < Date.parse(operation.expiresAt)) return;
  throw new ServiceError(
    "OPERATION_EXPIRED",
    "작업 결과 확인 기간이 만료되었어요.",
    { httpStatus: 410, outcome: "unknown" },
  );
}

function manageableApp(
  id: string,
  actor: ReturnType<typeof getMockAccounts>[number],
  state = getMockSnapshot(),
) {
  const app = [...state.apps, ...state.private_apps].find(
    (item) => item.id === id,
  );
  if (
    !app ||
    (app.owner.id !== actor.id &&
      (actor.role !== "admin" || !capabilities.admin_apps_manage.enabled))
  )
    throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
      httpStatus: 404,
      outcome: "rejected",
    });
  return app;
}

function versionConflict() {
  return new ServiceError(
    "VERSION_CONFLICT",
    "앱이 다른 내용으로 수정되었어요. 최신 내용을 확인해 주세요.",
    { httpStatus: 409, outcome: "rejected" },
  );
}

function writeApp(
  input: ReturnType<typeof normalizeAppInput>,
  owner: {
    id: string;
    nickname: string;
  },
  now: string,
) {
  const wire = appInputToWire(input);
  const app = createMockApp({
    owner: { id: owner.id, nickname: owner.nickname },
    name: wire.name,
    subject: wire.subject,
    grades: wire.grades,
    is_public: wire.is_public,
    theme_id: wire.theme_id,
    version: 1,
    url_version: 1,
    health: {
      result: { state: "unchecked", checked_at: null, fresh_until: null },
      latest_job: null,
      next_check_at: null,
    },
    url: wire.url,
    prompt: wire.prompt,
    description: wire.description,
    stack_db: wire.stack_db,
    stack_backend: wire.stack_backend,
    stack_frontend: wire.stack_frontend,
    stack_hosting: wire.stack_hosting,
    created_at: now,
    updated_at: now,
  });
  return app;
}

function failUnknown(
  message = "저장 결과를 확인할 수 없어요. 먼저 작업 결과를 확인해 주세요.",
) {
  throw new ServiceError("SERVICE_UNAVAILABLE", message, {
    httpStatus: 503,
    outcome: "unknown",
  });
}

export const appsService: AppsService = {
  async getMeta({ signal } = {}) {
    checkSignal(signal);
    return mapMeta(mockMeta);
  },

  async list(query, { signal } = {}) {
    const normalized = normalizeQueryForService(query);
    const state = await beginRead(signal);
    if (
      state.scenario === "list_failure" ||
      state.scenario === "list_refetch_failure"
    ) {
      if (state.scenario === "list_refetch_failure") {
        await new Promise((resolve) => setTimeout(resolve, readDelayMs));
        assertCurrentGeneration(state.generation, signal);
      }
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "목록을 불러오지 못했어요. 다시 시도해 주세요.",
      );
    }
    if (state.scenario === "next_page_failure" && normalized.offset > 0) {
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "다음 목록을 불러오지 못했어요.",
      );
    }
    if (state.scenario === "list_delayed") {
      const ignoreAbort = normalized.q === "slow";
      await new Promise((resolve) =>
        setTimeout(resolve, ignoreAbort ? readDelayMs * 3 : readDelayMs),
      );
      // Exercise query-key isolation even when a transport cannot cancel.
      assertCurrentGeneration(
        state.generation,
        ignoreAbort ? undefined : signal,
      );
    }
    const publicApps = state.scenario === "empty" ? [] : scenarioApps(state);
    const matching = publicApps.filter((app) => {
      if (!app.is_public) return false;
      if (normalized.subject && app.subject !== normalized.subject)
        return false;
      if (normalized.grade && !app.grades.includes(normalized.grade))
        return false;
      if (!normalized.q) return true;
      return [app.name, app.owner.nickname, app.description].some((field) =>
        caseFold(field.normalize("NFC")).includes(normalized.q!),
      );
    });
    const subjectsInUse = new Set(
      publicApps.filter((app) => app.is_public).map((app) => app.subject),
    );
    if (state.scenario !== "visual_fixture") matching.sort(sortApps);
    const offset =
      state.scenario === "no_progress" && normalized.offset > 0
        ? 0
        : normalized.offset;
    const page = {
      items: matching
        .slice(normalized.offset, normalized.offset + normalized.limit)
        .map(toCard),
      pagination: {
        limit: normalized.limit,
        offset,
        total: matching.length,
        has_more: normalized.offset + normalized.limit < matching.length,
      },
      server_time: fixedTime,
      facets: {
        subjects_in_use: subjects.filter((subject) =>
          subjectsInUse.has(subject),
        ),
      },
    };
    return mapAppPage(page);
  },

  async get(id, { signal } = {}) {
    const state = await beginRead(signal);
    if (state.scenario === "detail_delayed") {
      await new Promise((resolve) => setTimeout(resolve, readDelayMs));
      assertCurrentGeneration(state.generation, signal);
    }
    const app = [...scenarioApps(state), ...state.private_apps].find(
      (item) => item.id === id,
    );
    const account = getMockAccounts(state).find(
      (item) => item.id === state.principal_id,
    );
    const session = state.principal_session;
    const authReady =
      state.auth_flow.recovery_ready &&
      Date.parse(state.mock_now) < Date.parse(state.auth_flow.expires_at) &&
      state.auth_flow.session_cookie_present &&
      !state.auth_flow.pending_transition &&
      !state.auth_flow.unresolved_transition_id;
    const fullSession =
      authReady &&
      session?.session_kind === "full" &&
      Date.parse(state.mock_now) < Date.parse(session.expires_at);
    const canReadPrivate =
      app?.is_public ||
      (fullSession &&
        account !== undefined &&
        (account.role === "admin" || app?.owner.id === account.id));
    if (!app || !canReadPrivate)
      throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
        outcome: "rejected",
        httpStatus: 404,
      });
    const result = mapAppDetailResponse({
      item: app,
      server_time: fixedTime,
    }).item;
    return result;
  },

  async issueCreateOperation(value) {
    const input = normalizeAppInput(value);
    const { state, account } = currentMember();
    if (state.scenario === "app_key_issue_failure")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "저장 작업을 준비하지 못했어요.",
        {
          httpStatus: 503,
          outcome: "rejected",
        },
      );
    const issuedAt = state.mock_now;
    const operation: MockAppWriteOperation = {
      key: crypto.randomUUID(),
      kind: "app_create",
      actorId: account.id,
      input,
      expectedVersion: null,
      issuedAt,
      expiresAt: new Date(
        Date.parse(issuedAt) + operationLifetimeMs,
      ).toISOString(),
      state: "unresolved",
      targetId: null,
      dbAppliedAt: null,
      finalizedAt: null,
      resultVersion: null,
      rejectionCode: null,
    };
    appWriteOperations.set(operation.key, operation);
    return operationWire(operation);
  },

  async create(value, key) {
    const input = normalizeAppInput(value);
    const { state, account } = currentMember();
    let operation = ownedOperation(key, account.id);
    if (
      operation.kind !== "app_create" ||
      JSON.stringify(input) !== JSON.stringify(operation.input)
    )
      throw new ServiceError(
        "OPERATION_KEY_MISMATCH",
        "저장 요청 내용이 작업 키와 달라요.",
        { httpStatus: 409, outcome: "rejected" },
      );
    assertOperationNotExpired(operation, state.mock_now);
    if (operation.state !== "unresolved")
      throw new ServiceError(
        "OPERATION_ALREADY_RESOLVED",
        "저장 작업 결과를 먼저 확인해 주세요.",
        { httpStatus: 409, outcome: "unknown" },
      );
    if (state.scenario === "app_create_unresolved") failUnknown();
    if (state.scenario === "app_create_failure") {
      operation = {
        ...operation,
        state: "rejected",
        finalizedAt: state.mock_now,
        rejectionCode: "VALIDATION_ERROR",
      };
      appWriteOperations.set(key, operation);
      throw new ServiceError(
        "VALIDATION_ERROR",
        "앱을 등록하지 못했어요. 입력 내용을 확인해 주세요.",
        { httpStatus: 422, outcome: "rejected" },
      );
    }
    if (state.scenario === "app_create_delayed") {
      const flow = state.auth_flow;
      await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      const current = currentMember();
      if (
        current.account.id !== account.id ||
        current.state.auth_flow.flow_id !== flow.flow_id ||
        current.state.auth_flow.revision !== flow.revision ||
        current.state.auth_flow.session_generation !== flow.session_generation
      )
        throw new ServiceError(
          "AUTH_STATE_CHANGED",
          "인증 상태가 바뀌어 앱을 등록하지 않았어요.",
          { httpStatus: 409, outcome: "rejected" },
        );
      operation = ownedOperation(key, account.id);
      if (operation.state !== "unresolved")
        throw new ServiceError(
          "OPERATION_ALREADY_RESOLVED",
          "저장 작업 결과를 먼저 확인해 주세요.",
          { httpStatus: 409, outcome: "unknown" },
        );
    }
    const now = getMockSnapshot().mock_now;
    const app = writeApp(input, account, now);
    operation = {
      ...operation,
      state: "succeeded",
      targetId: app.id,
      dbAppliedAt: now,
      finalizedAt: now,
      resultVersion: 1,
    };
    appWriteOperations.set(key, operation);
    if (state.scenario === "app_create_unknown") failUnknown();
    return mapAppDetailResponse({ item: app, server_time: now }).item;
  },

  async issueUpdateOperation(id, value, expectedVersion) {
    const input = normalizeAppPatch(value);
    const { state, account } = currentMember();
    const app = manageableApp(id, account, state);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new ServiceError("VALIDATION_ERROR", "수정 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    if (app.version !== expectedVersion) throw versionConflict();
    if (state.scenario === "app_key_issue_failure")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "저장 작업을 준비하지 못했어요.",
        { httpStatus: 503, outcome: "rejected" },
      );
    const issuedAt = state.mock_now;
    const operation: MockAppWriteOperation = {
      key: crypto.randomUUID(),
      kind: "app_update",
      actorId: account.id,
      input,
      expectedVersion,
      issuedAt,
      expiresAt: new Date(
        Date.parse(issuedAt) + operationLifetimeMs,
      ).toISOString(),
      state: "unresolved",
      targetId: id,
      dbAppliedAt: null,
      finalizedAt: null,
      resultVersion: null,
      rejectionCode: null,
    };
    appWriteOperations.set(operation.key, operation);
    return operationWire(operation);
  },

  async update(id, value, expectedVersion, key) {
    const input = normalizeAppPatch(value);
    const { state, account } = currentMember();
    let operation = ownedOperation(key, account.id);
    if (
      operation.kind !== "app_update" ||
      operation.targetId !== id ||
      operation.expectedVersion !== expectedVersion ||
      JSON.stringify(input) !== JSON.stringify(operation.input)
    )
      throw new ServiceError(
        "OPERATION_KEY_MISMATCH",
        "저장 요청 내용이 작업 키와 달라요.",
        { httpStatus: 409, outcome: "rejected" },
      );
    assertOperationNotExpired(operation, state.mock_now);
    if (operation.state !== "unresolved")
      throw new ServiceError(
        "OPERATION_ALREADY_RESOLVED",
        "저장 작업 결과를 먼저 확인해 주세요.",
        { httpStatus: 409, outcome: "unknown" },
      );
    if (state.scenario === "app_update_unresolved") failUnknown();
    if (state.scenario === "app_update_failure") {
      operation = {
        ...operation,
        state: "rejected",
        finalizedAt: state.mock_now,
        rejectionCode: "VALIDATION_ERROR",
      };
      appWriteOperations.set(key, operation);
      throw new ServiceError(
        "VALIDATION_ERROR",
        "앱을 수정하지 못했어요. 입력 내용을 확인해 주세요.",
        { httpStatus: 422, outcome: "rejected" },
      );
    }
    if (state.scenario === "app_update_delayed") {
      const flow = state.auth_flow;
      await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      const current = currentMember();
      if (
        current.account.id !== account.id ||
        current.state.auth_flow.flow_id !== flow.flow_id ||
        current.state.auth_flow.revision !== flow.revision ||
        current.state.auth_flow.session_generation !== flow.session_generation
      )
        throw new ServiceError(
          "AUTH_STATE_CHANGED",
          "인증 상태가 바뀌어 앱을 수정하지 않았어요.",
          { httpStatus: 409, outcome: "rejected" },
        );
      operation = ownedOperation(key, account.id);
      if (operation.state !== "unresolved")
        throw new ServiceError(
          "OPERATION_ALREADY_RESOLVED",
          "저장 작업 결과를 먼저 확인해 주세요.",
          { httpStatus: 409, outcome: "unknown" },
        );
    }
    const app = manageableApp(id, account, state);
    if (app.version !== expectedVersion) {
      operation = {
        ...operation,
        state: "rejected",
        finalizedAt: getMockSnapshot().mock_now,
        rejectionCode: "VERSION_CONFLICT",
      };
      appWriteOperations.set(key, operation);
      throw versionConflict();
    }
    const patch = appPatchToWire(input);
    const nextUrl = patch.url ?? app.url;
    const urlChanged = withoutFragment(nextUrl) !== withoutFragment(app.url);
    const now = getMockSnapshot().mock_now;
    const updatedApp = {
      ...app,
      ...patch,
      version: app.version + 1,
      url_version: urlChanged ? app.url_version + 1 : app.url_version,
      health: urlChanged
        ? {
            ...app.health,
            result: {
              state: "unchecked" as const,
              checked_at: null,
              fresh_until: null,
            },
            latest_job: null,
          }
        : app.health,
      updated_at: now,
    } as WireAppDetail;
    updateMockApp(updatedApp);
    operation = {
      ...operation,
      state: "succeeded",
      dbAppliedAt: now,
      finalizedAt: now,
      resultVersion: updatedApp.version,
    };
    appWriteOperations.set(key, operation);
    if (state.scenario === "app_update_unknown") failUnknown();
    return mapAppDetailResponse({ item: updatedApp, server_time: now }).item;
  },

  async getCreateOperation(key) {
    const { state, account } = currentMember();
    const operation = ownedOperation(key, account.id);
    if (operation.kind !== "app_create")
      throw new ServiceError(
        "OPERATION_NOT_FOUND",
        "저장 작업을 찾을 수 없어요.",
        {
          httpStatus: 404,
          outcome: "rejected",
        },
      );
    assertOperationNotExpired(operation, state.mock_now);
    return operationWire(operation);
  },

  async getUpdateOperation(key) {
    const { state, account } = currentMember();
    const operation = ownedOperation(key, account.id);
    if (operation.kind !== "app_update")
      throw new ServiceError(
        "OPERATION_NOT_FOUND",
        "저장 작업을 찾을 수 없어요.",
        {
          httpStatus: 404,
          outcome: "rejected",
        },
      );
    assertOperationNotExpired(operation, state.mock_now);
    return operationWire(operation);
  },

  async issueDeleteOperation(id, expectedVersion) {
    const { state, account } = currentMember();
    const app = manageableApp(id, account, state);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)
      throw new ServiceError("VALIDATION_ERROR", "삭제 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    if (app.version !== expectedVersion) throw versionConflict();
    if (state.scenario === "app_key_issue_failure")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "삭제 작업을 준비하지 못했어요.",
        { httpStatus: 503, outcome: "rejected" },
      );
    const issuedAt = state.mock_now;
    const operation: MockAppWriteOperation = {
      key: crypto.randomUUID(),
      kind: "app_delete",
      actorId: account.id,
      input: null,
      expectedVersion,
      issuedAt,
      expiresAt: new Date(
        Date.parse(issuedAt) + operationLifetimeMs,
      ).toISOString(),
      state: "unresolved",
      targetId: id,
      dbAppliedAt: null,
      finalizedAt: null,
      resultVersion: null,
      rejectionCode: null,
    };
    appWriteOperations.set(operation.key, operation);
    return operationWire(operation);
  },

  async delete(id, expectedVersion, key) {
    const { state, account } = currentMember();
    let operation = ownedOperation(key, account.id);
    if (
      operation.kind !== "app_delete" ||
      operation.targetId !== id ||
      operation.expectedVersion !== expectedVersion
    )
      throw new ServiceError(
        "OPERATION_KEY_MISMATCH",
        "삭제 요청이 작업 키와 달라요.",
        { httpStatus: 409, outcome: "rejected" },
      );
    assertOperationNotExpired(operation, state.mock_now);
    if (operation.state === "succeeded") return;
    if (operation.state === "confirming_deletion") {
      operation = {
        ...operation,
        state: "succeeded",
        finalizedAt: state.mock_now,
      };
      appWriteOperations.set(key, operation);
      return;
    }
    if (operation.state !== "unresolved")
      throw new ServiceError(
        "OPERATION_ALREADY_RESOLVED",
        "삭제 작업 결과를 먼저 확인해 주세요.",
        { httpStatus: 409, outcome: "unknown" },
      );
    if (state.scenario === "app_delete_unresolved")
      failUnknown(
        "삭제 결과를 확인할 수 없어요. 먼저 삭제 작업 결과를 확인해 주세요.",
      );
    if (state.scenario === "app_delete_delayed") {
      const flow = state.auth_flow;
      await new Promise((resolve) => setTimeout(resolve, createDelayMs));
      assertCurrentGeneration(state.generation);
      const current = currentMember();
      if (
        current.account.id !== account.id ||
        current.state.auth_flow.flow_id !== flow.flow_id ||
        current.state.auth_flow.revision !== flow.revision ||
        current.state.auth_flow.session_generation !== flow.session_generation
      )
        throw new ServiceError(
          "AUTH_STATE_CHANGED",
          "인증 상태가 바뀌어 앱을 삭제하지 않았어요.",
          { httpStatus: 409, outcome: "rejected" },
        );
      operation = ownedOperation(key, account.id);
      if (operation.state === "succeeded") return;
      if (operation.state !== "unresolved")
        throw new ServiceError(
          "OPERATION_ALREADY_RESOLVED",
          "삭제 작업 결과를 먼저 확인해 주세요.",
          { httpStatus: 409, outcome: "unknown" },
        );
    }
    const app = manageableApp(id, account, state);
    if (app.version !== expectedVersion) {
      operation = {
        ...operation,
        state: "rejected",
        finalizedAt: getMockSnapshot().mock_now,
        rejectionCode: "VERSION_CONFLICT",
      };
      appWriteOperations.set(key, operation);
      throw versionConflict();
    }
    const now = getMockSnapshot().mock_now;
    const confirming = state.scenario === "app_delete_pending_confirmation";
    deleteMockApp(id);
    operation = {
      ...operation,
      state: confirming ? "confirming_deletion" : "succeeded",
      dbAppliedAt: now,
      finalizedAt: confirming ? null : now,
    };
    appWriteOperations.set(key, operation);
    if (confirming)
      throw new ServiceError(
        "DELETION_CONFIRMATION_PENDING",
        "앱 삭제는 반영되었고 결과 확인을 기다리고 있어요.",
        { httpStatus: 503, outcome: "unknown" },
      );
    if (state.scenario === "app_delete_unknown")
      failUnknown(
        "삭제 결과를 확인할 수 없어요. 먼저 삭제 작업 결과를 확인해 주세요.",
      );
  },

  async getDeleteOperation(key) {
    const { state, account } = currentMember();
    const operation = ownedOperation(key, account.id);
    if (operation.kind !== "app_delete")
      throw new ServiceError(
        "OPERATION_NOT_FOUND",
        "삭제 작업을 찾을 수 없어요.",
        { httpStatus: 404, outcome: "rejected" },
      );
    assertOperationNotExpired(operation, state.mock_now);
    return operationWire(operation);
  },
};

function withoutFragment(url: string): string {
  return url.split("#", 1)[0]!;
}

export const mockMetaWire = mockMeta;
