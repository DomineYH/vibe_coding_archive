import catalog from "../../../../contracts/catalog.json";
import publicApps from "../../fixtures/public-apps.json";
import { mapAppDetailResponse } from "../../contracts/mappers";
import { ServiceError } from "../service-error";

export const MOCK_STORAGE_KEY = "eduvibe-archive-mock-v1";
export const MOCK_RESET_EVENT = "eduvibe:mock-reset";

const MOCK_SCENARIOS = [
  "original",
  "empty",
  "list_failure",
  "list_delayed",
  "long_list",
  "long_copy",
] as const;
const STATE_KEYS = ["version", "generation", "scenario", "apps"];
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
  version: 1;
  generation: number;
  scenario: MockScenario;
  apps: typeof publicApps;
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

function validateApps(apps: unknown[]): void {
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
      !item.isPublic ||
      appIds.has(item.id) ||
      (jobId !== undefined && jobIds.has(jobId)) ||
      (ownerName !== undefined && ownerName !== item.owner)
    )
      throw storageError();

    appIds.add(item.id);
    if (jobId !== undefined) jobIds.add(jobId);
    ownerNames.set(item.ownerId, item.owner);
  }
}

function nextGeneration(currentGeneration: number): number {
  const current = Math.max(currentGeneration, resetGeneration);
  return current >= Number.MAX_SAFE_INTEGER ? 0 : current + 1;
}

const initialState = (): MockState => ({
  version: 1,
  generation: resetGeneration,
  scenario: "original",
  apps: publicApps,
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
  if (!hasExactKeys(value, STATE_KEYS)) throw storageError();
  const state = value;
  if (
    state.version !== 1 ||
    typeof state.generation !== "number" ||
    !Number.isSafeInteger(state.generation) ||
    state.generation < 0 ||
    !isMockScenario(state.scenario) ||
    !Array.isArray(state.apps)
  ) {
    throw storageError();
  }
  try {
    validateApps(state.apps);
  } catch {
    throw storageError();
  }
  return state as MockState;
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
