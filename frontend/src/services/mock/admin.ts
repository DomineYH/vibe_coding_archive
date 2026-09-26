import {
  mapAdminUser,
  mapAdminUserPage,
  mapApprovalOperation,
  type AdminUserPage,
  type ApprovalOperation,
} from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import { normalizeAdminUsersQuery, type AdminService } from "../admin-service";
import { mockMetaWire } from "./apps";
import {
  createMockApprovalOperation,
  finishMockApprovalOperation,
  getMockAccounts,
  getMockApprovalOperation,
  getMockSnapshot,
} from "./state";

const OPERATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

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

function currentAdmin() {
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
  return { state, account };
}

function wireUser(account: ReturnType<typeof getMockAccounts>[number]) {
  return {
    id: account.id,
    login_id: account.loginId,
    nickname: account.nickname,
    role: account.role,
    approved: account.approved,
    account_version: account.accountVersion,
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
      .map(wireUser)
      .sort(
        (left, right) =>
          Number(left.approved) - Number(right.approved) ||
          left.created_at.localeCompare(right.created_at) ||
          left.id.localeCompare(right.id),
      );
    const allApps = [...state.apps, ...state.private_apps];
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
        total_apps: allApps.length,
        healthy_apps: allApps.filter(
          (app) => app.health.result.state === "healthy",
        ).length,
      },
      server_time: mockMetaWire.server_time,
    });
    return page;
  },

  async getUser(id, { signal } = {}) {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("Request aborted", "AbortError");
    currentAdmin();
    const account = getMockAccounts().find((item) => item.id === id);
    if (!account) throw fail("USER_NOT_FOUND", "회원을 찾을 수 없어요.", 404);
    return mapAdminUser(wireUser(account));
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
};
