import { afterEach, describe, expect, it, vi } from "vitest";
import { recheckReturnDestination } from "../src/features/auth/return-destination";
import { appsService } from "../src/services/api/apps";
import type { CurrentAuthState } from "../src/services/auth-service";
import publicApps from "../src/fixtures/public-apps.json";
import privateApps from "../src/fixtures/private-apps.json";
import catalog from "../../contracts/catalog.json";

const current: CurrentAuthState = {
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
const capabilityKeys = [
  "apps_read",
  "auth_register",
  "auth_login",
  "auth_logout",
  "auth_password_change",
  "admin_users_read",
  "admin_approval",
  "admin_summary",
  "apps_create",
  "apps_update_own",
  "apps_delete_own",
  "admin_apps_read",
  "admin_apps_manage",
  "admin_reauth",
  "admin_password_reset",
  "admin_user_delete",
  "health_read",
  "health_check",
  "health_batch",
  "email_collection",
  "phone_collection",
];
function meta(adminEnabled = true) {
  return {
    ...catalog,
    server_time: "2026-10-02T00:00:00Z",
    support: { email: null, service_url: null, announcement_url: null },
    initial_pending_days: 90,
    capabilities: Object.fromEntries(
      capabilityKeys.map((key) => [
        key,
        {
          enabled:
            key === "apps_read" || (key === "admin_users_read" && adminEnabled),
          reasons:
            key === "apps_read" || (key === "admin_users_read" && adminEnabled)
              ? []
              : ["not_implemented"],
        },
      ]),
    ),
  };
}
function stubMeta(enabled = true) {
  const fetch = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(meta(enabled))));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("return destination current availability and authority", () => {
  it("permits a public gallery destination without an auth observation", async () => {
    const fetch = stubMeta();
    await expect(
      recheckReturnDestination(
        "/?subject=%EC%88%98%ED%95%99",
        null,
        appsService,
        () => true,
      ),
    ).resolves.toBe("/?subject=%EC%88%98%ED%95%99");
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
  });
  it.each(["", "/edit"])(
    "permits an independently public app destination %j even when the member observation becomes stale",
    async (suffix) => {
      const fetch = stubMeta();
      fetch
        .mockResolvedValueOnce(new Response(JSON.stringify(meta())))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              item: publicApps[0],
              server_time: "2026-10-02T00:00:00Z",
            }),
          ),
        );
      await expect(
        recheckReturnDestination(
          `/apps/${publicApps[0].id}${suffix}`,
          current,
          appsService,
          () => false,
        ),
      ).resolves.toBe(`/apps/${publicApps[0].id}${suffix}`);
      expect(fetch.mock.calls[1][0]).toBe(`/api/v1/apps/${publicApps[0].id}`);
      expect(fetch.mock.calls[1][1].headers.has("X-EduVibe-Flow-Id")).toBe(
        false,
      );
    },
  );
  it("rejects admin for a full ordinary member before navigation", async () => {
    stubMeta();
    await expect(
      recheckReturnDestination("/admin", current, appsService, () => true),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("does not treat capability false or failed metadata as permission", async () => {
    const admin = {
      ...current,
      user: { ...current.user!, role: "admin" as const },
    };
    stubMeta(false);
    await expect(
      recheckReturnDestination("/admin", admin, appsService, () => true),
    ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(
      recheckReturnDestination("/admin", admin, appsService, () => true),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
  it.each(["", "/edit"])(
    "does not swallow failed app authorization for destination %j",
    async (suffix) => {
      const fetch = stubMeta();
      fetch.mockImplementation(
        async (url) =>
          new Response(
            JSON.stringify(
              url === "/api/v1/meta"
                ? meta()
                : {
                    error: {
                      code: "NOT_FOUND",
                      message: "자료 없음",
                      request_id: null,
                    },
                  },
            ),
            { status: url === "/api/v1/meta" ? 200 : 404 },
          ),
      );
      await expect(
        recheckReturnDestination(
          `/apps/00000000-0000-4000-8000-000000000003${suffix}`,
          current,
          appsService,
          () => true,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(fetch).toHaveBeenCalledTimes(3);
    },
  );
  it.each(["owner", "admin", "other member"])(
    "rechecks private edit readability for the %s",
    async (reader) => {
      const app = privateApps[0];
      const member = {
        ...current,
        user: {
          ...current.user!,
          id: reader === "owner" ? app.owner.id : current.user!.id,
          role: reader === "admin" ? ("admin" as const) : ("user" as const),
        },
      };
      const fetch = stubMeta();
      fetch
        .mockResolvedValueOnce(new Response(JSON.stringify(meta())))
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "NOT_FOUND",
                message: "자료 없음",
                request_id: null,
              },
            }),
            { status: 404 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              item: app,
              server_time: "2026-10-02T00:00:00Z",
            }),
            {
              headers: {
                "X-EduVibe-Flow-Id": current.flow.flowId,
                "X-EduVibe-Auth-Revision": current.flow.revision,
                "X-EduVibe-Session-Generation": current.flow.sessionGeneration!,
                "Cache-Control": "private, no-store",
              },
            },
          ),
        );
      const destination = `/apps/${app.id}/edit`;
      const result = recheckReturnDestination(
        destination,
        member,
        appsService,
        () => true,
      );
      if (reader === "other member")
        await expect(result).rejects.toMatchObject({ code: "NOT_FOUND" });
      else await expect(result).resolves.toBe(destination);
      expect(fetch.mock.calls.slice(1).map(([url]) => url)).toEqual([
        `/api/v1/apps/${app.id}`,
        `/api/v1/apps/${app.id}`,
      ]);
    },
  );
  it("retains strict parsing and rejects stale completion", async () => {
    for (const destination of [
      "//external.test",
      "/admin?tab=users",
      "/apps/not-a-uuid",
      "/admin#secret",
      "/%2fexternal.test",
      "/apps/00000000-0000-4000-8000-000000000001/edit?x=1",
      "/apps/not-uuid/edit",
      "/apps/00000000-0000-4000-8000-000000000001/edit/extra",
    ])
      await expect(
        recheckReturnDestination(destination, current, appsService, () => true),
      ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    stubMeta();
    await expect(
      recheckReturnDestination(
        "/admin",
        { ...current, user: { ...current.user!, role: "admin" } },
        appsService,
        () => false,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
