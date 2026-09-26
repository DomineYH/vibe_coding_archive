import catalog from "../../../../contracts/catalog.json";
import publicApps from "../../fixtures/public-apps.json";
import privateApps from "../../fixtures/private-apps.json";
import {
  mapAppDetailResponse,
  mapRegisteredUser,
} from "../../contracts/mappers";
import { ServiceError } from "../service-error";
import { DEMO_ACCOUNTS } from "./accounts";

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
const STATE_KEYS = [...V3_STATE_KEYS, "auth_flow", "observation_generation"];
const AUTH_FLOW_KEYS = [
  "flow_id",
  "revision",
  "session_generation",
  "last_identity_change_revision",
  "issued_session_generation",
];
const MOCK_FLOW_ID = "00000000-0000-4000-8000-000000000200";
const LEGACY_STATE_KEYS = ["version", "generation", "scenario", "apps"];
const REGISTERED_ACCOUNT_KEYS = [
  "id",
  "loginId",
  "password",
  "nickname",
  "pendingExpiresAt",
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
type MockState = {
  version: 4;
  generation: number;
  observation_generation: number;
  scenario: MockScenario;
  apps: typeof publicApps;
  private_apps: typeof privateApps;
  principal_id: string | null;
  registered_accounts: MockRegisteredAccount[];
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
      !DEMO_ACCOUNTS.some((account) => account.id === item.ownerId)
    )
      throw storageError();
  }
}

function validateRegisteredAccounts(accounts: unknown[]): void {
  const ids = new Set<string>(DEMO_ACCOUNTS.map((account) => account.id));
  const loginIds = new Set<string>(
    DEMO_ACCOUNTS.map((account) => account.loginId.toLowerCase()),
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

function nextGeneration(currentGeneration: number): number {
  const current = Math.max(currentGeneration, resetGeneration);
  return current >= Number.MAX_SAFE_INTEGER ? 0 : current + 1;
}

const initialState = (): MockState => ({
  version: 4,
  generation: resetGeneration,
  observation_generation: 0,
  scenario: "original",
  apps: publicApps,
  private_apps: privateApps,
  principal_id: null,
  registered_accounts: [],
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
  if (hasExactKeys(value, LEGACY_STATE_KEYS) && value.version === 1) {
    state = {
      ...value,
      version: 4,
      private_apps: privateApps,
      principal_id: null,
      registered_accounts: [],
      observation_generation: 0,
      auth_flow: initialState().auth_flow,
    };
    needsMigration = true;
  } else if (hasExactKeys(value, V2_STATE_KEYS) && value.version === 2) {
    state = {
      ...value,
      version: 4,
      registered_accounts: [],
      observation_generation: 0,
      auth_flow: initialState().auth_flow,
    };
    needsMigration = true;
  } else if (hasExactKeys(value, V3_STATE_KEYS) && value.version === 3) {
    state = {
      ...value,
      version: 4,
      observation_generation: 0,
      auth_flow: initialState().auth_flow,
    };
    needsMigration = true;
  } else if (hasExactKeys(value, STATE_KEYS)) {
    state = value;
  } else {
    throw storageError();
  }
  if (
    state.version !== 4 ||
    typeof state.generation !== "number" ||
    !Number.isSafeInteger(state.generation) ||
    state.generation < 0 ||
    !isMockScenario(state.scenario) ||
    !Array.isArray(state.apps) ||
    !Array.isArray(state.private_apps) ||
    !Array.isArray(state.registered_accounts) ||
    typeof state.observation_generation !== "number" ||
    !Number.isSafeInteger(state.observation_generation) ||
    state.observation_generation < 0 ||
    !hasExactKeys(state.auth_flow, AUTH_FLOW_KEYS) ||
    (state.principal_id !== null && typeof state.principal_id !== "string")
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
  try {
    validateRegisteredAccounts(state.registered_accounts);
    validateApps(state.apps, true);
    validateApps(state.private_apps, false);
  } catch {
    throw storageError();
  }
  const ids = new Set(state.apps.map((app) => app.id));
  if (state.private_apps.some((app) => ids.has(app.id))) throw storageError();
  if (
    state.principal_id !== null &&
    !DEMO_ACCOUNTS.some((account) => account.id === state.principal_id) &&
    !state.registered_accounts.some(
      (account) => account.id === state.principal_id,
    )
  )
    throw storageError();
  const validState = state as unknown as MockState;
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
): void {
  const state = readState();
  if (
    expectedGeneration !== undefined &&
    state.generation !== expectedGeneration
  )
    throw new DOMException("Mock state changed", "AbortError");
  if (
    principalId !== null &&
    !DEMO_ACCOUNTS.some((account) => account.id === principalId) &&
    !state.registered_accounts.some((account) => account.id === principalId)
  )
    throw new TypeError("Unsupported mock member");
  if (state.principal_id === principalId) return;
  const generation = nextGeneration(state.generation);
  const revision = (BigInt(state.auth_flow.revision) + 1n).toString();
  const sessionGeneration = principalId
    ? (BigInt(state.auth_flow.issued_session_generation) + 1n).toString()
    : null;
  writeState({
    ...state,
    principal_id: principalId,
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

export function addMockRegisteredAccount(account: MockRegisteredAccount): void {
  const state = readState();
  if (
    state.registered_accounts.some(
      (item) =>
        item.id === account.id ||
        item.loginId.toLowerCase() === account.loginId.toLowerCase(),
    ) ||
    DEMO_ACCOUNTS.some(
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
