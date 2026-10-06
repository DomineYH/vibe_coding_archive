import {
  mapAdminAppPage,
  mapAdminStats,
  mapAdminUser,
  mapAdminUserPage,
  mapApprovalOperation,
  mapPasswordResetOperation,
  mapUserDeleteOperation,
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
  app_count: 3,
};

const adminApp = {
  id: "00000000-0000-4000-8000-000000000001",
  owner: {
    id: "00000000-0000-4000-8000-000000000101",
    nickname: "교사김코딩",
  },
  name: "분수 피자 가게",
  url: "https://fraction-pizza.vercel.app",
  is_public: true,
  theme_id: "sage",
  version: 2,
  url_version: 1,
  created_at: "2026-04-01T15:00:00.000Z",
  health: {
    state: "healthy",
    checked_at: "2026-09-22T00:12:00.000Z",
    fresh_until: "2026-09-22T00:27:00.000Z",
  },
};
const adminPrivateApp = {
  ...adminApp,
  id: "00000000-0000-4000-8000-000000000091",
  name: "과학 수행평가 루브릭 채점기",
  url: "https://rubric-grader.vercel.app",
  is_public: false,
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
      appCount: 3,
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
          next_health_expiry_at: "2026-09-22T00:27:00.000Z",
          active_health_batch_id: null,
          latest_health_batch_id: null,
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
        next_health_expiry_at: "2026-09-22T00:27:00.000Z",
        active_health_batch_id: null,
        latest_health_batch_id: null,
      }),
    ).toEqual({
      totalUsers: 25,
      pendingUsers: 4,
      totalApps: 17,
      healthyApps: 15,
      nextHealthExpiryAt: "2026-09-22T00:27:00.000Z",
      activeHealthBatchId: null,
      latestHealthBatchId: null,
    });
  });

  it("rejects malformed active or latest batch IDs and health expiry times", () => {
    const base = {
      total_users: 1,
      pending_users: 0,
      total_apps: 1,
      healthy_apps: 1,
      next_health_expiry_at: "2026-09-22T00:27:00.000Z",
      active_health_batch_id: null,
      latest_health_batch_id: null,
    };
    expect(() =>
      mapAdminStats({ ...base, active_health_batch_id: "batch-1" }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() =>
      mapAdminStats({ ...base, latest_health_batch_id: "batch-1" }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() =>
      mapAdminStats({ ...base, next_health_expiry_at: "soon" }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("maps the minimal public and private app monitor page", () => {
    expect(
      mapAdminAppPage({
        items: [adminApp, adminPrivateApp],
        pagination: { limit: 24, offset: 0, total: 25, has_more: true },
        server_time: "2026-09-22T00:12:00.000Z",
      }),
    ).toEqual({
      items: [
        {
          id: adminApp.id,
          ownerId: adminApp.owner.id,
          owner: adminApp.owner.nickname,
          name: adminApp.name,
          url: adminApp.url,
          isPublic: true,
          themeId: "sage",
          version: 2,
          urlVersion: 1,
          createdAt: adminApp.created_at,
          health: {
            state: "healthy",
            checked_at: "2026-09-22T00:12:00.000Z",
            fresh_until: "2026-09-22T00:27:00.000Z",
          },
        },
        {
          id: adminPrivateApp.id,
          ownerId: adminPrivateApp.owner.id,
          owner: adminPrivateApp.owner.nickname,
          name: adminPrivateApp.name,
          url: adminPrivateApp.url,
          isPublic: false,
          themeId: "sage",
          version: 2,
          urlVersion: 1,
          createdAt: adminPrivateApp.created_at,
          health: {
            state: "healthy",
            checked_at: "2026-09-22T00:12:00.000Z",
            fresh_until: "2026-09-22T00:27:00.000Z",
          },
        },
      ],
      pagination: { limit: 24, offset: 0, total: 25, hasMore: true },
      serverTime: "2026-09-22T00:12:00.000Z",
    });
    expect(() =>
      mapAdminAppPage({
        items: [{ ...adminApp, prompt: "must never be returned" }],
        pagination: { limit: 24, offset: 0, total: 1, has_more: false },
        server_time: "2026-09-22T00:12:00.000Z",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() =>
      mapAdminAppPage({
        items: [
          { ...adminApp, owner: { ...adminApp.owner, phone: "+1234567" } },
        ],
        pagination: { limit: 24, offset: 0, total: 1, has_more: false },
        server_time: "2026-09-22T00:12:00.000Z",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    expect(() =>
      mapAdminAppPage({
        items: [{ ...adminApp, url: "javascript:alert(1)" }],
        pagination: { limit: 24, offset: 0, total: 1, has_more: false },
        server_time: "2026-09-22T00:12:00.000Z",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
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
      server_time: "2026-09-22T00:12:03.000Z",
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
        server_time: "2026-09-22T00:12:03.000Z",
        new_password: "must never be returned",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("maps a password reset result without exposing the temporary password", () => {
    const result = mapPasswordResetOperation({
      key: "00000000-0000-4000-8000-000000000201",
      kind: "user_password_reset",
      target_id: adminUser.id,
      issued_at: "2026-09-22T00:12:00.000Z",
      expires_at: "2026-09-23T00:12:00.000Z",
      state: "succeeded",
      applied_account_version: 2,
      temporary_password_expires_at: "2026-09-23T00:12:03.000Z",
      finalized_at: "2026-09-22T00:12:03.000Z",
      rejection_code: null,
      server_time: "2026-09-22T00:12:03.000Z",
    });
    expect(result).toEqual({
      key: "00000000-0000-4000-8000-000000000201",
      kind: "user_password_reset",
      targetId: adminUser.id,
      issuedAt: "2026-09-22T00:12:00.000Z",
      expiresAt: "2026-09-23T00:12:00.000Z",
      state: "succeeded",
      appliedAccountVersion: 2,
      temporaryPasswordExpiresAt: "2026-09-23T00:12:03.000Z",
      finalizedAt: "2026-09-22T00:12:03.000Z",
      rejectionCode: null,
      serverTime: "2026-09-22T00:12:03.000Z",
    });
    expect(() =>
      mapPasswordResetOperation({
        key: result.key,
        kind: result.kind,
        target_id: result.targetId,
        issued_at: result.issuedAt,
        expires_at: result.expiresAt,
        state: "unresolved",
        applied_account_version: null,
        temporary_password_expires_at: null,
        finalized_at: null,
        rejection_code: null,
        server_time: result.serverTime,
        new_password: "must never be returned",
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("keeps deleted data pending until the deletion record is confirmed", () => {
    const result = mapUserDeleteOperation({
      key: "00000000-0000-4000-8000-000000000202",
      kind: "user_delete",
      target_id: adminUser.id,
      issued_at: "2026-09-22T00:12:00.000Z",
      expires_at: "2026-09-23T00:12:00.000Z",
      state: "confirming_deletion",
      db_applied_at: "2026-09-22T00:12:03.000Z",
      finalized_at: null,
      rejection_code: null,
      server_time: "2026-09-22T00:12:03.000Z",
    });
    expect(result).toEqual({
      key: "00000000-0000-4000-8000-000000000202",
      kind: "user_delete",
      targetId: adminUser.id,
      issuedAt: "2026-09-22T00:12:00.000Z",
      expiresAt: "2026-09-23T00:12:00.000Z",
      state: "confirming_deletion",
      dbAppliedAt: "2026-09-22T00:12:03.000Z",
      finalizedAt: null,
      rejectionCode: null,
      serverTime: "2026-09-22T00:12:03.000Z",
    });
    expect(() =>
      mapUserDeleteOperation({
        key: result.key,
        kind: result.kind,
        target_id: result.targetId,
        issued_at: result.issuedAt,
        expires_at: result.expiresAt,
        state: "succeeded",
        db_applied_at: null,
        finalized_at: null,
        rejection_code: null,
        server_time: result.serverTime,
        target: adminUser,
      }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });
});

it.each([
  "reset_key_id",
  "reset_request_hmac",
  "new_password",
  "input",
  "user",
])("rejects secret or historical DTO field %s in reset results", (field) => {
  expect(() =>
    mapPasswordResetOperation({
      key: "00000000-0000-4000-8000-000000000201",
      kind: "user_password_reset",
      target_id: adminUser.id,
      issued_at: "2026-09-22T00:12:00.000Z",
      expires_at: "2026-09-23T00:12:00.000Z",
      state: "unresolved",
      applied_account_version: null,
      temporary_password_expires_at: null,
      finalized_at: null,
      rejection_code: null,
      server_time: "2026-09-22T00:12:00.000Z",
      [field]: "forbidden",
    }),
  ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
});
