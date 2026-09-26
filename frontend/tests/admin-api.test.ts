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
    getCsrf: vi.fn().mockResolvedValue({ csrfToken: "csrf-test-token" }),
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const target = {
  id: "00000000-0000-4000-8000-000000000107",
  login_id: "new-teacher-1",
  nickname: "새 교사",
  role: "user",
  approved: false,
  account_version: 1,
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
};

describe("admin API service", () => {
  it("sends list reads with offset paging and current flow metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [target],
            pagination: { limit: 24, offset: 0, total: 1, has_more: false },
            stats: {
              total_users: 1,
              pending_users: 1,
              total_apps: 0,
              healthy_apps: 0,
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

  it("issues a CSRF-bound explicit approval request with its idempotency key", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(operation), { status: 201 }),
        )
        .mockResolvedValueOnce(
          new Response(
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

  it("reports a lost write response as unknown and never retries it", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
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
        .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(
      adminService.setApproval(target.id, true, 1, operation.key),
    ).rejects.toMatchObject({ code: "CONTRACT_ERROR", outcome: "unknown" });
  });

  it("rejects undocumented status and error-code combinations as unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
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
