import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appsService } from "../src/services/mock/apps";
import { MOCK_STORAGE_KEY, resetMockState } from "../src/services/mock/state";

type StoredObject = Record<string, unknown>;
type StoredState = StoredObject & { apps: StoredObject[] };
type MutateStoredState = (state: StoredState) => void;

function firstApp(state: StoredState): StoredObject {
  return state.apps[0];
}

function nested(value: unknown): StoredObject {
  return value as StoredObject;
}

function owner(state: StoredState): StoredObject {
  return nested(firstApp(state).owner);
}

function health(state: StoredState): StoredObject {
  return nested(firstApp(state).health);
}

function healthResult(state: StoredState): StoredObject {
  return nested(health(state).result);
}

function validJob(): StoredObject {
  return {
    id: "00000000-0000-4000-8000-000000000901",
    status: "queued",
    created_at: "2026-09-22T00:12:00.000Z",
    started_at: null,
    finished_at: null,
    failure_code: null,
  };
}

function job(state: StoredState): StoredObject {
  health(state).latest_job = validJob();
  return nested(health(state).latest_job);
}

const invalidStoredStates: [string, MutateStoredState][] = [
  ["missing state version", (state) => delete state.version],
  ["unsupported state version", (state) => (state.version = 2)],
  ["extra state field", (state) => (state.extra = true)],
  ["missing generation", (state) => delete state.generation],
  ["string generation", (state) => (state.generation = "1")],
  ["negative generation", (state) => (state.generation = -1)],
  ["fractional generation", (state) => (state.generation = 1.5)],
  [
    "unsafe generation",
    (state) => (state.generation = Number.MAX_SAFE_INTEGER + 1),
  ],
  ["unknown scenario", (state) => (state.scenario = "unsupported")],
  ["wrong-shaped scenario", (state) => (state.scenario = ["empty"])],
  ["missing scenario", (state) => delete state.scenario],
  ["non-array apps", (state) => (state.apps = {} as StoredObject[])],
  ["missing apps", (state) => delete (state as StoredObject).apps],
  [
    "app record is not an object",
    (state) => (state.apps[0] = null as unknown as StoredObject),
  ],
  ["missing app field", (state) => delete firstApp(state).updated_at],
  ["extra app field", (state) => (firstApp(state).extra = true)],
  ["invalid app id", (state) => (firstApp(state).id = "app-1")],
  ["duplicate app id", (state) => (state.apps[1].id = firstApp(state).id)],
  ["owner is absent", (state) => (firstApp(state).owner = null)],
  ["extra owner field", (state) => (owner(state).extra = true)],
  ["invalid owner id", (state) => (owner(state).id = "owner-1")],
  ["missing owner nickname", (state) => delete owner(state).nickname],
  ["empty owner nickname", (state) => (owner(state).nickname = "  ")],
  [
    "inconsistent owner nickname reference",
    (state) => {
      nested(state.apps[1].owner).nickname = "Different nickname";
    },
  ],
  [
    "duplicate latest job id",
    (state) => {
      const firstJob = job(state);
      nested(state.apps[1].health).latest_job = { ...firstJob };
    },
  ],
  ["empty app name", (state) => (firstApp(state).name = "  ")],
  [
    "unknown subject reference",
    (state) => (firstApp(state).subject = "unknown"),
  ],
  ["grades is not an array", (state) => (firstApp(state).grades = "초3")],
  ["unknown grade reference", (state) => (firstApp(state).grades = ["초99"])],
  [
    "duplicate grade reference",
    (state) => (firstApp(state).grades = ["초3", "초3"]),
  ],
  ["non-string grade", (state) => (firstApp(state).grades = [42])],
  ["non-boolean visibility", (state) => (firstApp(state).is_public = "true")],
  [
    "non-public app in public state",
    (state) => (firstApp(state).is_public = false),
  ],
  [
    "unknown theme reference",
    (state) => (firstApp(state).theme_id = "unknown"),
  ],
  [
    "invalid app hidden by empty scenario",
    (state) => {
      state.scenario = "empty";
      firstApp(state).theme_id = "unknown";
    },
  ],
  ["invalid app version", (state) => (firstApp(state).version = 0)],
  ["invalid URL version", (state) => (firstApp(state).url_version = 0)],
  ["health is absent", (state) => (firstApp(state).health = null)],
  ["extra health field", (state) => (health(state).extra = true)],
  ["missing next check time", (state) => delete health(state).next_check_at],
  ["health result is absent", (state) => delete health(state).result],
  ["missing freshness time", (state) => delete healthResult(state).fresh_until],
  ["extra health result field", (state) => (healthResult(state).extra = true)],
  ["unknown health state", (state) => (healthResult(state).state = "up")],
  ["invalid checked time", (state) => (healthResult(state).checked_at = "now")],
  [
    "invalid freshness time",
    (state) => (healthResult(state).fresh_until = "now"),
  ],
  ["latest job has missing fields", (state) => (health(state).latest_job = {})],
  ["invalid latest job status", (state) => (job(state).status = "waiting")],
  ["invalid latest job id", (state) => (job(state).id = "job-1")],
  ["invalid job created time", (state) => (job(state).created_at = "now")],
  ["invalid job started time", (state) => (job(state).started_at = "now")],
  ["invalid job finished time", (state) => (job(state).finished_at = "now")],
  ["invalid job failure code", (state) => (job(state).failure_code = 42)],
  ["missing latest job field", (state) => delete job(state).failure_code],
  ["extra latest job field", (state) => (job(state).extra = true)],
  ["invalid next check time", (state) => (health(state).next_check_at = "now")],
  [
    "invalid URL scheme",
    (state) => (firstApp(state).url = "javascript:alert(1)"),
  ],
  ["non-string prompt", (state) => (firstApp(state).prompt = 42)],
  ["non-string description", (state) => (firstApp(state).description = 42)],
  ["invalid database stack", (state) => (firstApp(state).stack_db = 42)],
  ["invalid backend stack", (state) => (firstApp(state).stack_backend = 42)],
  ["invalid frontend stack", (state) => (firstApp(state).stack_frontend = 42)],
  ["invalid hosting stack", (state) => (firstApp(state).stack_hosting = 42)],
  ["invalid created time", (state) => (firstApp(state).created_at = "now")],
  ["invalid updated time", (state) => (firstApp(state).updated_at = "now")],
];

describe("persisted mock state validation", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it.each(invalidStoredStates)(
    "reports %s as damaged and recovers only after explicit reset",
    async (_name, mutate) => {
      resetMockState();
      const state = JSON.parse(
        localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
      ) as StoredState;
      mutate(state);
      const damaged = JSON.stringify(state);
      localStorage.setItem(MOCK_STORAGE_KEY, damaged);

      await expect(appsService.list()).rejects.toMatchObject({
        code: "MOCK_STORAGE_ERROR",
      });
      expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBe(damaged);

      resetMockState();
      expect((await appsService.list()).items).toHaveLength(16);
    },
  );
});
