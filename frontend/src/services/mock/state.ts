import catalog from "../../../../contracts/catalog.json";
import publicApps from "../../fixtures/public-apps.json";
import privateApps from "../../fixtures/private-apps.json";
import {
  isDateTime,
  mapAppDetailResponse,
  mapRegisteredUser,
} from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import { MOCK_ACCOUNTS } from "./accounts";

export const MOCK_STORAGE_KEY = "eduvibe-archive-mock-v1";
export const MOCK_RESET_EVENT = "eduvibe:mock-reset";

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
const STATE_KEYS = [
  ...V5_STATE_KEYS,
  "mock_now",
  "credential_overrides",
  "principal_session",
];
const AUTH_FLOW_KEYS = [
  "flow_id",
  "revision",
  "session_generation",
  "last_identity_change_revision",
  "issued_session_generation",
];
const MOCK_FLOW_ID = "00000000-0000-4000-8000-000000000200";
const MOCK_INITIAL_TIME = "2026-09-22T00:12:00.000Z";
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
  version: 6;
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
  auth_flow: {
    flow_id: string;
    revision: string;
    session_generation: string | null;
    last_identity_change_revision: string;
    issued_session_generation: string;
  };
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

const initialState = (): MockState => ({
  version: 6,
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
  auth_flow: {
    flow_id: MOCK_FLOW_ID,
    revision: "0",
    session_generation: null,
    last_identity_change_revision: "0",
    issued_session_generation: "0",
  },
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
      version: 6,
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
      version: 6,
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
      version: 6,
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
      version: 6,
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
      version: 6,
      mock_now: MOCK_INITIAL_TIME,
      credential_overrides: [],
      principal_session: initialPrincipalSession(value.principal_id),
      admin_users: [...previousUsers, ...addedUsers],
    };
    needsMigration = true;
    preserveAdminUsers = true;
  } else if (hasExactKeys(value, STATE_KEYS)) {
    state = value;
  } else {
    throw storageError();
  }
  if (
    state.version !== 6 ||
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
  const validSequence = (value: unknown) =>
    typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value);
  if (
    flow.flow_id !== MOCK_FLOW_ID ||
    !validSequence(flow.revision) ||
    (flow.session_generation !== null &&
      !validSequence(flow.session_generation)) ||
    !validSequence(flow.last_identity_change_revision) ||
    !validSequence(flow.issued_session_generation)
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

export function setMockPrincipal(
  principalId: string | null,
  expectedGeneration?: number,
  session?: MockPrincipalSession,
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
  if (state.principal_id === principalId) return;
  const generation = nextGeneration(state.generation);
  const revision = (BigInt(state.auth_flow.revision) + 1n).toString();
  const sessionGeneration = principalId
    ? (BigInt(state.auth_flow.issued_session_generation) + 1n).toString()
    : null;
  writeState({
    ...state,
    principal_id: principalId,
    principal_session: nextSession,
    generation,
    observation_generation:
      state.observation_generation >= Number.MAX_SAFE_INTEGER
        ? 0
        : state.observation_generation + 1,
    auth_flow: {
      ...state.auth_flow,
      revision,
      session_generation: sessionGeneration,
      last_identity_change_revision: revision,
      issued_session_generation:
        sessionGeneration ?? state.auth_flow.issued_session_generation,
    },
  });
  resetGeneration = generation;
}

export function completeMockPasswordChange(input: {
  accountId: string;
  password: string;
  expectedGeneration: number;
}): void {
  // ponytail: one localStorage principal only; the production API owns cross-device credential/session rotation.
  const state = readState();
  if (state.generation !== input.expectedGeneration)
    throw new DOMException("Mock state changed", "AbortError");
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

  const revision = (BigInt(state.auth_flow.revision) + 1n).toString();
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
      last_identity_change_revision: revision,
      issued_session_generation: sessionGeneration,
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
