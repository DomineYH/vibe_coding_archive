import { afterEach, describe, expect, it, vi } from "vitest";
import { adminService } from "../src/services/api/admin";

vi.mock("../src/services/api/auth", () => ({
  authService: {
    getCurrentAuthState: vi.fn().mockResolvedValue({
      user: {
        id: "00000000-0000-4000-8000-000000000100",
        role: "admin",
        approved: true,
      },
      flow: {
        flowId: "00000000-0000-4000-8000-000000000200",
        revision: "4",
        sessionGeneration: "2",
      },
    }),
    getCsrf: vi.fn().mockResolvedValue({
      csrfToken: "csrf-test-token",
      authContext: {
        flowId: "00000000-0000-4000-8000-000000000200",
        revision: "4",
        sessionGeneration: "2",
      },
    }),
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function adminResponse(body: BodyInit | null, init: ResponseInit) {
  return new Response(body, {
    ...init,
    headers: {
      "X-EduVibe-Flow-Id": "00000000-0000-4000-8000-000000000200",
      "X-EduVibe-Auth-Revision": "4",
      "X-EduVibe-Session-Generation": "2",
      ...init.headers,
    },
  });
}

const target = {
  id: "00000000-0000-4000-8000-000000000107",
  login_id: "new-teacher-1",
  nickname: "새 교사",
  role: "user",
  approved: false,
  account_version: 1,
  app_count: 3,
  created_at: "2026-09-22T00:12:00.000Z",
  first_approved_at: null,
  pending_expires_at: "2026-12-21T00:12:00.000Z",
};

const operation = {
  key: "00000000-0000-4000-8000-000000000201",
  kind: "user_approval",
  target_id: target.id,
  issued_at: "2026-09-22T00:12:00.000Z",
  expires_at: "2026-09-23T00:12:00.000Z",
  state: "unresolved",
  applied_account_version: null,
  applied_approved: null,
  finalized_at: null,
  rejection_code: null,
  server_time: "2026-09-22T00:12:00.000Z",
};
const resetOperation = {
  key: "00000000-0000-4000-8000-000000000202",
  kind: "user_password_reset",
  target_id: target.id,
  issued_at: "2026-09-22T00:12:00.000Z",
  expires_at: "2026-09-23T00:12:00.000Z",
  state: "unresolved",
  applied_account_version: null,
  temporary_password_expires_at: null,
  finalized_at: null,
  rejection_code: null,
  server_time: "2026-09-22T00:12:00.000Z",
};
const userDeleteOperation = {
  key: "00000000-0000-4000-8000-000000000203",
  kind: "user_delete",
  target_id: target.id,
  issued_at: "2026-09-22T00:12:00.000Z",
  expires_at: "2026-09-23T00:12:00.000Z",
  state: "unresolved",
  db_applied_at: null,
  finalized_at: null,
  rejection_code: null,
  server_time: "2026-09-22T00:12:00.000Z",
};
const monitorApp = {
  id: "00000000-0000-4000-8000-000000000091",
  owner: {
    id: "00000000-0000-4000-8000-000000000101",
    nickname: "교사김코딩",
  },
  name: "과학 수행평가 루브릭 채점기",
  url: "https://rubric-grader.vercel.app",
  is_public: false,
  theme_id: "niagara",
  version: 2,
  url_version: 1,
  created_at: "2026-06-05T00:00:00.000Z",
  health: {
    state: "healthy",
    checked_at: "2026-09-22T00:12:00.000Z",
    fresh_until: "2026-09-22T00:27:00.000Z",
  },
};

describe("admin API service", () => {
  it("sends list reads with offset paging and current flow metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminResponse(
          JSON.stringify({
            items: [target],
            pagination: { limit: 24, offset: 0, total: 1, has_more: false },
            stats: {
              total_users: 1,
              pending_users: 1,
              total_apps: 0,
              healthy_apps: 0,
              next_health_expiry_at: null,
              active_health_batch_id: null,
              latest_health_batch_id: null,
            },
            server_time: "2026-09-22T00:12:00.000Z",
          }),
          { status: 200 },
        ),
      ),
    );
    const page = await adminService.listUsers();
    expect(page.items[0].accountVersion).toBe(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/v1/admin/users?limit=24&offset=0");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("X-EduVibe-Auth-Revision")).toBe("4");
    expect(new Headers(init?.headers).get("X-EduVibe-Session-Generation")).toBe(
      "2",
    );
  });

  it("reads the dedicated minimal administrator app page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminResponse(
          JSON.stringify({
            items: [monitorApp],
            pagination: { limit: 50, offset: 100, total: 120, has_more: true },
            server_time: "2026-09-22T00:12:00.000Z",
          }),
          { status: 200 },
        ),
      ),
    );
    const page = await adminService.listApps({ limit: 50, offset: 100 });
    expect(page.items[0]).toMatchObject({
      id: monitorApp.id,
      owner: "교사김코딩",
      isPublic: false,
      url: monitorApp.url,
    });
    expect(page.items[0]).not.toHaveProperty("prompt");
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/v1/admin/apps?limit=50&offset=100");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("X-EduVibe-Auth-Revision")).toBe("4");
    expect(new Headers(init?.headers).get("X-EduVibe-Session-Generation")).toBe(
      "2",
    );
  });

  it("issues a CSRF-bound explicit approval request with its idempotency key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          adminResponse(JSON.stringify(operation), { status: 201 }),
        )
        .mockResolvedValueOnce(
          adminResponse(
            JSON.stringify({ ...target, approved: true, account_version: 2 }),
            { status: 200 },
          ),
        ),
    );
    const issued = await adminService.createApprovalOperation({
      targetId: target.id,
      expectedAccountVersion: 1,
      approved: true,
    });
    expect(issued.state).toBe("unresolved");
    const applied = await adminService.setApproval(
      target.id,
      true,
      1,
      issued.key,
    );
    expect(applied).toMatchObject({ approved: true, accountVersion: 2 });
    const [, keyRequest] = vi.mocked(fetch).mock.calls;
    const [, createInit] = vi.mocked(fetch).mock.calls[0];
    expect(JSON.parse(String(createInit?.body))).toEqual({
      kind: "user_approval",
      target_id: target.id,
      expected_account_version: 1,
      approved: true,
    });
    expect(new Headers(keyRequest[1]?.headers).get("Idempotency-Key")).toBe(
      issued.key,
    );
    expect(new Headers(keyRequest[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-test-token",
    );
  });

  it("issues and executes a version-bound password reset without echoing its input", async () => {
    const password = "A temporary Cafe\u0301 passphrase";
    const normalizedPassword = password.normalize("NFC");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          adminResponse(JSON.stringify(resetOperation), { status: 201 }),
        )
        .mockResolvedValueOnce(adminResponse(null, { status: 204 }))
        .mockResolvedValueOnce(
          adminResponse(
            JSON.stringify({
              ...resetOperation,
              state: "succeeded",
              applied_account_version: 2,
              temporary_password_expires_at: "2026-09-23T00:12:03.000Z",
              finalized_at: "2026-09-22T00:12:03.000Z",
              server_time: "2026-09-22T00:12:03.000Z",
            }),
            { status: 200 },
          ),
        ),
    );

    const issued = await adminService.createPasswordResetOperation({
      targetId: target.id,
      expectedAccountVersion: target.account_version,
      newPassword: password,
    });
    await adminService.setPasswordReset(
      target.id,
      password,
      target.account_version,
      issued.key,
    );
    const result = await adminService.getPasswordResetOperation(issued.key);
    expect(result).toMatchObject({
      state: "succeeded",
      appliedAccountVersion: 2,
      temporaryPasswordExpiresAt: "2026-09-23T00:12:03.000Z",
    });
    expect(JSON.stringify(result)).not.toContain(normalizedPassword);

    const calls = vi.mocked(fetch).mock.calls;
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      kind: "user_password_reset",
      target_id: target.id,
      expected_account_version: target.account_version,
      new_password: normalizedPassword,
    });
    expect(calls[0][0]).toBe("/api/v1/write-operations");
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({
      new_password: normalizedPassword,
      expected_account_version: target.account_version,
    });
    expect(calls[1][0]).toBe(`/api/v1/admin/users/${target.id}/password-reset`);
    expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key")).toBe(
      issued.key,
    );
    expect(new Headers(calls[1][1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-test-token",
    );
    expect(calls).toHaveLength(3);
  });

  it("issues an app-count-bound account deletion and reads its keyed result", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          adminResponse(JSON.stringify(userDeleteOperation), { status: 201 }),
        )
        .mockResolvedValueOnce(adminResponse(null, { status: 204 }))
        .mockResolvedValueOnce(
          adminResponse(
            JSON.stringify({
              ...userDeleteOperation,
              state: "succeeded",
              db_applied_at: "2026-09-22T00:12:03.000Z",
              finalized_at: "2026-09-22T00:12:04.000Z",
              server_time: "2026-09-22T00:12:04.000Z",
            }),
            { status: 200 },
          ),
        ),
    );
    const issued = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.app_count,
    });
    await adminService.deleteUser(target.id, target.app_count, issued.key);
    expect(await adminService.getUserDeleteOperation(issued.key)).toMatchObject(
      {
        state: "succeeded",
        targetId: target.id,
      },
    );

    const calls = vi.mocked(fetch).mock.calls;
    expect(JSON.parse(String(calls[0][1]?.body))).toEqual({
      kind: "user_delete",
      target_id: target.id,
      expected_app_count: target.app_count,
    });
    expect(calls[1][0]).toBe(`/api/v1/admin/users/${target.id}`);
    expect(JSON.parse(String(calls[1][1]?.body))).toEqual({
      expected_app_count: target.app_count,
    });
    expect(new Headers(calls[1][1]?.headers).get("Idempotency-Key")).toBe(
      issued.key,
    );
    expect(new Headers(calls[1][1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-test-token",
    );
    expect(calls[2][0]).toBe(`/api/v1/write-operations/${issued.key}`);
  });

  it("keeps a committed account deletion pending when confirmation returns 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminResponse(
          JSON.stringify({
            error: {
              code: "DELETION_CONFIRMATION_PENDING",
              message: "Deletion confirmation is pending",
              request_id: null,
            },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(
      adminService.deleteUser(
        target.id,
        target.app_count,
        userDeleteOperation.key,
      ),
    ).rejects.toMatchObject({
      code: "DELETION_CONFIRMATION_PENDING",
      httpStatus: 503,
      outcome: "unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a lost password-reset response unknown and never retries it", async () => {
    const fetch = vi.fn().mockResolvedValue(
      adminResponse(
        JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Retry later",
            request_id: null,
          },
        }),
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      adminService.setPasswordReset(
        target.id,
        "A temporary passphrase 2026",
        1,
        resetOperation.key,
      ),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports a lost write response as unknown and never retries it", async () => {
    const fetch = vi.fn().mockResolvedValue(
      adminResponse(
        JSON.stringify({
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "Retry later",
            request_id: null,
          },
        }),
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      adminService.setApproval(target.id, true, 1, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps a malformed successful approval response unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(adminResponse(JSON.stringify({}), { status: 200 })),
    );
    await expect(
      adminService.setApproval(target.id, true, 1, operation.key),
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
  });

  it("rejects undocumented status and error-code combinations as unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminResponse(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "wrong status",
              request_id: null,
            },
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(
      adminService.setApproval(target.id, true, 1, operation.key),
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
  });
});

it("refuses an approval write if CSRF was observed in another authentication context", async () => {
  const { authService } = await import("../src/services/api/auth");
  vi.mocked(authService.getCsrf).mockResolvedValueOnce({
    expiresAt: "2026-10-02T00:00:00Z",
    csrfToken: "csrf-test-token",
    authContext: {
      flowId: "00000000-0000-4000-8000-000000000200",
      revision: "5",
      sessionGeneration: "2",
    },
  });
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    adminService.setApproval(target.id, true, 1, operation.key),
  ).rejects.toMatchObject({ code: "AUTH_STATE_CHANGED", outcome: "rejected" });
  expect(fetcher).not.toHaveBeenCalled();
});

it("keeps an approval reply unknown when its authentication metadata belongs to another revision", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        adminResponse(
          JSON.stringify({ ...target, approved: true, account_version: 2 }),
          { status: 200, headers: { "X-EduVibe-Auth-Revision": "5" } },
        ),
      ),
  );
  await expect(
    adminService.setApproval(target.id, true, 1, operation.key),
  ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
});

it("maps reset 413 to PAYLOAD_TOO_LARGE without claiming a contract failure", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      adminResponse(
        JSON.stringify({
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Too large",
            request_id: null,
          },
        }),
        { status: 413 },
      ),
    ),
  );
  await expect(
    adminService.setPasswordReset(
      target.id,
      "A temporary passphrase 2026",
      1,
      resetOperation.key,
    ),
  ).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE", httpStatus: 413 });
});

it.each([
  [404, "USER_NOT_FOUND", "USER_NOT_FOUND"],
  [409, "USER_NOT_FOUND", "CONTRACT_ERROR"],
  [413, "PAYLOAD_TOO_LARGE", "PAYLOAD_TOO_LARGE"],
])(
  "validates deletion status/code parity: %s/%s",
  async (status, code, expected) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        adminResponse(
          JSON.stringify({
            error: { code, message: "safe error", request_id: null },
          }),
          { status },
        ),
      ),
    );
    await expect(
      adminService.deleteUser(
        target.id,
        target.app_count,
        userDeleteOperation.key,
      ),
    ).rejects.toMatchObject({ code: expected });
  },
);
