import { afterEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/api/apps";
import { captureAuthObservation } from "../src/services/auth-state";
import type { CurrentAuthState } from "../src/services/auth-service";
import publicApps from "../src/fixtures/public-apps.json";

const state: CurrentAuthState = {
  user: {
    id: "00000000-0000-4000-8000-000000000100",
    loginId: "member-a",
    nickname: "회원 A",
    role: "user",
    approved: true,
    sessionKind: "full",
    mustChangePassword: false,
    recentAuthUntil: null,
    expiresAt: "2026-10-02T08:00:00Z",
    email: null,
    phone: null,
  },
  flow: {
    flowId: "00000000-0000-4000-8000-000000000200",
    revision: "8",
    sessionGeneration: "3",
    lastIdentityChangeRevision: "6",
  },
  observationGeneration: 2,
  sessionCookiePresent: true,
  status: "ready",
  unresolvedTransitionId: null,
};
const body = {
  item: { ...publicApps[0], is_public: false },
  server_time: "2026-10-02T00:00:00Z",
};
const metadata = {
  "X-EduVibe-Flow-Id": state.flow.flowId,
  "X-EduVibe-Auth-Revision": "8",
  "X-EduVibe-Session-Generation": "3",
  "Cache-Control": "private, no-store",
};
const response = (headers: Record<string, string> = metadata) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json", ...headers },
  });

afterEach(() => vi.unstubAllGlobals());

describe("protected detail captured observation", () => {
  it("sends the captured context without re-observing and bypasses browser cache", async () => {
    const fetch = vi.fn().mockResolvedValue(response());
    vi.stubGlobal("fetch", fetch);
    const app = await appsService.get(publicApps[0].id, {
      readContext: captureAuthObservation(state, () => true),
    });
    expect(app.isPublic).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = fetch.mock.calls[0][1];
    expect(request.headers.get("X-EduVibe-Auth-Revision")).toBe("8");
    expect(request.headers.get("X-EduVibe-Session-Generation")).toBe("3");
    expect(request.cache).toBe("no-store");
  });
  it.each([{}, { ...metadata, "X-EduVibe-Session-Generation": "03" }])(
    "rejects missing/malformed verified metadata %j",
    async (headers) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(headers)));
      await expect(
        appsService.get(publicApps[0].id, {
          readContext: captureAuthObservation(state, () => true),
        }),
      ).rejects.toMatchObject({ code: "CONTRACT_ERROR" });
    },
  );
  it("discards late real-shaped success without replay", async () => {
    let resolve!: (response: Response) => void;
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    let current = true;
    const pending = appsService.get(publicApps[0].id, {
      readContext: captureAuthObservation(state, () => current),
    });
    current = false;
    resolve(response());
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("discards late errors too", async () => {
    let current = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        current = false;
        throw new TypeError("lost response");
      }),
    );
    await expect(
      appsService.get(publicApps[0].id, {
        readContext: captureAuthObservation(state, () => current),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
  it("rejects valid metadata belonging to a later server context without replay", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ ...metadata, "X-EduVibe-Auth-Revision": "9" }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      appsService.get(publicApps[0].id, {
        readContext: captureAuthObservation(state, () => true),
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
