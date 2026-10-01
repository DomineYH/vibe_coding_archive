import { afterEach, expect, it, vi } from "vitest";
import { authService } from "../src/services/api/auth";

const flowId = "00000000-0000-4000-8000-000000000118";
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("registers with current anonymous S headers, without sending confirmation or admitting a transition", async () => {
  localStorage.setItem(
    "eduvibe-auth-flow-v1",
    JSON.stringify({ flowId, revision: "4" }),
  );
  const writes: { body: unknown; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith("/csrf"))
        return new Response(
          JSON.stringify({
            csrf_token: "fixture-csrf",
            expires_at: "2026-10-01T00:15:00Z",
          }),
          {
            headers: {
              "X-EduVibe-Flow-Id": flowId,
              "X-EduVibe-Auth-Revision": "4",
              "X-EduVibe-Session-Generation": "2",
            },
          },
        );
      expect(url).toBe("/api/v1/auth/register");
      writes.push({
        body: JSON.parse(String(init.body)),
        headers: new Headers(init.headers),
      });
      return new Response(
        JSON.stringify({
          id: flowId,
          login_id: "teacher",
          nickname: "교사",
          approved: false,
          pending_expires_at: "2026-12-30T00:00:00Z",
        }),
        { status: 201 },
      );
    }),
  );
  const result = await authService.register({
    loginId: "teacher",
    password: "synthetic password 1234",
    nickname: "교사",
    email: "",
    phone: "",
  });
  expect(result).toMatchObject({
    loginId: "teacher",
    approved: false,
    pendingExpiresAt: "2026-12-30T00:00:00Z",
  });
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toEqual({
    login_id: "teacher",
    password: "synthetic password 1234",
    nickname: "교사",
    email: "",
    phone: "",
  });
  expect(Object.fromEntries(writes[0].headers)).toMatchObject({
    "x-csrf-token": "fixture-csrf",
    "x-eduvibe-flow-id": flowId,
    "x-eduvibe-auth-revision": "4",
    "x-eduvibe-session-generation": "2",
  });
  expect(writes[0].headers.has("X-EduVibe-Transition-Id")).toBe(false);
});

it("keeps duplicate login ID errors distinct from an uncertain transport outcome", async () => {
  localStorage.setItem(
    "eduvibe-auth-flow-v1",
    JSON.stringify({ flowId, revision: "4" }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/csrf")
        ? new Response(
            JSON.stringify({
              csrf_token: "fixture-csrf",
              expires_at: "2026-10-01T00:15:00Z",
            }),
            {
              headers: {
                "X-EduVibe-Flow-Id": flowId,
                "X-EduVibe-Auth-Revision": "4",
                "X-EduVibe-Session-Generation": "2",
              },
            },
          )
        : new Response(
            JSON.stringify({
              error: {
                code: "LOGIN_ID_TAKEN",
                message: "이미 사용 중인 로그인 아이디입니다.",
                fields: { login_id: "이미 사용 중인 로그인 아이디입니다." },
                request_id: null,
              },
            }),
            { status: 409 },
          ),
    ),
  );
  await expect(
    authService.register({
      loginId: "teacher",
      password: "synthetic password 1234",
      nickname: "교사",
    }),
  ).rejects.toMatchObject({
    code: "LOGIN_ID_TAKEN",
    outcome: "rejected",
    fields: { login_id: "이미 사용 중인 로그인 아이디입니다." },
  });
});
