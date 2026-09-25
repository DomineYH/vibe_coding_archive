import publicApps from "../../fixtures/public-apps.json";
import { ServiceError } from "../service-error";

export const MOCK_STORAGE_KEY = "eduvibe-archive-mock-v1";
export const MOCK_RESET_EVENT = "eduvibe:mock-reset";

export type MockScenario = "original" | "empty" | "list_failure";
type MockState = {
  version: 1;
  generation: number;
  scenario: MockScenario;
  apps: typeof publicApps;
};

let resetGeneration = 0;
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
    !Number.isSafeInteger(state.generation) ||
    !["original", "empty", "list_failure"].includes(String(state.scenario)) ||
    !Array.isArray(state.apps)
  ) {
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
  resetGeneration += 1;
  let nextGeneration = resetGeneration;
  try {
    const current = readState();
    nextGeneration = Math.max(current.generation + 1, resetGeneration);
  } catch {
    // An explicit reset is the recovery path for damaged or unsupported saved data.
  }
  resetGeneration = nextGeneration;
  writeState({ ...initialState(), generation: nextGeneration });
  window.dispatchEvent(new Event(MOCK_RESET_EVENT));
}

export function setMockScenario(scenario: MockScenario): void {
  if (!["original", "empty", "list_failure"].includes(scenario))
    throw new TypeError("Unsupported mock scenario");
  const state = readState();
  resetGeneration = Math.max(resetGeneration + 1, state.generation + 1);
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
