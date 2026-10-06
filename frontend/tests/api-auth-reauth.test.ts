import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authService } from "../src/services/api/auth";

const flowId = "00000000-0000-4000-8000-000000000116";
const memberId = "00000000-0000-4000-8000-000000000100";
const self = {
  id: memberId,
  login_id: "member-a",
  nickname: "승인 회원",
  role: "admin",
  approved: true,
  must_change_password: false,
  session_kind: "full",
  expires_at: "2026-10-01T00:30:00.000000Z",
  email: null,
  phone: null,
  recent_auth_until: "2026-10-01T00:15:00.000000Z",
};

type Call = { method: string; path: string; headers: Headers; body?: unknown };
type Reply = (call: Call) => Response;

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
function failure(code: string, status: number) {
  return json(
    { error: { code, message: "test-only", request_id: null } },
    status,
  );
}
function context(revision: string, generation: string) {
  return {
    "X-EduVibe-Flow-Id": flowId,
    "X-EduVibe-Auth-Revision": revision,
    "X-EduVibe-Session-Generation": generation,
  };
}
function serve(routes: Record<string, Reply>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace("/api/v1", "").split("?")[0];
      const call = {
        method: init.method ?? "GET",
        path,
        headers: new Headers(init.headers),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const route = routes[`${call.method} ${path}`];
      if (!route) throw new Error(`unrouted ${call.method} ${path}`);
      return route(call);
    }),
  );
  return calls;
}
const flowState = (over: object = {}) => ({
  flow_id: flowId,
  revision: "4",
  server_time: "2026-10-01T00:00:00.000000Z",
  expires_at: "2026-10-01T00:30:00.000000Z",
  recovery_ready: true,
  session_generation: "2",
  session_cookie_present: true,
  last_identity_change_revision: "0",
  pending_transition: null,
  requested_transition: null,
  next_transition_id: `${flowId}.4`,
  ...over,
});
const csrfAt = (revision: string, generation: string, token = "s-csrf") =>
  json(
    { csrf_token: token, expires_at: "2026-10-01T00:30:00.000000Z" },
    200,
    context(revision, generation),
  );

beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    locks: { request: (_n: string, _o: unknown, run: () => unknown) => run() },
  });
  localStorage.setItem(
    "eduvibe-auth-flow-v1",
    JSON.stringify({ flowId, revision: "4" }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("reauthenticates through a permit and binds every header to that permit", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () => json(flowState()),
    [`GET /auth/csrf`]: () => csrfAt("4", "2"),
    [`POST /auth/transitions`]: () =>
      json(
        {
          flow_id: flowId,
          transition_id: `${flowId}.4`,
          kind: "reauthenticate",
          revision: "5",
          permit_expires_at: "2026-10-01T00:01:00.000000Z",
        },
        201,
      ),
    [`POST /auth/reauth`]: () =>
      json({ user: self, csrf_token: "new-csrf" }, 200, context("6", "3")),
  });
  const result = await authService.reauthenticate({
    password: "synthetic password",
  });
  expect(result.user).toMatchObject({
    id: memberId,
    nickname: "승인 회원",
    sessionKind: "full",
  });
  expect(result.csrfToken).toBe("new-csrf");
  const admit = calls.find((call) => call.path === "/auth/transitions")!;
  expect(admit.body).toEqual({
    flow_id: flowId,
    transition_id: `${flowId}.4`,
    kind: "reauthenticate",
    expected_revision: "4",
    expected_session_generation: "2",
  });
  expect(admit.headers.get("X-CSRF-Token")).toBe("s-csrf");
  const reauth = calls.find((call) => call.path === "/auth/reauth")!;
  expect(reauth.body).toEqual({
    password: "synthetic password",
  });
  expect(Object.fromEntries(reauth.headers)).toMatchObject({
    "x-csrf-token": "s-csrf",
    "x-eduvibe-flow-id": flowId,
    "x-eduvibe-auth-revision": "5",
    "x-eduvibe-session-generation": "2",
    "x-eduvibe-transition-id": `${flowId}.4`,
  });
  expect(localStorage.getItem("eduvibe-auth-flow-v1")).not.toMatch(
    /password|csrf/i,
  );
});

it.each([
  ["INVALID_CREDENTIALS", 401],
  ["FORBIDDEN", 403],
  ["PASSWORD_CHANGE_REQUIRED", 403],
  ["ALREADY_AUTHENTICATED", 409],
  ["RATE_LIMITED", 429],
])(
  "keeps a definitive %s answer as a rejection, not an unknown result",
  async (code, status) => {
    serve({
      [`GET /auth/flow-state`]: () => json(flowState()),
      [`GET /auth/csrf`]: () => csrfAt("4", "2"),
      [`POST /auth/transitions`]: () =>
        json(
          {
            flow_id: flowId,
            transition_id: `${flowId}.4`,
            kind: "reauthenticate",
            revision: "5",
            permit_expires_at: "2026-10-01T00:01:00.000000Z",
          },
          201,
        ),
      [`POST /auth/reauth`]: () => failure(code, status),
    });
    await expect(
      authService.reauthenticate({ password: "x" }),
    ).rejects.toMatchObject({ code, httpStatus: status, outcome: "rejected" });
  },
);

it("keeps a lost or malformed reauthentication reply unknown and never replays it", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () => json(flowState()),
    [`GET /auth/csrf`]: () => csrfAt("4", "2"),
    [`POST /auth/transitions`]: () =>
      json(
        {
          flow_id: flowId,
          transition_id: `${flowId}.4`,
          kind: "reauthenticate",
          revision: "5",
          permit_expires_at: "2026-10-01T00:01:00.000000Z",
        },
        201,
      ),
    [`POST /auth/reauth`]: () =>
      json({ user: self, csrf_token: "c" }, 200, context("6", "2")),
  });
  // The reply claims the old generation: the new S was not demonstrably received.
  await expect(
    authService.reauthenticate({ password: "x" }),
  ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
  expect(calls.filter((call) => call.path === "/auth/reauth")).toHaveLength(1);
  expect(
    JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")!),
  ).toMatchObject({
    transitionId: `${flowId}.4`,
    progress: "executing",
  });
});

it("refuses to start reauthentication without a current session", async () => {
  serve({
    [`GET /auth/flow-state`]: () =>
      json(
        flowState({ session_generation: null, session_cookie_present: false }),
      ),
  });
  await expect(
    authService.reauthenticate({ password: "x" }),
  ).rejects.toMatchObject({ code: "AUTH_STATE_CHANGED" });
});
