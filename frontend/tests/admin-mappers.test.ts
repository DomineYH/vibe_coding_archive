import {
  mapAdminStats,
  mapAdminUser,
  mapAdminUserPage,
  mapApprovalOperation,
} from "../src/contracts/mappers";

const adminUser = {
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

describe("admin contract mappers", () => {
  it("maps approval targets without exposing contact fields", () => {
    expect(mapAdminUser(adminUser)).toEqual({
      id: adminUser.id,
      loginId: adminUser.login_id,
      nickname: adminUser.nickname,
      role: "user",
      approved: false,
      accountVersion: 1,
      createdAt: adminUser.created_at,
      firstApprovedAt: null,
      pendingExpiresAt: adminUser.pending_expires_at,
    });
    expect(() =>
      mapAdminUser({ ...adminUser, email: "private@example.invalid" }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() => mapAdminUser({ ...adminUser, account_version: 0 })).toThrow(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
  });

  it("maps an offset page and full-set dashboard statistics", () => {
    expect(
      mapAdminUserPage({
        items: [adminUser],
        pagination: { limit: 24, offset: 24, total: 50, has_more: true },
        stats: {
          total_users: 50,
          pending_users: 4,
          total_apps: 17,
          healthy_apps: 15,
        },
        server_time: "2026-09-22T00:12:00.000Z",
      }),
    ).toMatchObject({
      items: [{ accountVersion: 1 }],
      pagination: { limit: 24, offset: 24, total: 50, hasMore: true },
    });
    expect(
      mapAdminStats({
        total_users: 25,
        pending_users: 4,
        total_apps: 17,
        healthy_apps: 15,
      }),
    ).toEqual({
      totalUsers: 25,
      pendingUsers: 4,
      totalApps: 17,
      healthyApps: 15,
    });
  });

  it("maps only the minimal approval operation result", () => {
    const result = mapApprovalOperation({
      key: "00000000-0000-4000-8000-000000000201",
      kind: "user_approval",
      target_id: adminUser.id,
      issued_at: "2026-09-22T00:12:00.000Z",
      expires_at: "2026-09-23T00:12:00.000Z",
      state: "succeeded",
      applied_account_version: 2,
      applied_approved: true,
      finalized_at: "2026-09-22T00:12:03.000Z",
      rejection_code: null,
    });
    expect(result).toMatchObject({
      key: "00000000-0000-4000-8000-000000000201",
      state: "succeeded",
      appliedAccountVersion: 2,
      appliedApproved: true,
    });
    expect(() =>
      mapApprovalOperation({
        key: result.key,
        kind: "user_approval",
        target_id: adminUser.id,
        issued_at: "2026-09-22T00:12:00.000Z",
        expires_at: "2026-09-23T00:12:00.000Z",
        state: "succeeded",
        applied_account_version: 2,
        applied_approved: true,
        finalized_at: "2026-09-22T00:12:03.000Z",
        rejection_code: null,
        new_password: "must never be returned",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });
});
