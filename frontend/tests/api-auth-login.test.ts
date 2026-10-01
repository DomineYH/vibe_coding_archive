import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { authService } from "../src/services/api/auth";

const flowId = "00000000-0000-4000-8000-000000000116";
const memberId = "00000000-0000-4000-8000-000000000100";
const self = {
  id: memberId,
  login_id: "member-a",
  nickname: "승인 회원",
  role: "user",
  approved: true,
  must_change_password: false,
  session_kind: "full",
  expires_at: "2026-10-01T00:30:00.000000Z",
  email: null,
  phone: null,
  recent_auth_until: null,
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

it("logs in through a login permit and binds every header to that permit", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () => json(flowState()),
    [`GET /auth/csrf`]: () => csrfAt("4", "2"),
    [`POST /auth/transitions`]: () =>
      json(
        {
          flow_id: flowId,
          transition_id: `${flowId}.4`,
          kind: "login",
          revision: "5",
          permit_expires_at: "2026-10-01T00:01:00.000000Z",
        },
        201,
      ),
    [`POST /auth/login`]: () =>
      json({ user: self, csrf_token: "new-csrf" }, 200, context("6", "3")),
  });
  const result = await authService.login({
    loginId: "member-a",
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
    kind: "login",
    expected_revision: "4",
    expected_session_generation: "2",
  });
  expect(admit.headers.get("X-CSRF-Token")).toBe("s-csrf");
  const login = calls.find((call) => call.path === "/auth/login")!;
  expect(login.body).toEqual({
    login_id: "member-a",
    password: "synthetic password",
  });
  expect(Object.fromEntries(login.headers)).toMatchObject({
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
  ["ACCOUNT_NOT_APPROVED", 403],
  ["TEMP_PASSWORD_EXPIRED", 403],
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
            kind: "login",
            revision: "5",
            permit_expires_at: "2026-10-01T00:01:00.000000Z",
          },
          201,
        ),
      [`POST /auth/login`]: () => failure(code, status),
    });
    await expect(
      authService.login({ loginId: "member-a", password: "x" }),
    ).rejects.toMatchObject({ code, httpStatus: status, outcome: "rejected" });
  },
);

it("keeps a lost or malformed login reply unknown and never replays it", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () => json(flowState()),
    [`GET /auth/csrf`]: () => csrfAt("4", "2"),
    [`POST /auth/transitions`]: () =>
      json(
        {
          flow_id: flowId,
          transition_id: `${flowId}.4`,
          kind: "login",
          revision: "5",
          permit_expires_at: "2026-10-01T00:01:00.000000Z",
        },
        201,
      ),
    [`POST /auth/login`]: () =>
      json({ user: self, csrf_token: "c" }, 200, context("6", "2")),
  });
  // The reply claims the old generation: the new S was not demonstrably received.
  await expect(
    authService.login({ loginId: "member-a", password: "x" }),
  ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
  expect(calls.filter((call) => call.path === "/auth/login")).toHaveLength(1);
  expect(
    JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")!),
  ).toMatchObject({
    transitionId: `${flowId}.4`,
    progress: "executing",
  });
});

it("refuses to start a login without a prepared anonymous session", async () => {
  serve({
    [`GET /auth/flow-state`]: () =>
      json(
        flowState({ session_generation: null, session_cookie_present: false }),
      ),
  });
  await expect(
    authService.login({ loginId: "member-a", password: "x" }),
  ).rejects.toMatchObject({ code: "AUTH_STATE_CHANGED" });
});

it("logs out through a logout permit and treats 204 as the only success", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () =>
      json(
        flowState({
          revision: "6",
          session_generation: "3",
          next_transition_id: `${flowId}.6`,
        }),
      ),
    [`GET /auth/csrf`]: () => csrfAt("6", "3", "member-csrf"),
    [`POST /auth/transitions`]: () =>
      json(
        {
          flow_id: flowId,
          transition_id: `${flowId}.6`,
          kind: "logout",
          revision: "7",
          permit_expires_at: "2026-10-01T00:01:00.000000Z",
        },
        201,
      ),
    [`POST /auth/logout`]: () => new Response(null, { status: 204 }),
  });
  await expect(authService.logout()).resolves.toBeUndefined();
  const logout = calls.find((call) => call.path === "/auth/logout")!;
  expect(Object.fromEntries(logout.headers)).toMatchObject({
    "x-csrf-token": "member-csrf",
    "x-eduvibe-auth-revision": "7",
    "x-eduvibe-session-generation": "3",
    "x-eduvibe-transition-id": `${flowId}.6`,
  });
});

it("logs out with Origin alone when the flow has no session", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () =>
      json(
        flowState({ session_generation: null, session_cookie_present: false }),
      ),
    [`POST /auth/logout`]: () => new Response(null, { status: 204 }),
  });
  await authService.logout();
  expect(calls.map((call) => call.path)).toEqual([
    "/auth/flow-state",
    "/auth/logout",
  ]);
  expect(calls[1].headers.get("X-EduVibe-Transition-Id")).toBeNull();
});

it("restores the member from the server on observation, never from the login reply", async () => {
  const calls = serve({
    [`GET /auth/flow-state`]: () =>
      json(
        flowState({
          revision: "6",
          session_generation: "3",
          next_transition_id: `${flowId}.6`,
        }),
      ),
    [`GET /auth/recovery-context`]: () => json({ items: [] }),
    [`GET /auth/flows/${flowId}/recovery-csrf`]: () =>
      json({
        flow_id: flowId,
        revision: "6",
        recovery_csrf_token: "r-csrf",
        expires_at: "2026-10-01T00:30:00.000000Z",
      }),
    [`GET /auth/csrf`]: () => csrfAt("6", "3"),
    [`GET /auth/me`]: () => json(self, 200, context("6", "3")),
  });
  const observed = await authService.getCurrentAuthState();
  expect(observed.status).toBe("ready");
  expect(observed.user).toMatchObject({ id: memberId, nickname: "승인 회원" });
  const me = calls.find((call) => call.path === "/auth/me")!;
  expect(me.headers.get("X-EduVibe-Auth-Revision")).toBe("6");
  expect(me.headers.get("X-EduVibe-Session-Generation")).toBe("3");
});

it("treats an anonymous session as no member", async () => {
  serve({
    [`GET /auth/flow-state`]: () => json(flowState({ revision: "4" })),
    [`GET /auth/flows/${flowId}/recovery-csrf`]: () =>
      json({
        flow_id: flowId,
        revision: "4",
        recovery_csrf_token: "r-csrf",
        expires_at: "2026-10-01T00:30:00.000000Z",
      }),
    [`GET /auth/csrf`]: () => csrfAt("4", "2"),
    [`GET /auth/me`]: () => failure("AUTH_REQUIRED", 401),
  });
  const observed = await authService.getCurrentAuthState();
  expect(observed).toMatchObject({ status: "ready", user: null });
});

it("rejects a me reply whose flow context disagrees with the request", async () => {
  serve({
    [`GET /auth/csrf`]: () => csrfAt("6", "3"),
    [`GET /auth/me`]: () => json(self, 200, context("6", "9")),
  });
  await expect(authService.getMe()).rejects.toMatchObject({
    code: "CONTRACT_ERROR",
  });
});

it("clears the stored transition ID when admission is definitively refused", async () => {
  serve({
    [`GET /auth/flow-state`]: () => json(flowState()),
    [`GET /auth/csrf`]: () => csrfAt("4", "2"),
    [`POST /auth/transitions`]: () => failure("ALREADY_AUTHENTICATED", 409),
  });
  await expect(
    authService.login({ loginId: "member-a", password: "x" }),
  ).rejects.toMatchObject({
    code: "ALREADY_AUTHENTICATED",
    outcome: "rejected",
  });
  expect(JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")!)).toEqual({
    flowId,
    revision: "4",
  });
});
