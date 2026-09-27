import {
  mapAdminAppPage,
  mapAdminUser,
  mapAdminUserPage,
  mapApprovalOperation,
  mapPasswordResetOperation,
  mapUserDeleteOperation,
  type AdminUserPage,
  type AdminAppPage,
  type ApprovalOperation,
  type PasswordResetOperation,
  type UserDeleteOperation,
} from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import {
  normalizeAdminUsersQuery,
  normalizeAdminAppsQuery,
  normalizeResetPassword,
  type AdminService,
} from "../admin-service";
import {
  createMockApprovalOperation,
  deleteMockUserAccount,
  finishMockApprovalOperation,
  getMockAccounts,
  getMockApprovalOperation,
  getMockSnapshot,
  MOCK_WRITE_OPERATIONS_RESET_EVENT,
  MOCK_ACCOUNT_DELETED_EVENT,
  setMockTemporaryPassword,
} from "./state";

const OPERATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
type MockPasswordResetOperation = {
  key: string;
  actor_id: string;
  target_id: string;
  expected_account_version: number;
  issued_at: string;
  expires_at: string;
  state: "unresolved" | "succeeded" | "rejected";
  applied_account_version: number | null;
  temporary_password_expires_at: string | null;
  finalized_at: string | null;
  rejection_code: string | null;
};
const passwordResetOperations = new Map<string, MockPasswordResetOperation>();
// ponytail: reset inputs bind keys in tab memory; the real API owns durable HMAC binding.
const passwordResetInputs = new Map<string, string>();
let passwordResetSequence = 0;
type MockUserDeleteOperation = {
  key: string;
  actor_id: string;
  target_id: string;
  expected_app_count: number;
  issued_at: string;
  expires_at: string;
  state: "unresolved" | "confirming_deletion" | "succeeded" | "rejected";
  db_applied_at: string | null;
  finalized_at: string | null;
  rejection_code: string | null;
};
const userDeleteOperations = new Map<string, MockUserDeleteOperation>();
let userDeleteSequence = 0;
window.addEventListener(MOCK_WRITE_OPERATIONS_RESET_EVENT, () => {
  passwordResetOperations.clear();
  passwordResetInputs.clear();
  passwordResetSequence = 0;
  userDeleteOperations.clear();
  userDeleteSequence = 0;
});
window.addEventListener(MOCK_ACCOUNT_DELETED_EVENT, (event) => {
  const accountId = (event as CustomEvent<{ accountId: string }>).detail
    .accountId;
  for (const [key, operation] of passwordResetOperations) {
    if (operation.actor_id === accountId) {
      passwordResetOperations.delete(key);
      passwordResetInputs.delete(key);
    }
  }
  for (const [key, operation] of userDeleteOperations) {
    if (operation.actor_id === accountId) userDeleteOperations.delete(key);
  }
});

function fail(
  code: ConstructorParameters<typeof ServiceError>[0],
  message: string,
  httpStatus: number,
): ServiceError {
  return new ServiceError(code, message, {
    httpStatus,
    outcome: "rejected",
  });
}

function currentAdmin(requireRecentAuth = false) {
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
    throw fail("AUTH_REQUIRED", "로그인이 필요해요.", 401);
  if (session.session_kind !== "full")
    throw fail(
      "PASSWORD_CHANGE_REQUIRED",
      "회원 기능을 사용하기 전에 비밀번호를 변경해 주세요.",
      403,
    );
  const account = getMockAccounts(state).find(
    (item) => item.id === state.principal_id,
  );
  if (!account) throw fail("AUTH_REQUIRED", "로그인이 필요해요.", 401);
  if (account.role !== "admin" || !account.approved)
    throw fail("FORBIDDEN", "관리자 권한이 필요해요.", 403);
  if (
    requireRecentAuth &&
    (!session.recent_auth_until ||
      Date.parse(state.mock_now) >= Date.parse(session.recent_auth_until))
  )
    throw fail("REAUTH_REQUIRED", "관리자 재인증이 필요해요.", 403);
  return { state, account };
}

function wireUser(
  account: ReturnType<typeof getMockAccounts>[number],
  state = getMockSnapshot(),
) {
  const appCount = [...state.apps, ...state.private_apps].filter(
    (app) => app.owner.id === account.id,
  ).length;
  return {
    id: account.id,
    login_id: account.loginId,
    nickname: account.nickname,
    role: account.role,
    approved: account.approved,
    account_version: account.accountVersion,
    app_count: appCount,
    created_at: account.createdAt,
    first_approved_at: account.firstApprovedAt,
    pending_expires_at: account.pendingExpiresAt,
  };
}

function wireOperation(
  operation: NonNullable<ReturnType<typeof getMockApprovalOperation>>,
) {
  return {
    key: operation.key,
    kind: "user_approval" as const,
    target_id: operation.target_id,
    issued_at: operation.issued_at,
    expires_at: operation.expires_at,
    state: operation.state,
    applied_account_version: operation.applied_account_version,
    applied_approved: operation.applied_approved,
    finalized_at: operation.finalized_at,
    rejection_code: operation.rejection_code,
    server_time: getMockSnapshot().mock_now,
  };
}

function getOwnedOperation(key: string, actorId: string) {
  const operation = getMockApprovalOperation(key);
  if (!operation || operation.actor_id !== actorId)
    throw fail("OPERATION_NOT_FOUND", "승인 작업을 찾을 수 없어요.", 404);
  if (Date.now() >= Date.parse(operation.expires_at))
    throw fail("OPERATION_EXPIRED", "승인 작업 키가 만료되었어요.", 410);
  return operation;
}

function readOperation(
  operation: NonNullable<ReturnType<typeof getMockApprovalOperation>>,
): ApprovalOperation {
  return mapApprovalOperation(wireOperation(operation));
}

function wirePasswordResetOperation(
  operation: MockPasswordResetOperation,
  serverTime: string,
) {
  return {
    key: operation.key,
    kind: "user_password_reset" as const,
    target_id: operation.target_id,
    issued_at: operation.issued_at,
    expires_at: operation.expires_at,
    state: operation.state,
    applied_account_version: operation.applied_account_version,
    temporary_password_expires_at: operation.temporary_password_expires_at,
    finalized_at: operation.finalized_at,
    rejection_code: operation.rejection_code,
    server_time: serverTime,
  };
}

function getOwnedPasswordResetOperation(key: string, actorId: string) {
  const operation = passwordResetOperations.get(key);
  if (!operation || operation.actor_id !== actorId)
    throw fail("OPERATION_NOT_FOUND", "초기화 작업을 찾을 수 없어요.", 404);
  if (
    Date.parse(getMockSnapshot().mock_now) >= Date.parse(operation.expires_at)
  )
    throw fail("OPERATION_EXPIRED", "초기화 작업 키가 만료되었어요.", 410);
  return operation;
}

function readPasswordResetOperation(
  operation: MockPasswordResetOperation,
): PasswordResetOperation {
  return mapPasswordResetOperation(
    wirePasswordResetOperation(operation, getMockSnapshot().mock_now),
  );
}

function ownedAppCount(
  state: ReturnType<typeof getMockSnapshot>,
  accountId: string,
) {
  return [...state.apps, ...state.private_apps].filter(
    (app) => app.owner.id === accountId,
  ).length;
}

function wireUserDeleteOperation(
  operation: MockUserDeleteOperation,
  serverTime: string,
) {
  return {
    key: operation.key,
    kind: "user_delete" as const,
    target_id: operation.target_id,
    issued_at: operation.issued_at,
    expires_at: operation.expires_at,
    state: operation.state,
    db_applied_at: operation.db_applied_at,
    finalized_at: operation.finalized_at,
    rejection_code: operation.rejection_code,
    server_time: serverTime,
  };
}

function getOwnedUserDeleteOperation(key: string, actorId: string) {
  const operation = userDeleteOperations.get(key);
  if (!operation || operation.actor_id !== actorId)
    throw fail("OPERATION_NOT_FOUND", "삭제 작업을 찾을 수 없어요.", 404);
  if (
    Date.parse(getMockSnapshot().mock_now) >= Date.parse(operation.expires_at)
  )
    throw fail("OPERATION_EXPIRED", "삭제 작업 키가 만료되었어요.", 410);
  return operation;
}

function readUserDeleteOperation(
  operation: MockUserDeleteOperation,
  state = getMockSnapshot(),
): UserDeleteOperation {
  if (
    operation.state === "confirming_deletion" &&
    operation.db_applied_at &&
    Date.parse(state.mock_now) >=
      Date.parse(operation.db_applied_at) + 60 * 1000
  ) {
    // ponytail: logical time stands in for outbox confirmation; the mock has no durable provider.
    operation = {
      ...operation,
      state: "succeeded",
      finalized_at: state.mock_now,
    };
    userDeleteOperations.set(operation.key, operation);
  }
  return mapUserDeleteOperation(
    wireUserDeleteOperation(operation, state.mock_now),
  );
}

function rejectUserDeleteOperation(
  operation: MockUserDeleteOperation,
  rejectionCode: string,
  finalizedAt: string,
) {
  const rejected = {
    ...operation,
    state: "rejected" as const,
    finalized_at: finalizedAt,
    rejection_code: rejectionCode,
  };
  userDeleteOperations.set(operation.key, rejected);
  return rejected;
}

function rejectPasswordReset(
  operation: MockPasswordResetOperation,
  code: "USER_NOT_FOUND" | "ADMIN_ACCOUNT_PROTECTED" | "USER_STATE_CONFLICT",
  finalizedAt: string,
) {
  const rejected = {
    ...operation,
    state: "rejected" as const,
    finalized_at: finalizedAt,
    rejection_code: code,
  };
  passwordResetOperations.set(operation.key, rejected);
  passwordResetInputs.delete(operation.key);
  return rejected;
}

export const adminService: AdminService = {
  async listUsers(query, { signal } = {}) {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    const { state } = currentAdmin();
    const normalized = normalizeAdminUsersQuery(query);
    if (
      state.scenario === "admin_list_failure" ||
      (state.scenario === "admin_more_failure" && normalized.offset > 0)
    )
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "사용자 목록을 불러오지 못했어요. 연결을 확인해 주세요.",
        { httpStatus: 503 },
      );
    const users = getMockAccounts(state)
      .map((account) => wireUser(account, state))
      .sort(
        (left, right) =>
          Number(left.approved) - Number(right.approved) ||
          left.created_at.localeCompare(right.created_at) ||
          left.id.localeCompare(right.id),
      );
    const allApps = [...state.apps, ...state.private_apps];
    const summaryApps = state.scenario === "health_batch_empty" ? [] : allApps;
    const latestBatch = [...state.health_batches].sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        right.id.localeCompare(left.id),
    )[0];
    const nextHealthExpiryAt =
      summaryApps
        .map((app) => app.health.result.fresh_until)
        .filter(
          (value): value is string =>
            value !== null && Date.parse(value) > Date.parse(state.mock_now),
        )
        .sort()[0] ?? null;
    const page: AdminUserPage = mapAdminUserPage({
      items: users.slice(
        normalized.offset,
        normalized.offset + normalized.limit,
      ),
      pagination: {
        limit: normalized.limit,
        offset: normalized.offset,
        total: users.length,
        has_more: normalized.offset + normalized.limit < users.length,
      },
      stats: {
        total_users: users.length,
        pending_users: users.filter((user) => !user.approved).length,
        total_apps: summaryApps.length,
        healthy_apps: summaryApps.filter(
          (app) =>
            app.health.result.state === "healthy" &&
            app.health.result.fresh_until !== null &&
            Date.parse(app.health.result.fresh_until) >
              Date.parse(state.mock_now),
        ).length,
        next_health_expiry_at: nextHealthExpiryAt,
        active_health_batch_id:
          state.health_batches.find((batch) => batch.finished_at === null)
            ?.id ?? null,
        latest_health_batch_id: latestBatch?.id ?? null,
      },
      server_time: state.mock_now,
    });
    return page;
  },

  async listApps(query, { signal } = {}) {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    const { state } = currentAdmin();
    const normalized = normalizeAdminAppsQuery(query);
    if (
      state.scenario === "admin_apps_list_failure" ||
      (state.scenario === "admin_apps_more_failure" && normalized.offset > 0)
    )
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "앱 목록을 불러오지 못했어요. 연결을 확인해 주세요.",
        { httpStatus: 503 },
      );

    const allApps = [...state.apps, ...state.private_apps].sort(
      (left, right) =>
        right.created_at.localeCompare(left.created_at) ||
        right.id.localeCompare(left.id),
    );
    const empty =
      state.scenario === "admin_apps_empty" ||
      state.scenario === "health_batch_empty";
    const total = empty ? 0 : allApps.length;
    const apps = empty
      ? []
      : allApps.slice(normalized.offset, normalized.offset + normalized.limit);
    const pageApps =
      state.scenario === "admin_apps_duplicate_page" &&
      normalized.offset > 0 &&
      allApps[normalized.offset - 1]
        ? [allApps[normalized.offset - 1], ...apps].slice(0, normalized.limit)
        : apps;
    const page: AdminAppPage = mapAdminAppPage({
      items: pageApps.map((app) => ({
        id: app.id,
        owner: app.owner,
        name: app.name,
        url: app.url,
        is_public: app.is_public,
        theme_id: app.theme_id,
        version: app.version,
        url_version: app.url_version,
        created_at: app.created_at,
        health: app.health.result,
      })),
      pagination: {
        limit: normalized.limit,
        offset: normalized.offset,
        total,
        has_more: normalized.offset + pageApps.length < total,
      },
      server_time: state.mock_now,
    });
    return page;
  },

  async getUser(id, { signal } = {}) {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    const { state } = currentAdmin();
    const account = getMockAccounts(state).find((item) => item.id === id);
    if (!account) throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    return mapAdminUser(wireUser(account, state));
  },

  async createApprovalOperation(input) {
    const { account: actor } = currentAdmin();
    if (
      typeof input?.targetId !== "string" ||
      !Number.isSafeInteger(input?.expectedAccountVersion) ||
      input.expectedAccountVersion < 1 ||
      typeof input?.approved !== "boolean"
    )
      throw fail("VALIDATION_ERROR", "승인 대상을 다시 확인해 주세요.", 422);
    const target = getMockAccounts().find((item) => item.id === input.targetId);
    if (!target) throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    if (target.role === "admin")
      throw fail(
        "ADMIN_ACCOUNT_PROTECTED",
        "관리자 계정은 변경할 수 없어요.",
        403,
      );
    if (target.accountVersion !== input.expectedAccountVersion)
      throw fail(
        "USER_STATE_CONFLICT",
        "회원 상태가 바뀌었어요. 다시 확인해 주세요.",
        409,
      );

    const issuedAt = new Date().toISOString();
    const operation = createMockApprovalOperation({
      actorId: actor.id,
      targetId: target.id,
      expectedAccountVersion: input.expectedAccountVersion,
      approved: input.approved,
      issuedAt,
      expiresAt: new Date(
        Date.parse(issuedAt) + OPERATION_LIFETIME_MS,
      ).toISOString(),
    });
    return readOperation(operation);
  },

  async createPasswordResetOperation(input) {
    const { state, account: actor } = currentAdmin(true);
    const newPassword = normalizeResetPassword(input?.newPassword ?? "");
    if (
      typeof input?.targetId !== "string" ||
      !Number.isSafeInteger(input?.expectedAccountVersion) ||
      input.expectedAccountVersion < 1
    )
      throw fail("VALIDATION_ERROR", "초기화 대상을 다시 확인해 주세요.", 422);
    const target = getMockAccounts(state).find(
      (item) => item.id === input.targetId,
    );
    if (!target) throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    if (target.role === "admin")
      throw fail(
        "ADMIN_ACCOUNT_PROTECTED",
        "관리자 계정은 변경할 수 없어요.",
        403,
      );
    if (target.accountVersion !== input.expectedAccountVersion)
      throw fail(
        "USER_STATE_CONFLICT",
        "회원 상태가 바뀌었어요. 다시 확인해 주세요.",
        409,
      );
    if (passwordResetSequence >= Number.MAX_SAFE_INTEGER - 0x300)
      throw fail("SERVICE_UNAVAILABLE", "작업 키를 발급할 수 없어요.", 503);

    const issuedAt = state.mock_now;
    const key = `00000000-0000-4001-8000-${String(0x300 + passwordResetSequence).padStart(12, "0")}`;
    passwordResetSequence += 1;
    const operation: MockPasswordResetOperation = {
      key,
      actor_id: actor.id,
      target_id: target.id,
      expected_account_version: input.expectedAccountVersion,
      issued_at: issuedAt,
      expires_at: new Date(
        Date.parse(issuedAt) + OPERATION_LIFETIME_MS,
      ).toISOString(),
      state: "unresolved",
      applied_account_version: null,
      temporary_password_expires_at: null,
      finalized_at: null,
      rejection_code: null,
    };
    passwordResetOperations.set(key, operation);
    passwordResetInputs.set(key, newPassword);
    return readPasswordResetOperation(operation);
  },

  async createUserDeleteOperation(input) {
    const { state, account: actor } = currentAdmin(true);
    if (
      typeof input?.targetId !== "string" ||
      !Number.isSafeInteger(input?.expectedAppCount) ||
      input.expectedAppCount < 0
    )
      throw fail("VALIDATION_ERROR", "삭제 대상을 다시 확인해 주세요.", 422);
    const target = getMockAccounts(state).find(
      (item) => item.id === input.targetId,
    );
    if (!target) throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    if (target.role === "admin")
      throw fail(
        "ADMIN_ACCOUNT_PROTECTED",
        "관리자 계정은 삭제할 수 없어요.",
        403,
      );
    const appCount = ownedAppCount(state, target.id);
    if (appCount !== input.expectedAppCount)
      throw fail(
        "APP_COUNT_CONFLICT",
        "소유 앱 수가 바뀌었어요. 현재 정보를 다시 확인해 주세요.",
        409,
      );
    if (userDeleteSequence >= Number.MAX_SAFE_INTEGER - 0x500)
      throw fail("SERVICE_UNAVAILABLE", "작업 키를 발급할 수 없어요.", 503);

    const issuedAt = state.mock_now;
    const operation: MockUserDeleteOperation = {
      key: `00000000-0000-4003-8000-${String(0x500 + userDeleteSequence).padStart(12, "0")}`,
      actor_id: actor.id,
      target_id: target.id,
      expected_app_count: input.expectedAppCount,
      issued_at: issuedAt,
      expires_at: new Date(
        Date.parse(issuedAt) + OPERATION_LIFETIME_MS,
      ).toISOString(),
      state: "unresolved",
      db_applied_at: null,
      finalized_at: null,
      rejection_code: null,
    };
    userDeleteSequence += 1;
    userDeleteOperations.set(operation.key, operation);
    return readUserDeleteOperation(operation, state);
  },

  async setApproval(id, approved, expectedAccountVersion, operationKey) {
    const { account: actor, state } = currentAdmin();
    let operation = getOwnedOperation(operationKey, actor.id);
    if (
      operation.target_id !== id ||
      operation.approved !== approved ||
      operation.expected_account_version !== expectedAccountVersion
    )
      throw fail("OPERATION_KEY_MISMATCH", "승인 요청 내용이 달라요.", 409);
    if (operation.state !== "unresolved")
      throw fail(
        "OPERATION_ALREADY_RESOLVED",
        "승인 작업 결과를 먼저 확인해 주세요.",
        409,
      );

    if (state.scenario === "admin_write_unresolved")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "처리 결과를 확인할 수 없어요. 결과를 확인한 뒤 같은 요청을 다시 제출하거나 취소해 주세요.",
        { httpStatus: 503, outcome: "unknown" },
      );

    if (state.scenario === "admin_write_delayed") {
      const flow = state.auth_flow;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const current = getMockSnapshot();
      if (
        current.principal_id !== actor.id ||
        current.auth_flow.flow_id !== flow.flow_id ||
        current.auth_flow.revision !== flow.revision ||
        current.auth_flow.session_generation !== flow.session_generation
      )
        throw fail(
          "AUTH_STATE_CHANGED",
          "인증 상태가 바뀌어 승인 요청을 적용하지 않았어요.",
          409,
        );
      operation = getOwnedOperation(operationKey, actor.id);
    }
    if (operation.state !== "unresolved")
      throw fail(
        "OPERATION_ALREADY_RESOLVED",
        "승인 작업 결과를 먼저 확인해 주세요.",
        409,
      );

    const result = finishMockApprovalOperation(
      operationKey,
      new Date().toISOString(),
    );
    if (!result)
      throw fail("OPERATION_NOT_FOUND", "승인 작업을 찾을 수 없어요.", 404);
    if (result.state === "rejected")
      throw fail(
        result.rejection_code as ConstructorParameters<typeof ServiceError>[0],
        result.rejection_code === "USER_NOT_FOUND"
          ? "회원을 찾을 수 없어요."
          : result.rejection_code === "ADMIN_ACCOUNT_PROTECTED"
            ? "관리자 계정은 변경할 수 없어요."
            : "회원 상태가 바뀌었어요. 다시 확인해 주세요.",
        result.rejection_code === "ADMIN_ACCOUNT_PROTECTED"
          ? 403
          : result.rejection_code === "USER_NOT_FOUND"
            ? 404
            : 409,
      );

    const target = getMockAccounts().find((item) => item.id === id);
    if (!target) throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    const user = mapAdminUser(wireUser(target));
    if (state.scenario === "admin_write_unknown")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "처리는 끝났을 수 있지만 응답을 받지 못했어요. 결과를 확인해 주세요.",
        { httpStatus: 503, outcome: "unknown" },
      );
    return user;
  },

  async getApprovalOperation(key) {
    const { account } = currentAdmin();
    return readOperation(getOwnedOperation(key, account.id));
  },

  async cancelApprovalOperation(key) {
    const { account } = currentAdmin();
    const current = getOwnedOperation(key, account.id);
    if (current.state !== "unresolved") return readOperation(current);
    const result = finishMockApprovalOperation(
      key,
      new Date().toISOString(),
      true,
    );
    if (!result)
      throw fail("OPERATION_NOT_FOUND", "승인 작업을 찾을 수 없어요.", 404);
    return readOperation(result);
  },

  async setPasswordReset(
    id,
    newPassword,
    expectedAccountVersion,
    operationKey,
  ) {
    const { state, account: actor } = currentAdmin(true);
    let operation = getOwnedPasswordResetOperation(operationKey, actor.id);
    const normalizedPassword = normalizeResetPassword(newPassword);
    if (
      operation.target_id !== id ||
      operation.expected_account_version !== expectedAccountVersion ||
      passwordResetInputs.get(operationKey) !== normalizedPassword
    )
      throw fail("OPERATION_KEY_MISMATCH", "초기화 요청 내용이 달라요.", 409);
    if (operation.state !== "unresolved")
      throw fail(
        "OPERATION_ALREADY_RESOLVED",
        "초기화 작업 결과를 먼저 확인해 주세요.",
        409,
      );

    if (state.scenario === "admin_write_unresolved")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "처리 결과를 확인할 수 없어요. 결과를 확인한 뒤 같은 요청을 다시 제출하거나 취소해 주세요.",
        { httpStatus: 503, outcome: "unknown" },
      );

    if (state.scenario === "admin_write_delayed") {
      const flow = state.auth_flow;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const current = getMockSnapshot();
      currentAdmin(true);
      if (
        current.principal_id !== actor.id ||
        current.auth_flow.flow_id !== flow.flow_id ||
        current.auth_flow.revision !== flow.revision ||
        current.auth_flow.session_generation !== flow.session_generation
      )
        throw fail(
          "AUTH_STATE_CHANGED",
          "인증 상태가 바뀌어 초기화 요청을 적용하지 않았어요.",
          409,
        );
      operation = getOwnedPasswordResetOperation(operationKey, actor.id);
    }
    if (operation.state !== "unresolved")
      throw fail(
        "OPERATION_ALREADY_RESOLVED",
        "초기화 작업 결과를 먼저 확인해 주세요.",
        409,
      );

    const current = getMockSnapshot();
    const target = getMockAccounts(current).find((item) => item.id === id);
    const now = current.mock_now;
    if (!target) {
      rejectPasswordReset(operation, "USER_NOT_FOUND", now);
      throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    }
    if (target.role === "admin") {
      rejectPasswordReset(operation, "ADMIN_ACCOUNT_PROTECTED", now);
      throw fail(
        "ADMIN_ACCOUNT_PROTECTED",
        "관리자 계정은 변경할 수 없어요.",
        403,
      );
    }
    if (target.accountVersion !== expectedAccountVersion) {
      rejectPasswordReset(operation, "USER_STATE_CONFLICT", now);
      throw fail("USER_STATE_CONFLICT", "회원 상태가 바뀌었어요.", 409);
    }
    const applied = setMockTemporaryPassword({
      accountId: id,
      expectedAccountVersion,
      password: normalizedPassword,
    });
    operation = {
      ...operation,
      state: "succeeded",
      applied_account_version: applied.accountVersion,
      temporary_password_expires_at: applied.expiresAt,
      finalized_at: now,
      rejection_code: null,
    };
    passwordResetOperations.set(operationKey, operation);
    passwordResetInputs.delete(operationKey);
    if (state.scenario === "admin_write_unknown")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "처리는 끝났을 수 있지만 응답을 받지 못했어요. 결과를 확인해 주세요.",
        { httpStatus: 503, outcome: "unknown" },
      );
  },

  async deleteUser(id, expectedAppCount, operationKey) {
    const { state, account: actor } = currentAdmin(true);
    let operation = getOwnedUserDeleteOperation(operationKey, actor.id);
    if (
      operation.target_id !== id ||
      operation.expected_app_count !== expectedAppCount
    )
      throw fail("OPERATION_KEY_MISMATCH", "삭제 요청 내용이 달라요.", 409);
    if (operation.state === "succeeded") return;
    if (operation.state === "confirming_deletion") {
      operation = userDeleteOperations.get(operationKey)!;
      if (readUserDeleteOperation(operation).state === "succeeded") return;
      throw new ServiceError(
        "DELETION_CONFIRMATION_PENDING",
        "회원과 소유 앱 삭제는 반영되었고 확인을 기다리고 있어요.",
        { httpStatus: 503, outcome: "unknown" },
      );
    }
    if (operation.state !== "unresolved")
      throw fail(
        "OPERATION_ALREADY_RESOLVED",
        "삭제 작업 결과를 먼저 확인해 주세요.",
        409,
      );

    if (state.scenario === "admin_delete_unresolved")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "삭제 결과를 확인할 수 없어요. 먼저 같은 작업 키의 결과를 확인해 주세요.",
        { httpStatus: 503, outcome: "unknown" },
      );

    if (state.scenario === "admin_delete_delayed") {
      const flow = state.auth_flow;
      await new Promise((resolve) => setTimeout(resolve, 500));
      const current = getMockSnapshot();
      if (
        current.principal_id !== actor.id ||
        current.auth_flow.flow_id !== flow.flow_id ||
        current.auth_flow.revision !== flow.revision ||
        current.auth_flow.session_generation !== flow.session_generation
      )
        throw fail(
          "AUTH_STATE_CHANGED",
          "인증 상태가 바뀌어 삭제 요청을 적용하지 않았어요.",
          409,
        );
      currentAdmin(true);
      operation = getOwnedUserDeleteOperation(operationKey, actor.id);
      if (operation.state !== "unresolved")
        throw fail(
          "OPERATION_ALREADY_RESOLVED",
          "삭제 작업 결과를 먼저 확인해 주세요.",
          409,
        );
    }

    const now = getMockSnapshot().mock_now;
    try {
      deleteMockUserAccount(id, expectedAppCount);
    } catch (error) {
      if (
        error instanceof ServiceError &&
        [
          "USER_NOT_FOUND",
          "ADMIN_ACCOUNT_PROTECTED",
          "APP_COUNT_CONFLICT",
        ].includes(error.code)
      ) {
        rejectUserDeleteOperation(operation, error.code, now);
      }
      throw error;
    }

    const confirming = state.scenario === "admin_delete_pending_confirmation";
    const finalizedAt = getMockSnapshot().mock_now;
    operation = {
      ...operation,
      state: confirming ? "confirming_deletion" : "succeeded",
      db_applied_at: finalizedAt,
      finalized_at: confirming ? null : finalizedAt,
      rejection_code: null,
    };
    userDeleteOperations.set(operationKey, operation);
    if (confirming)
      throw new ServiceError(
        "DELETION_CONFIRMATION_PENDING",
        "회원과 소유 앱 삭제는 반영되었고 확인을 기다리고 있어요.",
        { httpStatus: 503, outcome: "unknown" },
      );
    if (state.scenario === "admin_delete_unknown")
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "삭제 결과를 확인할 수 없어요. 먼저 같은 작업 키의 결과를 확인해 주세요.",
        { httpStatus: 503, outcome: "unknown" },
      );
  },

  async getPasswordResetOperation(key) {
    const { account } = currentAdmin();
    return readPasswordResetOperation(
      getOwnedPasswordResetOperation(key, account.id),
    );
  },

  async getUserDeleteOperation(key) {
    const { account, state } = currentAdmin();
    return readUserDeleteOperation(
      getOwnedUserDeleteOperation(key, account.id),
      state,
    );
  },

  async cancelPasswordResetOperation(key) {
    const { account, state } = currentAdmin();
    const current = getOwnedPasswordResetOperation(key, account.id);
    if (current.state !== "unresolved")
      return readPasswordResetOperation(current);
    const cancelled = {
      ...current,
      state: "rejected" as const,
      finalized_at: state.mock_now,
      rejection_code: "OPERATION_CANCELLED",
    };
    passwordResetOperations.set(key, cancelled);
    passwordResetInputs.delete(key);
    return readPasswordResetOperation(cancelled);
  },
};
