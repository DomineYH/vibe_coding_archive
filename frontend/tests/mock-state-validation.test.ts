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

function authFlowV6Shape(value: unknown): StoredObject {
  const flow = nested(value);
  return Object.fromEntries(
    [
      "flow_id",
      "revision",
      "session_generation",
      "last_identity_change_revision",
      "issued_session_generation",
    ].map((key) => [key, flow[key]]),
  );
}

const invalidStoredStates: [string, MutateStoredState][] = [
  ["missing state version", (state) => delete state.version],
  ["unsupported state version", (state) => (state.version = 11)],
  ["invalid mock clock", (state) => (state.mock_now = "not a date")],
  [
    "missing principal session",
    (state) => (state.principal_id = "00000000-0000-4000-8000-000000000101"),
  ],
  ["missing auth flow context", (state) => delete state.auth_flow],
  [
    "invalid auth flow sequence",
    (state) => (nested(state.auth_flow).revision = "01"),
  ],
  [
    "invalid observation generation",
    (state) => (state.observation_generation = -1),
  ],
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
  [
    "non-array deleted account ids",
    (state) => (state.deleted_account_ids = {} as string[]),
  ],
  [
    "invalid deleted account id",
    (state) => (state.deleted_account_ids = ["member-1"]),
  ],
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
  [
    "unknown public app owner",
    (state) => (owner(state).id = "ffffffff-ffff-4fff-8fff-ffffffffffff"),
  ],
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

  it("migrates the existing public mock state to auth-capable storage", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        generation: current.generation,
        scenario: current.scenario,
        apps: current.apps,
      }),
    );

    expect((await appsService.list()).items).toHaveLength(16);
    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      principal_id: null,
      private_apps: [{ id: "00000000-0000-4000-8000-000000000091" }],
      registered_accounts: [],
      admin_users: expect.any(Array),
      approval_operations: [],
      observation_generation: 0,
      health_batches: [],
      health_id_sequence: 0,
    });
  });

  it("migrates the previous auth-capable state and preserves the principal", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    const v2 = { ...current } as Record<string, unknown>;
    delete v2.registered_accounts;
    delete v2.auth_flow;
    delete v2.observation_generation;
    delete v2.admin_users;
    delete v2.approval_operations;
    delete v2.approval_operation_sequence;
    delete v2.mock_now;
    delete v2.credential_overrides;
    delete v2.principal_session;
    delete v2.deleted_account_ids;
    delete v2.health_measurements;
    delete v2.health_batches;
    delete v2.health_id_sequence;
    v2.principal_id = "00000000-0000-4000-8000-000000000101";
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({ ...v2, version: 2 }),
    );

    expect((await appsService.list()).items).toHaveLength(16);
    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      registered_accounts: [],
      principal_id: "00000000-0000-4000-8000-000000000101",
      admin_users: expect.any(Array),
      observation_generation: 0,
    });
  });

  it("migrates registration-capable state to the flow metadata version", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    const previous = { ...current } as Record<string, unknown>;
    delete previous.auth_flow;
    delete previous.observation_generation;
    delete previous.admin_users;
    delete previous.approval_operations;
    delete previous.approval_operation_sequence;
    delete previous.mock_now;
    delete previous.credential_overrides;
    delete previous.principal_session;
    delete previous.deleted_account_ids;
    delete previous.health_measurements;
    delete previous.health_batches;
    delete previous.health_id_sequence;
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({ ...previous, version: 3 }),
    );

    expect((await appsService.list()).items).toHaveLength(16);
    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      observation_generation: 0,
      auth_flow: { revision: "0", last_identity_change_revision: "0" },
      admin_users: expect.any(Array),
    });
  });

  it("migrates version 5 auth state while preserving the admin directory", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    const previous = { ...current } as Record<string, unknown>;
    delete previous.mock_now;
    delete previous.credential_overrides;
    delete previous.principal_session;
    delete previous.deleted_account_ids;
    delete previous.health_measurements;
    delete previous.health_batches;
    delete previous.health_id_sequence;
    previous.auth_flow = authFlowV6Shape(previous.auth_flow);
    previous.version = 5;
    previous.admin_users = (previous.admin_users as StoredObject[]).filter(
      (user) =>
        user.id !== "00000000-0000-4000-8000-000000000900" &&
        user.id !== "00000000-0000-4000-8000-000000000901",
    );
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(previous));

    await appsService.list();

    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      mock_now: "2026-09-22T00:12:00.000Z",
      credential_overrides: [],
      principal_session: null,
      admin_users: expect.arrayContaining([
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000900",
          approved: true,
        }),
        expect.objectContaining({
          id: "00000000-0000-4000-8000-000000000901",
          approved: true,
        }),
      ]),
    });
  });

  it("migrates version 6 auth flow metadata", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    const previous = { ...current } as Record<string, unknown>;
    previous.auth_flow = authFlowV6Shape(previous.auth_flow);
    delete previous.deleted_account_ids;
    delete previous.health_measurements;
    delete previous.health_batches;
    delete previous.health_id_sequence;
    previous.version = 6;
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(previous));

    await appsService.list();

    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      auth_flow: {
        flow_sequence: 0,
        recovery_ready: true,
        recovery_cookie_generation: "1",
        session_cookie_present: false,
        transitions: [],
      },
    });
  });

  it("migrates version 7 state and initializes deleted account tracking", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    const previous = { ...current } as Record<string, unknown>;
    previous.version = 7;
    delete previous.deleted_account_ids;
    delete previous.health_measurements;
    delete previous.health_batches;
    delete previous.health_id_sequence;
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(previous));

    await appsService.list();

    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      deleted_account_ids: [],
      registered_accounts: [],
      admin_users: current.admin_users,
      apps: current.apps,
    });
  });

  it("migrates version 8 state with empty health measurements", async () => {
    resetMockState();
    const current = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as StoredState;
    const previous = { ...current, version: 8 } as Record<string, unknown>;
    delete previous.health_measurements;
    delete previous.health_batches;
    delete previous.health_id_sequence;
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(previous));

    await appsService.list();

    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null"),
    ).toMatchObject({
      version: 10,
      health_measurements: [],
      health_batches: [],
      health_id_sequence: 0,
    });
  });
});
