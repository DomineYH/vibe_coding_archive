import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function meta(adminEnabled = true, appsEnabled = true) {
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
            (key === "apps_read" && appsEnabled) ||
            (key === "admin_users_read" && adminEnabled),
          reasons:
            (key === "apps_read" && appsEnabled) ||
            (key === "admin_users_read" && adminEnabled)
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
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  it.each([true, false])(
    "returns a full ordinary member to the gallery with admin capability %s",
    async (adminEnabled) => {
      stubMeta(adminEnabled);
      await expect(
        recheckReturnDestination("/admin", current, appsService, () => true),
      ).resolves.toBe("/");
    },
  );
  it("returns an administrator to admin", async () => {
    stubMeta();
    await expect(
      recheckReturnDestination(
        "/admin",
        { ...current, user: { ...current.user!, role: "admin" } },
        appsService,
        () => true,
      ),
    ).resolves.toBe("/admin");
  });
  it("rejects unavailable gallery and failed metadata for the member fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(meta(true, false)))),
    );
    await expect(
      recheckReturnDestination("/admin", current, appsService, () => true),
    ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(
      recheckReturnDestination("/admin", current, appsService, () => true),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
  it("rejects a member observation changed while metadata is pending", async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    let fresh = true;
    const result = recheckReturnDestination(
      "/admin",
      current,
      appsService,
      () => fresh,
    );
    const rejected = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    fresh = false;
    release(new Response(JSON.stringify(meta())));
    await rejected;
  });
  it.each([
    ["null", null],
    ["anonymous", { ...current, user: null }],
    ...["checking", "unresolved", "error"].map(
      (status) => [status, { ...current, status }] as const,
    ),
    ["unapproved", { ...current, user: { ...current.user!, approved: false } }],
    [
      "change_only",
      { ...current, user: { ...current.user!, sessionKind: "change_only" } },
    ],
    [
      "mustChangePassword",
      { ...current, user: { ...current.user!, mustChangePassword: true } },
    ],
  ] as const)(
    "does not promote %s authentication to a member fallback",
    async (_, state) => {
      stubMeta();
      await expect(
        recheckReturnDestination(
          "/admin",
          state as CurrentAuthState | null,
          appsService,
          () => true,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    },
  );
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

describe("exact create return destination", () => {
  let get: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    get = vi.spyOn(appsService, "get");
  });
  afterEach(() => expect(get).not.toHaveBeenCalled());
  function createMeta(read = true, create = true) {
    const value = meta(true, read);
    value.capabilities.apps_create = {
      enabled: create,
      reasons: create ? [] : ["not_implemented"],
    };
    return value;
  }

  it.each(["user", "admin"] as const)(
    "permits an approved full %s without reading an app",
    async (role) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(createMeta())));
      vi.stubGlobal("fetch", fetch);
      await expect(
        recheckReturnDestination(
          "/apps/new",
          { ...current, user: { ...current.user!, role } },
          appsService,
          () => true,
        ),
      ).resolves.toBe("/apps/new");
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
    },
  );

  it.each([
    ["null", null],
    ["anonymous", { ...current, user: null }],
    ...(["checking", "unresolved", "error", "unavailable"] as const).map(
      (status) => [status, { ...current, status }] as const,
    ),
    ["unapproved", { ...current, user: { ...current.user!, approved: false } }],
    [
      "change_only",
      {
        ...current,
        user: { ...current.user!, sessionKind: "change_only" as const },
      },
    ],
    [
      "password change required",
      { ...current, user: { ...current.user!, mustChangePassword: true } },
    ],
    [
      "unsupported role",
      { ...current, user: { ...current.user!, role: "guest" } },
    ],
  ] as const)("refuses %s without reading an app", async (_name, state) => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(createMeta())));
    vi.stubGlobal("fetch", fetch);
    await expect(
      recheckReturnDestination(
        "/apps/new",
        state as CurrentAuthState | null,
        appsService,
        () => true,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
  });

  it.each(["apps_read", "apps_create"])(
    "refuses disabled %s without reading an app",
    async (capability) => {
      const fetch = vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              createMeta(
                capability !== "apps_read",
                capability !== "apps_create",
              ),
            ),
          ),
        );
      vi.stubGlobal("fetch", fetch);
      await expect(
        recheckReturnDestination("/apps/new", current, appsService, () => true),
      ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
    },
  );

  it("preserves metadata errors without reading an app", async () => {
    const error = new Error("metadata failed");
    const fetch = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetch);
    await expect(
      recheckReturnDestination("/apps/new", current, appsService, () => true),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
  });

  it("refuses an observation changed during metadata loading without reading an app", async () => {
    let release!: (response: Response) => void;
    let fresh = true;
    const fetch = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = recheckReturnDestination(
      "/apps/new",
      current,
      appsService,
      () => fresh,
    );
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
    });
    fresh = false;
    release?.(new Response(JSON.stringify(createMeta())));
    await rejection;
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
  });
});
