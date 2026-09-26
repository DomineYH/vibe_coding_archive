import catalog from "../../../../contracts/catalog.json";
import publicApps from "../../fixtures/public-apps.json";
import privateApps from "../../fixtures/private-apps.json";
import {
  isDateTime,
  mapAppDetailResponse,
  mapRegisteredUser,
} from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import type {
  AuthTransitionKind,
  AuthTransitionState,
} from "../../contracts/mappers";
import { MOCK_ACCOUNTS } from "./accounts";

export const MOCK_STORAGE_KEY = "eduvibe-archive-mock-v1";
export const MOCK_RESET_EVENT = "eduvibe:mock-reset";
export const MOCK_AUTH_STATE_EVENT = "eduvibe:mock-auth-state";

const MOCK_SCENARIOS = [
  "original",
  "empty",
  "list_failure",
  "list_refetch_failure",
  "next_page_failure",
  "list_delayed",
  "long_list",
  "duplicate_pages",
  "no_progress",
  "long_copy",
  "visual_fixture",
  "auth_delayed",
  "auth_observation_error",
  "auth_network_error",
  "auth_transition_gate",
  "auth_response_lost",
  "auth_session_cookie_lost",
  "auth_result_unavailable",
  "detail_delayed",
  "admin_list_failure",
  "admin_more_failure",
  "admin_write_unknown",
  "admin_write_unresolved",
  "admin_write_delayed",
] as const;
const V2_STATE_KEYS = [
  "version",
  "generation",
  "scenario",
  "apps",
  "private_apps",
  "principal_id",
];
const V3_STATE_KEYS = [...V2_STATE_KEYS, "registered_accounts"];
const V4_STATE_KEYS = [...V3_STATE_KEYS, "auth_flow", "observation_generation"];
const V5_STATE_KEYS = [
  ...V4_STATE_KEYS,
  "admin_users",
  "approval_operations",
  "approval_operation_sequence",
];
const V6_STATE_KEYS = [
  ...V5_STATE_KEYS,
  "mock_now",
  "credential_overrides",
  "principal_session",
];
const STATE_KEYS = V6_STATE_KEYS;
const AUTH_FLOW_V6_KEYS = [
  "flow_id",
  "revision",
  "session_generation",
  "last_identity_change_revision",
  "issued_session_generation",
];
const AUTH_FLOW_KEYS = [
  ...AUTH_FLOW_V6_KEYS,
  "flow_sequence",
  "expires_at",
  "recovery_ready",
  "recovery_cookie_generation",
  "recovery_cookie_present",
  "session_cookie_present",
  "pending_transition",
  "transitions",
  "blocked_transition_ids",
  "unresolved_transition_id",
  "restart_eligible",
  "gate_open",
];
const AUTH_TRANSITION_KEYS = [
  "transition_id",
  "kind",
  "state",
  "permit_expires_at",
  "result_session_generation",
  "failure_code",
  "result_available_until",
];
const MOCK_FLOW_ID = "00000000-0000-4000-8000-000000000200";
const MOCK_INITIAL_TIME = "2026-09-22T00:12:00.000Z";
const MOCK_FLOW_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const LEGACY_STATE_KEYS = ["version", "generation", "scenario", "apps"];
const REGISTERED_ACCOUNT_KEYS = [
  "id",
  "loginId",
  "password",
  "nickname",
  "pendingExpiresAt",
];
const ADMIN_USER_KEYS = [
  "id",
  "approved",
  "account_version",
  "created_at",
  "first_approved_at",
];
const APPROVAL_OPERATION_KEYS = [
  "key",
  "actor_id",
  "target_id",
  "expected_account_version",
  "approved",
  "issued_at",
  "expires_at",
  "state",
  "applied_account_version",
  "applied_approved",
  "finalized_at",
  "rejection_code",
];
const CREDENTIAL_OVERRIDE_KEYS = [
  "account_id",
  "password",
  "must_change_password",
  "temporary_password_expires_at",
];
const PRINCIPAL_SESSION_KEYS = [
  "session_kind",
  "expires_at",
  "recent_auth_until",
];
const AUTH_TRANSITION_KINDS = [
  "anonymous_session",
  "login",
  "logout",
  "password_change",
  "reauthenticate",
] as const;
const AUTH_TRANSITION_STATES = [
  "admitted",
  "executing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
] as const;
const APP_KEYS = [
  "id",
  "owner",
  "name",
  "subject",
  "grades",
  "is_public",
  "theme_id",
  "version",
  "url_version",
  "health",
  "url",
  "prompt",
  "description",
  "stack_db",
  "stack_backend",
  "stack_frontend",
  "stack_hosting",
  "created_at",
  "updated_at",
];
const OWNER_KEYS = ["id", "nickname"];
const HEALTH_KEYS = ["result", "latest_job", "next_check_at"];
const HEALTH_RESULT_KEYS = ["state", "checked_at", "fresh_until"];
const JOB_KEYS = [
  "id",
  "status",
  "created_at",
  "started_at",
  "finished_at",
  "failure_code",
];
const CATALOG_SUBJECTS = new Set(catalog.subjects);
const CATALOG_GRADES = new Set(catalog.grades);
const CATALOG_THEMES = new Set(catalog.themes.map((theme) => theme.id));
export type MockScenario = (typeof MOCK_SCENARIOS)[number];
export type MockAdminUserState = {
  id: string;
  approved: boolean;
  account_version: number;
  created_at: string;
  first_approved_at: string | null;
};
export type MockApprovalOperation = {
  key: string;
  actor_id: string;
  target_id: string;
  expected_account_version: number;
  approved: boolean;
  issued_at: string;
  expires_at: string;
  state: "unresolved" | "succeeded" | "rejected";
  applied_account_version: number | null;
  applied_approved: boolean | null;
  finalized_at: string | null;
  rejection_code: string | null;
};
export type MockCredentialOverride = {
  account_id: string;
  password: string;
  must_change_password: boolean;
  temporary_password_expires_at: string | null;
};
export type MockPrincipalSession = {
  session_kind: "full" | "change_only";
  expires_at: string;
  recent_auth_until: string | null;
};
export type MockState = {
  version: 7;
  generation: number;
  observation_generation: number;
  scenario: MockScenario;
  apps: typeof publicApps;
  private_apps: typeof privateApps;
  principal_id: string | null;
  registered_accounts: MockRegisteredAccount[];
  admin_users: MockAdminUserState[];
  approval_operations: MockApprovalOperation[];
  approval_operation_sequence: number;
  mock_now: string;
  credential_overrides: MockCredentialOverride[];
  principal_session: MockPrincipalSession | null;
  auth_flow: MockAuthFlow;
};
export type MockAuthTransition = {
  transition_id: string;
  kind: AuthTransitionKind;
  state: AuthTransitionState;
  permit_expires_at: string;
  result_session_generation: string | null;
  failure_code: string | null;
  result_available_until: string;
};
export type MockAuthFlow = {
  flow_id: string;
  revision: string;
  session_generation: string | null;
  last_identity_change_revision: string;
  issued_session_generation: string;
  flow_sequence: number;
  expires_at: string;
  recovery_ready: boolean;
  recovery_cookie_generation: string;
  recovery_cookie_present: boolean;
  session_cookie_present: boolean;
  pending_transition: MockAuthTransition | null;
  transitions: MockAuthTransition[];
  blocked_transition_ids: string[];
  unresolved_transition_id: string | null;
  restart_eligible: boolean;
  gate_open: boolean;
};
export type MockRegisteredAccount = {
  id: string;
  loginId: string;
  // ponytail: synthetic passwords stay plain in mock storage; replace with server-side credential storage before production auth.
  password: string;
  nickname: string;
  pendingExpiresAt: string;
};

let resetGeneration = 0;

function isMockScenario(value: unknown): value is MockScenario {
  return MOCK_SCENARIOS.includes(value as MockScenario);
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.prototype.hasOwnProperty.call(value, key))
  );
}

function validSequence(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
}

function validTransition(
  value: unknown,
  flowId: string,
): value is MockAuthTransition {
  if (!hasExactKeys(value, AUTH_TRANSITION_KEYS)) return false;
  const transition = value;
  const transitionId = transition.transition_id;
  return (
    typeof transitionId === "string" &&
    transitionId.startsWith(`${flowId}.`) &&
    validSequence(transitionId.slice(flowId.length + 1)) &&
    typeof transition.kind === "string" &&
    AUTH_TRANSITION_KINDS.includes(transition.kind as AuthTransitionKind) &&
    typeof transition.state === "string" &&
    AUTH_TRANSITION_STATES.includes(transition.state as AuthTransitionState) &&
    isDateTime(transition.permit_expires_at) &&
    (transition.result_session_generation === null ||
      validSequence(transition.result_session_generation)) &&
    (transition.failure_code === null ||
      (typeof transition.failure_code === "string" &&
        transition.failure_code.length > 0)) &&
    isDateTime(transition.result_available_until)
  );
}

function validateApps(apps: unknown[], isPublic: boolean): void {
  const appIds = new Set<string>();
  const jobIds = new Set<string>();
  const ownerNames = new Map<string, string>();

  for (const app of apps) {
    if (
      !hasExactKeys(app, APP_KEYS) ||
      !hasExactKeys(app.owner, OWNER_KEYS) ||
      !hasExactKeys(app.health, HEALTH_KEYS) ||
      !hasExactKeys(app.health.result, HEALTH_RESULT_KEYS) ||
      (app.health.latest_job !== null &&
        !hasExactKeys(app.health.latest_job, JOB_KEYS))
    )
      throw storageError();

    const { item } = mapAppDetailResponse({
      item: app,
      server_time: "2026-09-22T00:12:00.000Z",
    });
    const ownerName = ownerNames.get(item.ownerId);
    const jobId = item.health.latestJob?.id;
    if (
      !CATALOG_SUBJECTS.has(item.subject) ||
      item.grades.some((grade) => !CATALOG_GRADES.has(grade)) ||
      new Set(item.grades).size !== item.grades.length ||
      !CATALOG_THEMES.has(item.themeId) ||
      item.isPublic !== isPublic ||
      appIds.has(item.id) ||
      (jobId !== undefined && jobIds.has(jobId)) ||
      (ownerName !== undefined && ownerName !== item.owner)
    )
      throw storageError();

    appIds.add(item.id);
    if (jobId !== undefined) jobIds.add(jobId);
    ownerNames.set(item.ownerId, item.owner);
    if (
      !isPublic &&
      !MOCK_ACCOUNTS.some((account) => account.id === item.ownerId)
    )
      throw storageError();
  }
}

function validateRegisteredAccounts(accounts: unknown[]): void {
  const ids = new Set<string>(MOCK_ACCOUNTS.map((account) => account.id));
  const loginIds = new Set<string>(
    MOCK_ACCOUNTS.map((account) => account.loginId.toLowerCase()),
  );
  for (const account of accounts) {
    if (!hasExactKeys(account, REGISTERED_ACCOUNT_KEYS)) throw storageError();
    const registered = account as unknown as MockRegisteredAccount;
    const mapped = mapRegisteredUser({
      id: registered.id,
      login_id: registered.loginId,
      nickname: registered.nickname,
      approved: false,
      pending_expires_at: registered.pendingExpiresAt,
    });
    const loginId = mapped.loginId.trim().normalize("NFC");
    if (
      registered.loginId !== loginId ||
      !/^[가-힣A-Za-z0-9_.-]{2,32}$/u.test(loginId) ||
      typeof registered.password !== "string" ||
      Array.from(registered.password).length < 15 ||
      Array.from(registered.password).length > 128 ||
      registered.nickname !== registered.nickname.trim().normalize("NFC") ||
      ids.has(registered.id) ||
      loginIds.has(loginId.toLowerCase())
    )
      throw storageError();
    ids.add(registered.id);
    loginIds.add(loginId.toLowerCase());
  }
}

function validateAdminUsers(
  users: unknown[],
  registeredAccounts: MockRegisteredAccount[],
): void {
  const expected = new Set([
    ...MOCK_ACCOUNTS.map((account) => account.id),
    ...registeredAccounts.map((account) => account.id),
  ]);
  const seen = new Set<string>();
  for (const value of users) {
    if (!hasExactKeys(value, ADMIN_USER_KEYS)) throw storageError();
    const user = value as unknown as MockAdminUserState;
    if (
      !expected.has(user.id) ||
      seen.has(user.id) ||
      typeof user.approved !== "boolean" ||
      !Number.isSafeInteger(user.account_version) ||
      user.account_version < 1 ||
      !isDateTime(user.created_at) ||
      (user.first_approved_at !== null && !isDateTime(user.first_approved_at))
    )
      throw storageError();
    seen.add(user.id);
  }
  if (seen.size !== expected.size) throw storageError();
}

function validateApprovalOperations(operations: unknown[]): void {
  const keys = new Set<string>();
  const adminIds = new Set<string>(
    MOCK_ACCOUNTS.filter((account) => account.role === "admin").map(
      (account) => account.id,
    ),
  );
  for (const value of operations) {
    if (!hasExactKeys(value, APPROVAL_OPERATION_KEYS)) throw storageError();
    const operation = value as unknown as MockApprovalOperation;
    if (
      !/^[0-9a-f-]{36}$/i.test(operation.key) ||
      keys.has(operation.key) ||
      !adminIds.has(operation.actor_id) ||
      !/^[0-9a-f-]{36}$/i.test(operation.target_id) ||
      !Number.isSafeInteger(operation.expected_account_version) ||
      operation.expected_account_version < 1 ||
      typeof operation.approved !== "boolean" ||
      !isDateTime(operation.issued_at) ||
      !isDateTime(operation.expires_at) ||
      Date.parse(operation.expires_at) <= Date.parse(operation.issued_at) ||
      !["unresolved", "succeeded", "rejected"].includes(operation.state)
    )
      throw storageError();
    if (
      (operation.state === "unresolved" &&
        (operation.applied_account_version !== null ||
          operation.applied_approved !== null ||
          operation.finalized_at !== null ||
          operation.rejection_code !== null)) ||
      (operation.state === "succeeded" &&
        (!Number.isSafeInteger(operation.applied_account_version) ||
          operation.applied_account_version! < 1 ||
          typeof operation.applied_approved !== "boolean" ||
          !isDateTime(operation.finalized_at) ||
          operation.rejection_code !== null)) ||
      (operation.state === "rejected" &&
        (operation.applied_account_version !== null ||
          operation.applied_approved !== null ||
          !isDateTime(operation.finalized_at) ||
          typeof operation.rejection_code !== "string" ||
          !operation.rejection_code))
    )
      throw storageError();
    keys.add(operation.key);
  }
}

function validateCredentialOverrides(
  overrides: unknown[],
  registeredAccounts: MockRegisteredAccount[],
): void {
  const accountIds = new Set([
    ...MOCK_ACCOUNTS.map((account) => account.id),
    ...registeredAccounts.map((account) => account.id),
  ]);
  const seen = new Set<string>();
  for (const value of overrides) {
    if (!hasExactKeys(value, CREDENTIAL_OVERRIDE_KEYS)) throw storageError();
    const override = value as unknown as MockCredentialOverride;
    if (
      !accountIds.has(override.account_id) ||
      seen.has(override.account_id) ||
      typeof override.password !== "string" ||
      Array.from(override.password).length < 15 ||
      Array.from(override.password).length > 128 ||
      typeof override.must_change_password !== "boolean" ||
      (override.temporary_password_expires_at !== null &&
        !isDateTime(override.temporary_password_expires_at)) ||
      override.must_change_password !==
        (override.temporary_password_expires_at !== null)
    )
      throw storageError();
    seen.add(override.account_id);
  }
}

function initialPrincipalSession(
  principalId: unknown,
): MockPrincipalSession | null {
  if (typeof principalId !== "string") return null;
  return {
    session_kind: "full",
    expires_at: new Date(
      Date.parse(MOCK_INITIAL_TIME) + 8 * 60 * 60 * 1000,
    ).toISOString(),
    recent_auth_until: null,
  };
}

function nextGeneration(currentGeneration: number): number {
  const current = Math.max(currentGeneration, resetGeneration);
  return current >= Number.MAX_SAFE_INTEGER ? 0 : current + 1;
}

function initialAdminUsers(
  registeredAccounts: MockRegisteredAccount[] = [],
): MockAdminUserState[] {
  return [
    ...MOCK_ACCOUNTS.map((account) => ({
      id: account.id,
      approved: account.approved,
      account_version: 1,
      created_at: account.createdAt,
      first_approved_at: account.approved ? account.createdAt : null,
    })),
    ...registeredAccounts.map((account) => ({
      id: account.id,
      approved: false,
      account_version: 1,
      created_at: new Date(
        Date.parse(account.pendingExpiresAt) - 90 * 24 * 60 * 60 * 1000,
      ).toISOString(),
      first_approved_at: null,
    })),
  ];
}

function mockFlowId(sequence: number): string {
  return `00000000-0000-4000-8000-${String(200 + sequence).padStart(12, "0")}`;
}

function initialAuthFlow(): MockAuthFlow {
  return {
    flow_id: MOCK_FLOW_ID,
    revision: "0",
    session_generation: "0",
    last_identity_change_revision: "0",
    issued_session_generation: "0",
    flow_sequence: 0,
    expires_at: new Date(
      Date.parse(MOCK_INITIAL_TIME) + MOCK_FLOW_LIFETIME_MS,
    ).toISOString(),
    recovery_ready: true,
    recovery_cookie_generation: "1",
    recovery_cookie_present: true,
    session_cookie_present: true,
    pending_transition: null,
    transitions: [],
    blocked_transition_ids: [],
    unresolved_transition_id: null,
    restart_eligible: false,
    gate_open: false,
  };
}

function migrateAuthFlow(value: unknown, hasPrincipal: boolean): MockAuthFlow {
  if (!hasExactKeys(value, AUTH_FLOW_V6_KEYS)) throw storageError();
  const flow = value;
  const base = initialAuthFlow();
  return {
    ...base,
    flow_id: flow.flow_id as string,
    revision: flow.revision as string,
    session_generation: flow.session_generation as string | null,
    last_identity_change_revision: flow.last_identity_change_revision as string,
    issued_session_generation: flow.issued_session_generation as string,
    session_cookie_present: hasPrincipal && flow.session_generation !== null,
  };
}

const initialState = (): MockState => ({
  version: 7,
  generation: resetGeneration,
  observation_generation: 0,
  scenario: "original",
  apps: publicApps,
  private_apps: privateApps,
  principal_id: null,
  registered_accounts: [],
  admin_users: initialAdminUsers(),
  approval_operations: [],
  approval_operation_sequence: 0,
  mock_now: MOCK_INITIAL_TIME,
  credential_overrides: [],
  principal_session: null,
  auth_flow: initialAuthFlow(),
});

function storage(): Storage {
  try {
    return window.localStorage;
  } catch {
    throw storageError();
  }
}

function storageError(): ServiceError {
  return new ServiceError(
    "MOCK_STORAGE_ERROR",
    "개발용 저장 데이터를 읽거나 저장하지 못했어요. mock reset 화면을 확인해 주세요.",
  );
}

function readState(): MockState {
  let raw: string | null;
  try {
    raw = storage().getItem(MOCK_STORAGE_KEY);
  } catch {
    throw storageError();
  }
  if (raw === null) {
    const state = initialState();
    writeState(state);
    return state;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw storageError();
  }
  let state: Record<string, unknown>;
  let needsMigration = false;
  let preserveAdminUsers = false;
  if (hasExactKeys(value, LEGACY_STATE_KEYS) && value.version === 1) {
    state = {
      ...value,
      version: 7,
      private_apps: privateApps,
      principal_id: null,
      registered_accounts: [],
      observation_generation: 0,
      auth_flow: initialState().auth_flow,
      admin_users: [],
      approval_operations: [],
      approval_operation_sequence: 0,
      mock_now: MOCK_INITIAL_TIME,
      credential_overrides: [],
      principal_session: null,
    };
    needsMigration = true;
  } else if (hasExactKeys(value, V2_STATE_KEYS) && value.version === 2) {
    state = {
      ...value,
      version: 7,
      registered_accounts: [],
      observation_generation: 0,
      auth_flow: initialState().auth_flow,
      admin_users: [],
      approval_operations: [],
      approval_operation_sequence: 0,
      mock_now: MOCK_INITIAL_TIME,
      credential_overrides: [],
      principal_session: initialPrincipalSession(value.principal_id),
    };
    needsMigration = true;
  } else if (hasExactKeys(value, V3_STATE_KEYS) && value.version === 3) {
    state = {
      ...value,
      version: 7,
      observation_generation: 0,
      auth_flow: initialState().auth_flow,
      admin_users: [],
      approval_operations: [],
      approval_operation_sequence: 0,
      mock_now: MOCK_INITIAL_TIME,
      credential_overrides: [],
      principal_session: initialPrincipalSession(value.principal_id),
    };
    needsMigration = true;
  } else if (hasExactKeys(value, V4_STATE_KEYS) && value.version === 4) {
    state = {
      ...value,
      version: 7,
      auth_flow: migrateAuthFlow(value.auth_flow, value.principal_id !== null),
      admin_users: [],
      approval_operations: [],
      approval_operation_sequence: 0,
      mock_now: MOCK_INITIAL_TIME,
      credential_overrides: [],
      principal_session: initialPrincipalSession(value.principal_id),
    };
    needsMigration = true;
  } else if (hasExactKeys(value, V5_STATE_KEYS) && value.version === 5) {
    const previousUsers = value.admin_users as MockAdminUserState[];
    const addedUsers = initialAdminUsers(
      value.registered_accounts as MockRegisteredAccount[],
    ).filter(
      (user) => !previousUsers.some((previous) => previous.id === user.id),
    );
    state = {
      ...value,
      version: 7,
      auth_flow: migrateAuthFlow(value.auth_flow, value.principal_id !== null),
      mock_now: MOCK_INITIAL_TIME,
      credential_overrides: [],
      principal_session: initialPrincipalSession(value.principal_id),
      admin_users: [...previousUsers, ...addedUsers],
    };
    needsMigration = true;
    preserveAdminUsers = true;
  } else if (hasExactKeys(value, STATE_KEYS) && value.version === 6) {
    state = {
      ...value,
      version: 7,
      auth_flow: migrateAuthFlow(value.auth_flow, value.principal_id !== null),
    };
    needsMigration = true;
    preserveAdminUsers = true;
  } else if (hasExactKeys(value, STATE_KEYS) && value.version === 7) {
    state = value;
  } else {
    throw storageError();
  }
  if (
    state.version !== 7 ||
    typeof state.generation !== "number" ||
    !Number.isSafeInteger(state.generation) ||
    state.generation < 0 ||
    !isMockScenario(state.scenario) ||
    !Array.isArray(state.apps) ||
    !Array.isArray(state.private_apps) ||
    !Array.isArray(state.registered_accounts) ||
    !Array.isArray(state.credential_overrides) ||
    !isDateTime(state.mock_now) ||
    typeof state.observation_generation !== "number" ||
    !Number.isSafeInteger(state.observation_generation) ||
    state.observation_generation < 0 ||
    (!needsMigration &&
      (!Array.isArray(state.admin_users) ||
        !Array.isArray(state.approval_operations) ||
        typeof state.approval_operation_sequence !== "number" ||
        !Number.isSafeInteger(state.approval_operation_sequence) ||
        state.approval_operation_sequence < 0)) ||
    !hasExactKeys(state.auth_flow, AUTH_FLOW_KEYS) ||
    (state.principal_id !== null && typeof state.principal_id !== "string") ||
    (state.principal_session !== null &&
      !hasExactKeys(state.principal_session, PRINCIPAL_SESSION_KEYS)) ||
    (state.principal_id === null) !== (state.principal_session === null)
  ) {
    throw storageError();
  }
  const flow = state.auth_flow as Record<string, unknown>;
  const flowId = flow.flow_id;
  const pendingTransition = flow.pending_transition;
  const transitions = flow.transitions;
  const blockedTransitionIds = flow.blocked_transition_ids;
  const transitionIdIsValid = (value: unknown) =>
    typeof value === "string" &&
    value.startsWith(`${String(flowId)}.`) &&
    validSequence(value.slice(String(flowId).length + 1));
  if (
    typeof flow.flow_sequence !== "number" ||
    !Number.isSafeInteger(flow.flow_sequence) ||
    flow.flow_sequence < 0 ||
    flowId !== mockFlowId(flow.flow_sequence) ||
    !validSequence(flow.revision) ||
    (flow.session_generation !== null &&
      !validSequence(flow.session_generation)) ||
    !validSequence(flow.last_identity_change_revision) ||
    !validSequence(flow.issued_session_generation) ||
    !isDateTime(flow.expires_at) ||
    typeof flow.recovery_ready !== "boolean" ||
    !validSequence(flow.recovery_cookie_generation) ||
    typeof flow.recovery_cookie_present !== "boolean" ||
    typeof flow.session_cookie_present !== "boolean" ||
    (flow.session_cookie_present && flow.session_generation === null) ||
    (flow.session_generation !== null &&
      BigInt(flow.session_generation) >
        BigInt(flow.issued_session_generation)) ||
    BigInt(flow.last_identity_change_revision) > BigInt(flow.revision) ||
    (pendingTransition !== null &&
      (!validTransition(pendingTransition, String(flowId)) ||
        (pendingTransition.state !== "admitted" &&
          pendingTransition.state !== "executing"))) ||
    !Array.isArray(transitions) ||
    !transitions.every((item) => validTransition(item, String(flowId))) ||
    (pendingTransition !== null &&
      transitions.some(
        (item) => item.transition_id === pendingTransition.transition_id,
      )) ||
    !Array.isArray(blockedTransitionIds) ||
    !blockedTransitionIds.every(transitionIdIsValid) ||
    new Set(blockedTransitionIds).size !== blockedTransitionIds.length ||
    (flow.unresolved_transition_id !== null &&
      !transitionIdIsValid(flow.unresolved_transition_id)) ||
    typeof flow.restart_eligible !== "boolean" ||
    typeof flow.gate_open !== "boolean"
  )
    throw storageError();
  const validState = state as unknown as MockState;
  if (needsMigration) {
    try {
      validateRegisteredAccounts(validState.registered_accounts);
    } catch {
      throw storageError();
    }
    if (!preserveAdminUsers) {
      validState.admin_users = initialAdminUsers(
        validState.registered_accounts,
      );
      validState.approval_operations = [];
      validState.approval_operation_sequence = 0;
    }
  }
  try {
    validateRegisteredAccounts(state.registered_accounts);
    validateAdminUsers(validState.admin_users, validState.registered_accounts);
    validateApprovalOperations(validState.approval_operations);
    validateCredentialOverrides(
      validState.credential_overrides,
      validState.registered_accounts,
    );
    validateApps(state.apps, true);
    validateApps(state.private_apps, false);
  } catch {
    throw storageError();
  }
  if (validState.principal_session !== null) {
    const session = validState.principal_session;
    if (
      (session.session_kind !== "full" &&
        session.session_kind !== "change_only") ||
      !isDateTime(session.expires_at) ||
      (session.recent_auth_until !== null &&
        !isDateTime(session.recent_auth_until)) ||
      (session.session_kind === "change_only" &&
        session.recent_auth_until !== null)
    )
      throw storageError();
  }
  const ids = new Set(state.apps.map((app) => app.id));
  if (state.private_apps.some((app) => ids.has(app.id))) throw storageError();
  if (
    state.principal_id !== null &&
    !MOCK_ACCOUNTS.some((account) => account.id === state.principal_id) &&
    !state.registered_accounts.some(
      (account) => account.id === state.principal_id,
    )
  )
    throw storageError();
  if (needsMigration) {
    validState.generation = nextGeneration(validState.generation);
    writeState(validState);
    resetGeneration = validState.generation;
  }
  return validState;
}

function writeState(state: MockState): void {
  try {
    storage().setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw storageError();
  }
}

export function getMockSnapshot(): MockState {
  return readState();
}

export function getMockNow(state = readState()): string {
  return state.mock_now;
}

export function setMockClock(value: string): void {
  const date = new Date(value);
  if (!isDateTime(value) || !Number.isFinite(date.getTime()))
    throw new TypeError("Unsupported mock time");
  const state = readState();
  const generation = nextGeneration(state.generation);
  writeState({ ...state, mock_now: date.toISOString(), generation });
  resetGeneration = generation;
  window.dispatchEvent(new Event(MOCK_RESET_EVENT));
}

export type MockAccountRecord = {
  id: string;
  loginId: string;
  nickname: string;
  password: string;
  role: "admin" | "user";
  approved: boolean;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt: string | null;
  accountVersion: number;
  createdAt: string;
  firstApprovedAt: string | null;
  pendingExpiresAt: string | null;
};

export function getMockAccounts(
  state = readState(),
  includeTemporaryFixtures = false,
): MockAccountRecord[] {
  const demoAccounts = MOCK_ACCOUNTS.filter(
    (account) =>
      !("temporaryDemoFixture" in account) ||
      includeTemporaryFixtures ||
      state.credential_overrides.some(
        (item) => item.account_id === account.id && !item.must_change_password,
      ),
  );
  const bases = [...demoAccounts, ...state.registered_accounts];
  return bases.map((base) => {
    const status = state.admin_users.find((user) => user.id === base.id);
    const override = state.credential_overrides.find(
      (item) => item.account_id === base.id,
    );
    if (!status) throw storageError();
    return {
      id: base.id,
      loginId: base.loginId,
      nickname: base.nickname,
      password: override?.password ?? base.password,
      role: "role" in base ? base.role : "user",
      approved: status.approved,
      mustChangePassword:
        override?.must_change_password ??
        ("mustChangePassword" in base && base.mustChangePassword === true),
      temporaryPasswordExpiresAt: override
        ? override.temporary_password_expires_at
        : "temporaryPasswordExpiresAt" in base
          ? base.temporaryPasswordExpiresAt
          : null,
      accountVersion: status.account_version,
      createdAt: status.created_at,
      firstApprovedAt: status.first_approved_at,
      pendingExpiresAt:
        "pendingExpiresAt" in base ? base.pendingExpiresAt : null,
    };
  });
}

export function createMockApprovalOperation(input: {
  actorId: string;
  targetId: string;
  expectedAccountVersion: number;
  approved: boolean;
  issuedAt: string;
  expiresAt: string;
}): MockApprovalOperation {
  const state = readState();
  if (state.approval_operation_sequence >= Number.MAX_SAFE_INTEGER - 0x300)
    throw new ServiceError(
      "SERVICE_UNAVAILABLE",
      "작업 키를 발급할 수 없어요.",
    );
  const key = `00000000-0000-4000-8000-${String(0x300 + state.approval_operation_sequence).padStart(12, "0")}`;
  const operation: MockApprovalOperation = {
    key,
    actor_id: input.actorId,
    target_id: input.targetId,
    expected_account_version: input.expectedAccountVersion,
    approved: input.approved,
    issued_at: input.issuedAt,
    expires_at: input.expiresAt,
    state: "unresolved",
    applied_account_version: null,
    applied_approved: null,
    finalized_at: null,
    rejection_code: null,
  };
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    approval_operations: [...state.approval_operations, operation],
    approval_operation_sequence: state.approval_operation_sequence + 1,
    generation,
  });
  resetGeneration = generation;
  return operation;
}

export function getMockApprovalOperation(
  key: string,
): MockApprovalOperation | undefined {
  return readState().approval_operations.find((item) => item.key === key);
}

export function finishMockApprovalOperation(
  key: string,
  finalizedAt: string,
  cancel = false,
): MockApprovalOperation | undefined {
  const state = readState();
  const current = state.approval_operations.find((item) => item.key === key);
  if (!current || current.state !== "unresolved") return current;

  let operation: MockApprovalOperation = {
    ...current,
    state: "rejected",
    finalized_at: finalizedAt,
    rejection_code: "OPERATION_CANCELLED",
  };
  let adminUsers = state.admin_users;
  let principalId = state.principal_id;
  let authFlow = state.auth_flow;
  let observationGeneration = state.observation_generation;
  if (!cancel) {
    const target = getMockAccounts(state).find(
      (account) => account.id === current.target_id,
    );
    const targetStatus = state.admin_users.find(
      (user) => user.id === current.target_id,
    );
    if (!target || !targetStatus) operation.rejection_code = "USER_NOT_FOUND";
    else if (target.role === "admin")
      operation.rejection_code = "ADMIN_ACCOUNT_PROTECTED";
    else if (targetStatus.account_version !== current.expected_account_version)
      operation.rejection_code = "USER_STATE_CONFLICT";
    else {
      const accountVersion = targetStatus.account_version + 1;
      if (!Number.isSafeInteger(accountVersion))
        throw new ServiceError(
          "SERVICE_UNAVAILABLE",
          "계정 상태를 변경할 수 없어요.",
        );
      operation = {
        ...current,
        state: "succeeded",
        applied_account_version: accountVersion,
        applied_approved: current.approved,
        finalized_at: finalizedAt,
        rejection_code: null,
      };
      adminUsers = state.admin_users.map((user) =>
        user.id === current.target_id
          ? {
              ...user,
              approved: current.approved,
              account_version: accountVersion,
              first_approved_at:
                current.approved && user.first_approved_at === null
                  ? finalizedAt
                  : user.first_approved_at,
            }
          : user,
      );
      if (!current.approved && principalId === current.target_id) {
        principalId = null;
        const revision = (BigInt(authFlow.revision) + 1n).toString();
        authFlow = {
          ...authFlow,
          revision,
          session_generation: null,
          last_identity_change_revision: revision,
        };
        observationGeneration =
          observationGeneration >= Number.MAX_SAFE_INTEGER
            ? 0
            : observationGeneration + 1;
      }
    }
  }
  const generation = nextGeneration(state.generation);
  // ponytail: localStorage updates are one-browser mock state, not cross-tab DB transactions; production uses the transactional API contract.
  writeState({
    ...state,
    admin_users: adminUsers,
    approval_operations: state.approval_operations.map((item) =>
      item.key === key ? operation : item,
    ),
    principal_id: principalId,
    auth_flow: authFlow,
    observation_generation: observationGeneration,
    generation,
  });
  resetGeneration = generation;
  return operation;
}

export function resetMockState(): void {
  let next = nextGeneration(resetGeneration);
  try {
    const current = readState();
    next = nextGeneration(current.generation);
  } catch {
    // An explicit reset is the recovery path for damaged or unsupported saved data.
  }
  writeState({ ...initialState(), generation: next });
  resetGeneration = next;
  window.dispatchEvent(new Event(MOCK_RESET_EVENT));
}

export function setMockScenario(scenario: MockScenario): void {
  if (!isMockScenario(scenario))
    throw new TypeError("Unsupported mock scenario");
  const state = readState();
  const next = nextGeneration(state.generation);
  writeState({ ...state, scenario, generation: next });
  resetGeneration = next;
  window.dispatchEvent(new Event(MOCK_RESET_EVENT));
}

export function readMockScenario(): MockScenario {
  return readState().scenario;
}

function nextFlowRevision(flow: MockAuthFlow): string {
  return (BigInt(flow.revision) + 1n).toString();
}

function boundedUnique(values: string[], value: string): string[] {
  return [...values.filter((item) => item !== value), value].slice(-100);
}

function transitionLookup(
  flow: MockAuthFlow,
  transitionId: string,
  now: string,
) {
  const transition =
    flow.pending_transition?.transition_id === transitionId
      ? flow.pending_transition
      : flow.transitions.find((item) => item.transition_id === transitionId);
  if (
    transition &&
    (flow.pending_transition === transition ||
      Date.parse(now) < Date.parse(transition.result_available_until))
  )
    return {
      transition_id: transition.transition_id,
      availability: "available" as const,
      execution_blocked: null,
      kind: transition.kind,
      state: transition.state,
      permit_expires_at: transition.permit_expires_at,
      result_session_generation: transition.result_session_generation,
      failure_code: transition.failure_code,
    };
  return {
    transition_id: transitionId,
    availability: "unavailable" as const,
    execution_blocked: flow.blocked_transition_ids.includes(transitionId),
    kind: null,
    state: null,
    permit_expires_at: null,
    result_session_generation: null,
    failure_code: null,
  };
}

export function getMockAuthFlowState(transitionId?: string) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    transitionId !== undefined &&
    (!transitionId.startsWith(`${flow.flow_id}.`) ||
      !validSequence(transitionId.slice(flow.flow_id.length + 1)))
  )
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "이전 인증 요청의 흐름이 바뀌었습니다. 현재 상태를 다시 확인해 주세요.",
      { httpStatus: 409, outcome: "rejected" },
    );
  const now = getMockNow(state);
  const canStart =
    flow.recovery_ready &&
    flow.pending_transition === null &&
    flow.unresolved_transition_id === null &&
    Date.parse(now) < Date.parse(flow.expires_at);
  return {
    flow_id: flow.flow_id,
    revision: flow.revision,
    server_time: now,
    expires_at: flow.expires_at,
    recovery_ready: flow.recovery_ready,
    session_generation: flow.session_generation,
    session_cookie_present: flow.session_cookie_present,
    last_identity_change_revision: flow.last_identity_change_revision,
    pending_transition: flow.pending_transition
      ? transitionLookup(flow, flow.pending_transition.transition_id, now)
      : null,
    requested_transition:
      transitionId === undefined
        ? null
        : transitionLookup(flow, transitionId, now),
    next_transition_id: canStart ? `${flow.flow_id}.${flow.revision}` : null,
  };
}

function authFlowConflict(): ServiceError {
  return new ServiceError(
    "AUTH_STATE_CHANGED",
    "인증 흐름이 바뀌었습니다. 현재 상태를 다시 확인해 주세요.",
    { httpStatus: 409, outcome: "rejected" },
  );
}

export function createMockAuthFlow(restartFrom: string[]) {
  const state = readState();
  const previous = state.auth_flow;
  if (
    !previous.restart_eligible ||
    !restartFrom.includes(previous.flow_id) ||
    new Set(restartFrom).size !== restartFrom.length
  )
    throw authFlowConflict();
  const flowSequence = previous.flow_sequence + 1;
  if (!Number.isSafeInteger(flowSequence)) throw authFlowConflict();
  const base = initialAuthFlow();
  const flow: MockAuthFlow = {
    ...base,
    flow_id: mockFlowId(flowSequence),
    flow_sequence: flowSequence,
    session_generation: null,
    session_cookie_present: false,
    recovery_ready: false,
    recovery_cookie_generation: "0",
    recovery_cookie_present: false,
    expires_at: new Date(
      Date.parse(state.mock_now) + MOCK_FLOW_LIFETIME_MS,
    ).toISOString(),
  };
  const generation = nextGeneration(state.generation);
  writeState({ ...state, generation, auth_flow: flow });
  resetGeneration = generation;
  return {
    flow_id: flow.flow_id,
    revision: flow.revision,
    expires_at: flow.expires_at,
  };
}

export function issueMockRecoveryCookie(flowId: string) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    flow.flow_id !== flowId ||
    flow.recovery_ready ||
    flow.recovery_cookie_present
  )
    throw authFlowConflict();
  const revision = nextFlowRevision(flow);
  const recoveryCookieGeneration = (
    BigInt(flow.recovery_cookie_generation) + 1n
  ).toString();
  const expiresAt = flow.expires_at;
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    generation,
    auth_flow: {
      ...flow,
      revision,
      recovery_cookie_generation: recoveryCookieGeneration,
      recovery_cookie_present: true,
    },
  });
  resetGeneration = generation;
  return {
    flow_id: flowId,
    revision,
    recovery_csrf_token: `mock-only-recovery-csrf-${flowId}-${recoveryCookieGeneration}`,
    expires_at: expiresAt,
  };
}

export function confirmMockRecoveryCookie(
  flowId: string,
  expectedRevision: string,
) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    flow.flow_id !== flowId ||
    flow.revision !== expectedRevision ||
    !flow.recovery_cookie_present ||
    flow.recovery_ready ||
    Date.parse(state.mock_now) >= Date.parse(flow.expires_at)
  )
    throw authFlowConflict();
  const revision = nextFlowRevision(flow);
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    generation,
    auth_flow: { ...flow, revision, recovery_ready: true },
  });
  resetGeneration = generation;
  return {
    flow_id: flowId,
    revision,
    expires_at: flow.expires_at,
    ready: true as const,
  };
}

export function abandonMockAuthFlow(flowId: string) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    flow.flow_id !== flowId ||
    flow.recovery_ready ||
    flow.session_cookie_present ||
    flow.pending_transition
  )
    throw authFlowConflict();
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    generation,
    auth_flow: { ...flow, restart_eligible: true },
  });
  resetGeneration = generation;
  return { restart_eligible: true };
}

export function getMockRecoveryContext() {
  const { auth_flow: flow } = readState();
  const proofKind = flow.recovery_cookie_present
    ? "recovery"
    : flow.session_cookie_present
      ? "session"
      : null;
  return {
    items: proofKind
      ? [
          {
            flow_id: flow.flow_id,
            revision: flow.revision,
            proof_kind: proofKind,
          },
        ]
      : [],
  };
}

export function getMockRecoveryCsrf(flowId: string) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    flow.flow_id !== flowId ||
    !flow.recovery_cookie_present ||
    Date.parse(state.mock_now) >= Date.parse(flow.expires_at)
  )
    throw new ServiceError("AUTH_REQUIRED", "복구 상태를 확인해 주세요.", {
      httpStatus: 401,
      outcome: "rejected",
    });
  return {
    flow_id: flow.flow_id,
    revision: flow.revision,
    recovery_csrf_token: `mock-only-recovery-csrf-${flow.flow_id}-${flow.recovery_cookie_generation}`,
    expires_at: flow.expires_at,
  };
}

export function rotateMockRecoveryCookie(input: {
  flowId: string;
  expectedRevision: string;
  expectedSessionGeneration: string;
}) {
  const state = readState();
  const flow = state.auth_flow;
  const session = state.principal_session;
  if (flow.pending_transition || flow.unresolved_transition_id)
    throw new ServiceError(
      "AUTH_TRANSITION_PENDING",
      "현재 인증 결과를 먼저 확인해 주세요.",
      { httpStatus: 409, outcome: "rejected" },
    );
  if (
    flow.flow_id !== input.flowId ||
    flow.revision !== input.expectedRevision ||
    flow.session_generation !== input.expectedSessionGeneration ||
    !flow.session_cookie_present ||
    Date.parse(state.mock_now) >= Date.parse(flow.expires_at) ||
    state.principal_id === null ||
    session?.session_kind !== "full"
  )
    throw authFlowConflict();
  const revision = nextFlowRevision(flow);
  const recoveryCookieGeneration = (
    BigInt(flow.recovery_cookie_generation) + 1n
  ).toString();
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    generation,
    auth_flow: {
      ...flow,
      revision,
      recovery_cookie_generation: recoveryCookieGeneration,
      recovery_cookie_present: true,
    },
  });
  resetGeneration = generation;
  return {
    flow_id: flow.flow_id,
    revision,
    recovery_csrf_token: `mock-only-recovery-csrf-${flow.flow_id}-${recoveryCookieGeneration}`,
    expires_at: flow.expires_at,
  };
}

export function getMockRestartEligibility(flowId: string) {
  const { auth_flow: flow } = readState();
  if (flow.flow_id !== flowId)
    throw new ServiceError("NOT_FOUND", "인증 흐름을 찾을 수 없어요.", {
      httpStatus: 404,
      outcome: "rejected",
    });
  return { restart_eligible: flow.restart_eligible };
}

export function admitMockAuthTransition(input: {
  flowId: string;
  transitionId: string;
  kind: AuthTransitionKind;
  expectedRevision: string;
  expectedSessionGeneration: string | null;
}) {
  const state = readState();
  const flow = state.auth_flow;
  const conflict = (code: "AUTH_STATE_CHANGED" | "AUTH_TRANSITION_PENDING") =>
    new ServiceError(
      code,
      "인증 상태가 바뀌었습니다. 현재 상태를 다시 확인해 주세요.",
      {
        httpStatus: 409,
        outcome: "rejected",
      },
    );
  if (
    flow.flow_id !== input.flowId ||
    flow.revision !== input.expectedRevision ||
    input.transitionId !== `${flow.flow_id}.${flow.revision}` ||
    flow.session_generation !== input.expectedSessionGeneration
  )
    throw conflict("AUTH_STATE_CHANGED");
  if (
    flow.pending_transition !== null ||
    flow.unresolved_transition_id !== null
  )
    throw conflict("AUTH_TRANSITION_PENDING");
  if (
    !flow.recovery_ready ||
    !flow.recovery_cookie_present ||
    Date.parse(state.mock_now) >= Date.parse(flow.expires_at)
  )
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "인증 흐름을 복구한 뒤 다시 시도해 주세요.",
      { httpStatus: 409, outcome: "rejected" },
    );
  const permitExpiresAt = new Date(
    Date.parse(state.mock_now) + 60_000,
  ).toISOString();
  const transition: MockAuthTransition = {
    transition_id: input.transitionId,
    kind: input.kind,
    state: "admitted",
    permit_expires_at: permitExpiresAt,
    result_session_generation: null,
    failure_code: null,
    result_available_until: new Date(
      Date.parse(state.mock_now) + 30 * 60_000,
    ).toISOString(),
  };
  const revision = nextFlowRevision(flow);
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    generation,
    auth_flow: {
      ...flow,
      revision,
      pending_transition: transition,
      gate_open: false,
    },
  });
  resetGeneration = generation;
  return {
    flow_id: flow.flow_id,
    transition_id: transition.transition_id,
    kind: transition.kind,
    revision,
    permit_expires_at: permitExpiresAt,
  };
}

export function finishMockAuthTransition(input: {
  transitionId: string;
  expectedGeneration: number;
  state: Exclude<AuthTransitionState, "admitted" | "executing">;
  resultSessionGeneration?: string | null;
  failureCode?: string | null;
  identityChanged?: boolean;
  loseResult?: boolean;
  responseLost?: boolean;
}): MockAuthTransition {
  const state = readState();
  const flow = state.auth_flow;
  const pending = flow.pending_transition;
  if (
    state.generation !== input.expectedGeneration ||
    !pending ||
    pending.transition_id !== input.transitionId ||
    Date.parse(state.mock_now) >= Date.parse(pending.permit_expires_at)
  )
    throw new DOMException("Mock auth transition changed", "AbortError");
  const revision = nextFlowRevision(flow);
  const completed: MockAuthTransition = {
    ...pending,
    state: input.state,
    result_session_generation: input.resultSessionGeneration ?? null,
    failure_code: input.failureCode ?? null,
  };
  const unavailable = input.loseResult === true;
  const unresolved = input.responseLost || unavailable;
  const generation = nextGeneration(state.generation);
  const transitions = unavailable
    ? flow.transitions
    : [...flow.transitions, completed].slice(-30);
  writeState({
    ...state,
    generation,
    observation_generation: input.identityChanged
      ? state.observation_generation >= Number.MAX_SAFE_INTEGER
        ? 0
        : state.observation_generation + 1
      : state.observation_generation,
    auth_flow: {
      ...flow,
      revision,
      last_identity_change_revision: input.identityChanged
        ? revision
        : flow.last_identity_change_revision,
      pending_transition: null,
      transitions,
      blocked_transition_ids: flow.blocked_transition_ids,
      unresolved_transition_id: unresolved ? input.transitionId : null,
      gate_open: false,
    },
  });
  resetGeneration = generation;
  return completed;
}

export function settleMockAuthTransition(input: {
  transitionId: string;
  flowId: string;
  expectedRevision: string;
}): {
  flow_id: string;
  revision: string;
  transition_id: string;
  result: ReturnType<typeof transitionLookup>;
} {
  const state = readState();
  const flow = state.auth_flow;
  if (
    flow.flow_id !== input.flowId ||
    flow.revision !== input.expectedRevision ||
    !input.transitionId.startsWith(`${flow.flow_id}.`) ||
    !validSequence(input.transitionId.slice(flow.flow_id.length + 1))
  )
    throw new ServiceError(
      "AUTH_STATE_CHANGED",
      "인증 흐름이 바뀌었습니다. 현재 상태를 다시 확인해 주세요.",
      { httpStatus: 409, outcome: "rejected" },
    );
  if (
    flow.pending_transition &&
    flow.pending_transition.transition_id !== input.transitionId
  )
    throw new ServiceError(
      "AUTH_TRANSITION_PENDING",
      "다른 인증 요청의 결과를 먼저 확인해 주세요.",
      { httpStatus: 409, outcome: "rejected" },
    );
  const pending = flow.pending_transition;
  if (pending) {
    const revision = nextFlowRevision(flow);
    const cancelled = {
      ...pending,
      state:
        Date.parse(state.mock_now) >= Date.parse(pending.permit_expires_at)
          ? ("expired" as const)
          : ("cancelled" as const),
      failure_code: null,
    };
    const generation = nextGeneration(state.generation);
    const nextFlow: MockAuthFlow = {
      ...flow,
      revision,
      pending_transition: null,
      transitions: [...flow.transitions, cancelled].slice(-30),
      blocked_transition_ids: boundedUnique(
        flow.blocked_transition_ids,
        input.transitionId,
      ),
      unresolved_transition_id: null,
      gate_open: false,
    };
    writeState({ ...state, generation, auth_flow: nextFlow });
    resetGeneration = generation;
    window.dispatchEvent(new Event(MOCK_AUTH_STATE_EVENT));
    return {
      flow_id: flow.flow_id,
      revision,
      transition_id: input.transitionId,
      result: transitionLookup(nextFlow, input.transitionId, state.mock_now),
    };
  }

  const existing = transitionLookup(flow, input.transitionId, state.mock_now);
  const unavailable = existing.availability === "unavailable";
  const missingIssuedSession =
    existing.availability === "available" &&
    existing.state === "succeeded" &&
    existing.result_session_generation !== null &&
    flow.session_generation === existing.result_session_generation &&
    !flow.session_cookie_present;
  let nextFlow = flow;
  if (unavailable && !existing.execution_blocked) {
    const revision = nextFlowRevision(flow);
    nextFlow = {
      ...flow,
      revision,
      blocked_transition_ids: boundedUnique(
        flow.blocked_transition_ids,
        input.transitionId,
      ),
      unresolved_transition_id: input.transitionId,
    };
  } else if (unavailable) {
    nextFlow = flow;
  } else if (!missingIssuedSession && flow.unresolved_transition_id !== null) {
    nextFlow = { ...flow, unresolved_transition_id: null };
  }
  if (nextFlow !== flow) {
    const generation = nextGeneration(state.generation);
    writeState({ ...state, generation, auth_flow: nextFlow });
    resetGeneration = generation;
  }
  return {
    flow_id: flow.flow_id,
    revision: nextFlow.revision,
    transition_id: input.transitionId,
    result: transitionLookup(nextFlow, input.transitionId, state.mock_now),
  };
}

export function setMockAuthGateOpen(): void {
  const state = readState();
  if (state.scenario !== "auth_transition_gate") return;
  writeState({ ...state, auth_flow: { ...state.auth_flow, gate_open: true } });
  window.dispatchEvent(new Event("eduvibe:mock-auth-gate-open"));
}

export function commitMockAnonymousSession(input: {
  transitionId: string;
  expectedGeneration: number;
  sessionCookiePresent?: boolean;
}) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    state.generation !== input.expectedGeneration ||
    flow.pending_transition?.transition_id !== input.transitionId ||
    flow.pending_transition.kind !== "anonymous_session" ||
    state.principal_id !== null ||
    !flow.recovery_ready ||
    !flow.recovery_cookie_present ||
    flow.session_generation !== null
  )
    throw new DOMException("Mock auth transition changed", "AbortError");
  const sessionGeneration = (
    BigInt(flow.issued_session_generation) + 1n
  ).toString();
  const generation = nextGeneration(state.generation);
  const expiresAt = flow.expires_at;
  writeState({
    ...state,
    generation,
    auth_flow: {
      ...flow,
      session_generation: sessionGeneration,
      issued_session_generation: sessionGeneration,
      session_cookie_present: input.sessionCookiePresent ?? true,
      expires_at: expiresAt,
    },
  });
  resetGeneration = generation;
  return {
    flow_id: flow.flow_id,
    session_generation: sessionGeneration,
    csrf_token: "mock-only-csrf-token",
    expires_at: expiresAt,
  };
}

export function discardMockAuthSession(input: {
  transitionId: string;
  flowId: string;
  expectedRevision: string;
  expectedSessionGeneration: string;
}) {
  const state = readState();
  const flow = state.auth_flow;
  const transition = transitionLookup(flow, input.transitionId, state.mock_now);
  if (
    flow.flow_id !== input.flowId ||
    flow.revision !== input.expectedRevision ||
    flow.session_generation !== input.expectedSessionGeneration ||
    flow.session_cookie_present ||
    transition.availability !== "available" ||
    transition.state !== "succeeded" ||
    transition.result_session_generation !== input.expectedSessionGeneration
  )
    throw authFlowConflict();
  const revision = nextFlowRevision(flow);
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    principal_id: null,
    principal_session: null,
    generation,
    observation_generation:
      state.principal_id === null
        ? state.observation_generation
        : state.observation_generation >= Number.MAX_SAFE_INTEGER
          ? 0
          : state.observation_generation + 1,
    auth_flow: {
      ...flow,
      revision,
      session_generation: null,
      session_cookie_present: false,
      unresolved_transition_id: null,
      blocked_transition_ids: boundedUnique(
        flow.blocked_transition_ids,
        input.transitionId,
      ),
    },
  });
  resetGeneration = generation;
  return { flow_id: flow.flow_id, revision };
}

export function resetMockAuthFlow(input: {
  flowId: string;
  expectedRevision: string;
  expectedSessionGeneration?: string | null;
}) {
  const state = readState();
  const flow = state.auth_flow;
  if (
    flow.flow_id !== input.flowId ||
    flow.revision !== input.expectedRevision ||
    (input.expectedSessionGeneration !== undefined &&
      input.expectedSessionGeneration !== flow.session_generation) ||
    (!flow.recovery_cookie_present && !flow.session_cookie_present)
  )
    throw authFlowConflict();
  const revision = nextFlowRevision(flow);
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    principal_id: null,
    principal_session: null,
    generation,
    observation_generation:
      state.principal_id === null
        ? state.observation_generation
        : state.observation_generation >= Number.MAX_SAFE_INTEGER
          ? 0
          : state.observation_generation + 1,
    auth_flow: {
      ...flow,
      revision,
      session_generation: null,
      session_cookie_present: false,
      recovery_ready: false,
      recovery_cookie_generation: "0",
      recovery_cookie_present: false,
      pending_transition: null,
      transitions: [],
      blocked_transition_ids: [],
      unresolved_transition_id: null,
      restart_eligible: true,
      gate_open: false,
    },
  });
  resetGeneration = generation;
  window.dispatchEvent(new Event(MOCK_AUTH_STATE_EVENT));
  return { restart_eligible: true };
}

export function setMockPrincipal(
  principalId: string | null,
  expectedGeneration?: number,
  session?: MockPrincipalSession,
  options: { transitionId?: string; sessionCookiePresent?: boolean } = {},
): void {
  const state = readState();
  const nextSession =
    principalId === null
      ? null
      : (session ?? initialPrincipalSession(principalId));
  if (
    expectedGeneration !== undefined &&
    state.generation !== expectedGeneration
  )
    throw new DOMException("Mock state changed", "AbortError");
  if (
    principalId !== null &&
    !getMockAccounts(state, true).some(
      (account) => account.id === principalId && account.approved,
    )
  )
    throw new TypeError("Unsupported mock member");
  if (principalId !== null && !nextSession)
    throw new TypeError("A mock session is required for a principal");
  const pending = state.auth_flow.pending_transition;
  if (
    options.transitionId !== undefined &&
    pending?.transition_id !== options.transitionId
  )
    throw new DOMException("Mock auth transition changed", "AbortError");
  if (state.principal_id === principalId && options.transitionId === undefined)
    return;
  const generation = nextGeneration(state.generation);
  const inTransition = options.transitionId !== undefined;
  const principalChanged = state.principal_id !== principalId;
  const revision = inTransition
    ? state.auth_flow.revision
    : nextFlowRevision(state.auth_flow);
  const sessionGeneration = principalId
    ? (BigInt(state.auth_flow.issued_session_generation) + 1n).toString()
    : null;
  writeState({
    ...state,
    principal_id: principalId,
    principal_session: nextSession,
    generation,
    observation_generation:
      principalChanged && !inTransition
        ? state.observation_generation >= Number.MAX_SAFE_INTEGER
          ? 0
          : state.observation_generation + 1
        : state.observation_generation,
    auth_flow: {
      ...state.auth_flow,
      revision,
      session_generation: sessionGeneration,
      last_identity_change_revision: inTransition
        ? state.auth_flow.last_identity_change_revision
        : revision,
      issued_session_generation:
        sessionGeneration ?? state.auth_flow.issued_session_generation,
      session_cookie_present:
        principalId !== null && (options.sessionCookiePresent ?? true),
    },
  });
  resetGeneration = generation;
}

export function completeMockPasswordChange(input: {
  accountId: string;
  password: string;
  expectedGeneration: number;
  transitionId?: string;
  sessionCookiePresent?: boolean;
}): void {
  // ponytail: one localStorage principal only; the production API owns cross-device credential/session rotation.
  const state = readState();
  if (state.generation !== input.expectedGeneration)
    throw new DOMException("Mock state changed", "AbortError");
  if (
    input.transitionId !== undefined &&
    state.auth_flow.pending_transition?.transition_id !== input.transitionId
  )
    throw new DOMException("Mock auth transition changed", "AbortError");
  const session = state.principal_session;
  const account = getMockAccounts(state, true).find(
    (item) => item.id === input.accountId,
  );
  if (
    state.principal_id !== input.accountId ||
    !account?.mustChangePassword ||
    session?.session_kind !== "change_only"
  )
    throw new ServiceError(
      "SESSION_KIND_NOT_ALLOWED",
      "임시 비밀번호 로그인 상태에서만 변경할 수 있어요.",
      { httpStatus: 403, outcome: "rejected" },
    );
  const now = Date.parse(state.mock_now);
  if (
    now >= Date.parse(session.expires_at) ||
    !account.temporaryPasswordExpiresAt ||
    now >= Date.parse(account.temporaryPasswordExpiresAt)
  ) {
    setMockPrincipal(null, state.generation);
    throw new ServiceError(
      "AUTH_REQUIRED",
      "변경 전용 로그인이 만료되었어요. 다시 로그인해 주세요.",
      { httpStatus: 401, outcome: "rejected" },
    );
  }
  const current = state.admin_users.find((item) => item.id === account.id);
  if (!current || current.account_version >= Number.MAX_SAFE_INTEGER)
    throw new ServiceError(
      "SERVICE_UNAVAILABLE",
      "비밀번호를 변경할 수 없어요.",
      { httpStatus: 503 },
    );

  const inTransition = input.transitionId !== undefined;
  const revision = inTransition
    ? state.auth_flow.revision
    : nextFlowRevision(state.auth_flow);
  const sessionGeneration = (
    BigInt(state.auth_flow.issued_session_generation) + 1n
  ).toString();
  const recentAuthUntil =
    account.role === "admin"
      ? new Date(now + 15 * 60 * 1000).toISOString()
      : null;
  const generation = nextGeneration(state.generation);
  const override: MockCredentialOverride = {
    account_id: account.id,
    password: input.password,
    must_change_password: false,
    temporary_password_expires_at: null,
  };
  writeState({
    ...state,
    credential_overrides: [
      ...state.credential_overrides.filter(
        (item) => item.account_id !== account.id,
      ),
      override,
    ],
    admin_users: state.admin_users.map((item) =>
      item.id === account.id
        ? { ...item, account_version: item.account_version + 1 }
        : item,
    ),
    principal_session: {
      session_kind: "full",
      expires_at: new Date(now + 8 * 60 * 60 * 1000).toISOString(),
      recent_auth_until: recentAuthUntil,
    },
    generation,
    observation_generation:
      state.observation_generation >= Number.MAX_SAFE_INTEGER
        ? 0
        : state.observation_generation + 1,
    auth_flow: {
      ...state.auth_flow,
      revision,
      session_generation: sessionGeneration,
      last_identity_change_revision: inTransition
        ? state.auth_flow.last_identity_change_revision
        : revision,
      issued_session_generation: sessionGeneration,
      session_cookie_present: input.sessionCookiePresent ?? true,
    },
  });
  resetGeneration = generation;
}

export function completeMockReauthentication(input: {
  accountId: string;
  expectedGeneration: number;
  transitionId: string;
}): void {
  const state = readState();
  const session = state.principal_session;
  const account = getMockAccounts(state).find(
    (item) => item.id === input.accountId,
  );
  if (
    state.generation !== input.expectedGeneration ||
    state.auth_flow.pending_transition?.transition_id !== input.transitionId ||
    state.principal_id !== input.accountId ||
    !session ||
    session.session_kind !== "full" ||
    !account
  )
    throw new DOMException("Mock auth transition changed", "AbortError");
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    generation,
    principal_session: {
      ...session,
      recent_auth_until:
        account.role === "admin"
          ? new Date(Date.parse(state.mock_now) + 15 * 60 * 1000).toISOString()
          : null,
    },
  });
  resetGeneration = generation;
}

export function addMockRegisteredAccount(account: MockRegisteredAccount): void {
  const state = readState();
  if (
    state.registered_accounts.some(
      (item) =>
        item.id === account.id ||
        item.loginId.toLowerCase() === account.loginId.toLowerCase(),
    ) ||
    MOCK_ACCOUNTS.some(
      (item) =>
        item.id === account.id ||
        item.loginId.toLowerCase() === account.loginId.toLowerCase(),
    )
  )
    throw storageError();
  const generation = nextGeneration(state.generation);
  writeState({
    ...state,
    registered_accounts: [...state.registered_accounts, account],
    admin_users: [
      ...state.admin_users,
      ...initialAdminUsers([account]).slice(MOCK_ACCOUNTS.length),
    ],
    generation,
  });
  resetGeneration = generation;
}

export function assertCurrentGeneration(
  generation: number,
  signal?: AbortSignal,
): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Request aborted", "AbortError");
  const current = readState().generation;
  if (current !== generation || resetGeneration > generation)
    throw new DOMException("Mock state reset", "AbortError");
}
