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
] as const;
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
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw storageError();
  const state = value as Partial<MockState>;
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
    for (const app of state.apps) {
      mapAppDetailResponse({
        item: app,
        server_time: "2026-09-22T00:12:00.000Z",
      });
    }
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
  resetGeneration = next;
  writeState({ ...initialState(), generation: next });
  window.dispatchEvent(new Event(MOCK_RESET_EVENT));
}

export function setMockScenario(scenario: MockScenario): void {
  if (!isMockScenario(scenario))
    throw new TypeError("Unsupported mock scenario");
  const state = readState();
  resetGeneration = nextGeneration(state.generation);
  writeState({ ...state, scenario, generation: resetGeneration });
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
