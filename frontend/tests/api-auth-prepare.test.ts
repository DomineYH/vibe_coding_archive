import { afterEach, expect, it, vi } from "vitest";
import { authService } from "../src/services/api/auth";

const flowId = "00000000-0000-4000-8000-000000000115";
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

it("maps actual preparation transport without storing credentials", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        flow_id: flowId,
        revision: "0",
        expires_at: "2026-10-01T01:00:00Z",
      }),
      { status: 201 },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await authService.createFlow({ restartFrom: [] })).toEqual({
    flowId,
    revision: "0",
    expiresAt: "2026-10-01T01:00:00Z",
  });
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    restart_from: [],
  });
  expect(fetcher.mock.calls[0][1].credentials).toBe("include");
  expect(fetcher.mock.calls[0][1].keepalive).toBe(false);
  expect(localStorage.getItem("eduvibe-auth-flow-v1")).toBeNull();
});

it("keeps malformed mutation replies unknown and never replays them", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response("{}", { status: 201 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(
    authService.createFlow({ restartFrom: [] }),
  ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects committed anonymous replies whose authentication metadata disagrees", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          flow_id: flowId,
          revision: "1",
          recovery_csrf_token: "test-only",
          expires_at: "2026-10-01T01:00:00Z",
        }),
        { status: 200 },
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          flow_id: flowId,
          revision: "4",
          session_generation: "2",
          csrf_token: "test-only",
          expires_at: "2026-10-01T00:15:00Z",
        }),
        {
          status: 201,
          headers: {
            "X-EduVibe-Flow-Id": flowId,
            "X-EduVibe-Auth-Revision": "3",
            "X-EduVibe-Session-Generation": "2",
          },
        },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  await authService.getRecoveryCsrf(flowId);
  await expect(
    authService.issueAnonymousSession({
      flowId,
      expectedRevision: "3",
      transitionId: `${flowId}.2`,
    }),
  ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
});

it.each([
  [400, "BAD_REQUEST"],
  [413, "PAYLOAD_TOO_LARGE"],
  [401, "RECOVERY_REQUIRED"],
])(
  "preserves the authentication %s/%s error contract",
  async (status, code) => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code, message: "test-only safe error", request_id: null },
        }),
        { status },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    await expect(
      code === "RECOVERY_REQUIRED"
        ? authService.getRecoveryCsrf(flowId)
        : authService.createFlow({ restartFrom: [] }),
    ).rejects.toMatchObject({ code, httpStatus: status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
