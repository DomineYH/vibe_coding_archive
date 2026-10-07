import { afterEach, expect, it, vi } from "vitest";
import { healthService } from "../src/services/api/health";

const flow = "00000000-0000-4000-8000-000000000115";
const app = "00000000-0000-4000-8000-000000000001";
const job = "00000000-0000-4000-8000-000000000201";
const stamp = "2026-10-01T00:00:00.000Z";
const expires = "2026-10-01T01:00:00.000Z";

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("prepares a fresh visitor's anonymous flow before sending one CSRF-protected health check", async () => {
  localStorage.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, _options: unknown, run: () => unknown) => run(),
    },
  });
  let anonymous = false;
  const calls: Array<{ path: string; init: RequestInit }> = [];
  const metadata = {
    "X-EduVibe-Flow-Id": flow,
    "X-EduVibe-Auth-Revision": "4",
    "X-EduVibe-Session-Generation": "1",
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (path: string, init: RequestInit) => {
      calls.push({ path, init });
      const endpoint = path.replace("/api/v1", "").split("?")[0];
      if (endpoint === "/auth/recovery-context") return json({ items: [] });
      if (endpoint === "/auth/flows")
        return json({ flow_id: flow, revision: "0", expires_at: expires }, 201);
      if (endpoint === `/auth/flows/${flow}/recovery-cookie`)
        return json(
          {
            flow_id: flow,
            revision: "1",
            recovery_csrf_token: "recovery-test",
            expires_at: expires,
          },
          201,
        );
      if (endpoint === `/auth/flows/${flow}/ready`)
        return json({
          flow_id: flow,
          revision: "2",
          ready: true,
          expires_at: expires,
        });
      if (endpoint === `/auth/flows/${flow}/recovery-csrf`)
        return json({
          flow_id: flow,
          revision: "4",
          recovery_csrf_token: "recovery-test",
          expires_at: expires,
        });
      if (endpoint === "/auth/flow-state")
        return json({
          flow_id: flow,
          revision: anonymous ? "4" : "2",
          server_time: stamp,
          expires_at: expires,
          recovery_ready: true,
          session_generation: anonymous ? "1" : null,
          session_cookie_present: anonymous,
          last_identity_change_revision: "0",
          pending_transition: null,
          requested_transition: null,
          next_transition_id: `${flow}.${anonymous ? 4 : 2}`,
        });
      if (endpoint === "/auth/transitions")
        return json(
          {
            flow_id: flow,
            revision: "3",
            transition_id: `${flow}.2`,
            kind: "anonymous_session",
            permit_expires_at: expires,
          },
          201,
        );
      if (endpoint === "/auth/anonymous-session") {
        anonymous = true;
        return json(
          {
            flow_id: flow,
            revision: "4",
            session_generation: "1",
            csrf_token: "session-test",
            expires_at: expires,
          },
          201,
          metadata,
        );
      }
      if (endpoint === "/auth/csrf")
        return json(
          { csrf_token: "session-test", expires_at: expires },
          200,
          metadata,
        );
      if (endpoint === "/auth/me")
        return json(
          {
            error: {
              code: "AUTH_REQUIRED",
              message: "anonymous",
              request_id: null,
            },
          },
          401,
        );
      if (endpoint === `/apps/${app}/health-checks`)
        return json(
          {
            app_id: app,
            url_version: 1,
            server_time: stamp,
            disposition: "created",
            health: {
              result: {
                state: "unchecked",
                checked_at: null,
                fresh_until: null,
              },
              next_check_at: null,
              latest_job: {
                id: job,
                status: "queued",
                created_at: stamp,
                started_at: null,
                finished_at: null,
                failure_code: null,
              },
            },
          },
          202,
        );
      throw new Error(`Unexpected endpoint ${endpoint}`);
    }),
  );
  await expect(healthService.requestCheck(app)).resolves.toMatchObject({
    disposition: "created",
  });
  const check = calls.filter((call) => call.path.endsWith("/health-checks"));
  expect(check).toHaveLength(1);
  expect(check[0].init).toMatchObject({
    method: "POST",
    credentials: "include",
  });
  expect(Object.fromEntries(new Headers(check[0].init.headers))).toMatchObject({
    "x-eduvibe-flow-id": flow,
    "x-eduvibe-auth-revision": "4",
    "x-eduvibe-session-generation": "1",
    "x-csrf-token": "session-test",
  });
  expect(
    calls.filter((call) => call.path.endsWith("/auth/flows")),
  ).toHaveLength(1);
  expect(
    calls.findIndex((call) => call.path.endsWith("/auth/anonymous-session")),
  ).toBeLessThan(calls.indexOf(check[0]));
  expect(localStorage.getItem("eduvibe-auth-flow-v1")).not.toMatch(
    /csrf|session-test|recovery-test/,
  );
});

it("does not replace a missing local flow when recovery proof still exists", async () => {
  localStorage.clear();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    locks: {
      request: (_name: string, _options: unknown, run: () => unknown) => run(),
    },
  });
  const fetcher = vi.fn().mockResolvedValue(
    json({
      items: [{ flow_id: flow, revision: "4", proof_kind: "recovery" }],
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await expect(healthService.requestCheck(app)).rejects.toMatchObject({
    code: "AUTH_STATE_CHANGED",
  });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0][0]).toBe("/api/v1/auth/recovery-context");
  expect(JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1")!)).toEqual({
    resetTargets: [{ flowId: flow, revision: "4", proofKind: "recovery" }],
  });
});
