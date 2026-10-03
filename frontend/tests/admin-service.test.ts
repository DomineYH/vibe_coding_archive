import { beforeEach, describe, expect, it } from "vitest";
import { authService } from "../src/services/mock/auth";
import { appsService } from "../src/services/mock/apps";
import { adminService } from "../src/services/mock/admin";
import {
  getMockAccounts,
  getMockSnapshot,
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockClock,
  setMockScenario,
} from "../src/services/mock/state";

const ADMIN_ID = "00000000-0000-4000-8000-000000000100";
const MEMBER_ID = "00000000-0000-4000-8000-000000000101";
const PENDING_ID = "00000000-0000-4000-8000-000000000102";
const memberAppInput = {
  name: "삭제 경합 확인 앱",
  url: "https://example.org/delete-race",
  prompt: "수업 자료",
  description: "합성 테스트",
  subject: "수학" as const,
  grades: ["초3"] as const,
  isPublic: true,
  themeId: "niagara",
  stack: { db: "", backend: "", frontend: "", hosting: "" },
};

async function loginAdmin() {
  await authService.login({ loginId: "admin", password: "admin123" });
}

async function reauthenticateAdmin() {
  await loginAdmin();
  await authService.reauthenticate({ password: "admin123" });
}

async function registerPendingAccounts(count: number) {
  for (let index = 0; index < count; index += 1) {
    await authService.register({
      loginId: `extra-teacher-${String(index).padStart(2, "0")}`,
      password: "a sufficiently long fake password",
      nickname: `새 회원 ${index}`,
    });
  }
}

beforeEach(() => resetMockState());

describe("admin service", () => {
  it("lists pending users first and reports full-set aggregate statistics", async () => {
    await loginAdmin();
    const page = await adminService.listUsers();
    expect(page.items.slice(0, 2).map((user) => user.nickname)).toEqual([
      "비기너개발자",
      "코딩꿈나무",
    ]);
    expect(page.pagination).toEqual({
      limit: 24,
      offset: 0,
      total: 7,
      hasMore: false,
    });
    expect(page.stats).toEqual({
      totalUsers: 7,
      pendingUsers: 2,
      totalApps: 17,
      healthyApps: 15,
      nextHealthExpiryAt: "2026-09-22T00:27:00.000Z",
      activeHealthBatchId: null,
      latestHealthBatchId: null,
    });
    expect(page.items.find((user) => user.id === ADMIN_ID)).toMatchObject({
      role: "admin",
      accountVersion: 1,
      appCount: 0,
    });
    expect(
      Object.fromEntries(
        page.items.map((user) => [user.nickname, user.appCount]),
      ),
    ).toEqual({
      교사김코딩: 6,
      과학덕후박샘: 4,
      역사수업연구가: 4,
      영어쌤제이: 3,
      비기너개발자: 0,
      코딩꿈나무: 0,
      "아카이브 관리자": 0,
    });
  });

  it("lists minimal public and private app summaries in stable pages", async () => {
    await loginAdmin();
    const first = await adminService.listApps({ limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.pagination).toEqual({
      limit: 2,
      offset: 0,
      total: 17,
      hasMore: true,
    });
    expect(first.items[0].createdAt >= first.items[1].createdAt).toBe(true);
    const second = await adminService.listApps({ limit: 2, offset: 2 });
    expect(second.pagination).toMatchObject({
      offset: 2,
      total: 17,
      hasMore: true,
    });
    expect(
      new Set([...first.items, ...second.items].map((app) => app.id)).size,
    ).toBe(4);
    const all = await adminService.listApps();
    expect(all.items.map((app) => app.id)).toEqual(
      [...all.items]
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .map((app) => app.id),
    );
    const privateApp = all.items.find(
      (app) => app.id === "00000000-0000-4000-8000-000000000091",
    );
    expect(all.items).toHaveLength(17);
    expect(all.pagination).toMatchObject({ limit: 24, total: 17 });
    expect(privateApp).toMatchObject({
      name: "과학 수행평가 루브릭 채점기",
      owner: "교사김코딩",
      isPublic: false,
      url: "https://rubric-grader.vercel.app",
    });
    expect(privateApp).not.toHaveProperty("prompt");
    expect(privateApp).not.toHaveProperty("description");
    expect(privateApp).not.toHaveProperty("owner.loginId");
    await expect(adminService.listApps({ limit: 101 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("keeps empty app results separate from full-set statistics and requires admin", async () => {
    await loginAdmin();
    setMockScenario("admin_apps_empty");
    const empty = await adminService.listApps();
    expect(empty.items).toEqual([]);
    expect(empty.pagination).toMatchObject({ total: 0, hasMore: false });
    expect((await adminService.listUsers()).stats).toMatchObject({
      totalApps: 17,
      healthyApps: 15,
    });

    setMockScenario("admin_apps_list_failure");
    await expect(adminService.listApps()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      httpStatus: 503,
    });
    await authService.logout();
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    await expect(adminService.listApps()).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
  });

  it("paginates at 24 rows while statistics keep counting the whole list", async () => {
    await registerPendingAccounts(18);
    await loginAdmin();
    const first = await adminService.listUsers();
    expect(first.items).toHaveLength(24);
    expect(first.pagination.hasMore).toBe(true);
    expect(first.pagination.total).toBe(25);
    expect(first.stats).toMatchObject({ totalUsers: 25, pendingUsers: 20 });

    setMockScenario("admin_more_failure");
    await expect(
      adminService.listUsers({ limit: 24, offset: 24 }),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      httpStatus: 503,
    });
    setMockScenario("original");
    const second = await adminService.listUsers({ limit: 24, offset: 24 });
    expect(second.items).toHaveLength(1);
    expect(second.pagination).toMatchObject({
      offset: 24,
      total: 25,
      hasMore: false,
    });
  });

  it("requires an approved admin for list and detail reads", async () => {
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    await expect(adminService.listUsers()).rejects.toMatchObject({
      code: "FORBIDDEN",
      httpStatus: 403,
    });
    await expect(adminService.getUser(PENDING_ID)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("issues a version-bound explicit approval and blocks login after revocation", async () => {
    await loginAdmin();
    const target = await adminService.getUser(PENDING_ID);
    const issued = await adminService.createApprovalOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      approved: true,
    });
    expect(issued.state).toBe("unresolved");
    const approved = await adminService.setApproval(
      target.id,
      true,
      target.accountVersion,
      issued.key,
    );
    expect(approved).toMatchObject({ approved: true, accountVersion: 2 });
    expect(await adminService.getApprovalOperation(issued.key)).toMatchObject({
      state: "succeeded",
      appliedApproved: true,
      appliedAccountVersion: 2,
    });

    await authService.logout();
    await authService.login({ loginId: "비기너개발자", password: "1234" });
    await authService.logout();
    await loginAdmin();
    const current = await adminService.getUser(PENDING_ID);
    const revoked = await adminService.createApprovalOperation({
      targetId: current.id,
      expectedAccountVersion: current.accountVersion,
      approved: false,
    });
    await adminService.setApproval(
      current.id,
      false,
      current.accountVersion,
      revoked.key,
    );
    expect(await adminService.getUser(PENDING_ID)).toMatchObject({
      approved: false,
      accountVersion: 3,
    });
    expect(await adminService.getApprovalOperation(issued.key)).toMatchObject({
      state: "succeeded",
      appliedApproved: true,
      appliedAccountVersion: 2,
    });
    await expect(
      adminService.setApproval(PENDING_ID, true, 1, issued.key),
    ).rejects.toMatchObject({ code: "OPERATION_ALREADY_RESOLVED" });
    await authService.logout();
    await expect(
      authService.login({ loginId: "비기너개발자", password: "1234" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_APPROVED", httpStatus: 403 });
  });

  it("rejects protected targets, mismatched keys, and a stale competing version", async () => {
    await loginAdmin();
    await expect(
      adminService.createApprovalOperation({
        targetId: ADMIN_ID,
        expectedAccountVersion: 1,
        approved: false,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_ACCOUNT_PROTECTED",
      httpStatus: 403,
    });
    expect(getMockSnapshot().approval_operations).toHaveLength(0);

    const first = await adminService.createApprovalOperation({
      targetId: PENDING_ID,
      expectedAccountVersion: 1,
      approved: true,
    });
    const stale = await adminService.createApprovalOperation({
      targetId: PENDING_ID,
      expectedAccountVersion: 1,
      approved: false,
    });
    await expect(
      adminService.setApproval(PENDING_ID, false, 1, first.key),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_MISMATCH" });
    await adminService.setApproval(PENDING_ID, true, 1, first.key);
    await expect(
      adminService.setApproval(PENDING_ID, true, 1, first.key),
    ).rejects.toMatchObject({ code: "OPERATION_ALREADY_RESOLVED" });
    await expect(
      adminService.setApproval(PENDING_ID, false, 1, stale.key),
    ).rejects.toMatchObject({ code: "USER_STATE_CONFLICT", httpStatus: 409 });
    expect(await adminService.getApprovalOperation(stale.key)).toMatchObject({
      state: "rejected",
      rejectionCode: "USER_STATE_CONFLICT",
    });
    expect(await adminService.getUser(PENDING_ID)).toMatchObject({
      approved: true,
      accountVersion: 2,
    });
    expect(await adminService.cancelApprovalOperation(first.key)).toMatchObject(
      {
        state: "succeeded",
        appliedApproved: true,
        appliedAccountVersion: 2,
      },
    );
  });

  it("records an explicit same-value approval as a new version", async () => {
    await loginAdmin();
    const target = await adminService.getUser(
      "00000000-0000-4000-8000-000000000101",
    );
    const operation = await adminService.createApprovalOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      approved: true,
    });
    await adminService.setApproval(
      target.id,
      true,
      target.accountVersion,
      operation.key,
    );
    expect(await adminService.getUser(target.id)).toMatchObject({
      approved: true,
      accountVersion: 2,
    });
  });

  it("reauthenticates before resetting and lets the member change the temporary password", async () => {
    await loginAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    const temporaryPassword = "A temporary passphrase 2026";
    await expect(
      adminService.createPasswordResetOperation({
        targetId: target.id,
        expectedAccountVersion: target.accountVersion,
        newPassword: temporaryPassword,
      }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED", httpStatus: 403 });

    await authService.reauthenticate({ password: "admin123" });
    const currentTarget = await adminService.getUser(MEMBER_ID);
    const operation = await adminService.createPasswordResetOperation({
      targetId: currentTarget.id,
      expectedAccountVersion: currentTarget.accountVersion,
      newPassword: temporaryPassword,
    });
    expect(operation).toMatchObject({
      kind: "user_password_reset",
      state: "unresolved",
      appliedAccountVersion: null,
      temporaryPasswordExpiresAt: null,
    });
    await adminService.setPasswordReset(
      currentTarget.id,
      temporaryPassword,
      currentTarget.accountVersion,
      operation.key,
    );
    const result = await adminService.getPasswordResetOperation(operation.key);
    expect(result).toMatchObject({
      state: "succeeded",
      appliedAccountVersion: 2,
      temporaryPasswordExpiresAt: "2026-09-23T00:12:00.000Z",
    });
    expect(await adminService.getUser(MEMBER_ID)).toMatchObject({
      approved: true,
      accountVersion: 2,
    });
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).not.toContain(
      temporaryPassword,
    );

    await authService.logout();
    const temporaryLogin = await authService.login({
      loginId: "교사김코딩",
      password: temporaryPassword,
    });
    expect(temporaryLogin.user).toMatchObject({
      sessionKind: "change_only",
      mustChangePassword: true,
    });
    await authService.changePassword({
      password: "My own replacement passphrase 2026",
    });
    await authService.logout();
    await expect(
      authService.login({
        loginId: "교사김코딩",
        password: temporaryPassword,
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", httpStatus: 401 });
    await loginAdmin();
    await expect(
      adminService.getPasswordResetOperation(operation.key),
    ).resolves.toMatchObject({ state: "succeeded", appliedAccountVersion: 2 });
  });

  it("keeps an unresolved reset bound to the same input until explicit cancel", async () => {
    await loginAdmin();
    await authService.reauthenticate({ password: "admin123" });
    const target = await adminService.getUser(MEMBER_ID);
    const temporaryPassword = "Unresolved temporary passphrase 44";
    const operation = await adminService.createPasswordResetOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      newPassword: temporaryPassword,
    });
    setMockScenario("admin_write_unresolved");

    await expect(
      adminService.setPasswordReset(
        target.id,
        "Different temporary passphrase 44",
        target.accountVersion,
        operation.key,
      ),
    ).rejects.toMatchObject({
      code: "OPERATION_KEY_MISMATCH",
      outcome: "rejected",
    });
    await expect(
      adminService.setPasswordReset(
        target.id,
        temporaryPassword,
        target.accountVersion,
        operation.key,
      ),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    expect(
      await adminService.getPasswordResetOperation(operation.key),
    ).toMatchObject({
      state: "unresolved",
      appliedAccountVersion: null,
    });
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).not.toContain(
      temporaryPassword,
    );

    expect(
      await adminService.cancelPasswordResetOperation(operation.key),
    ).toMatchObject({
      state: "rejected",
      rejectionCode: "OPERATION_CANCELLED",
    });
    await expect(
      adminService.cancelPasswordResetOperation(operation.key),
    ).resolves.toMatchObject({
      state: "rejected",
      rejectionCode: "OPERATION_CANCELLED",
    });
    expect(await adminService.getUser(MEMBER_ID)).toMatchObject({
      accountVersion: 1,
      approved: true,
    });
    setMockScenario("original");
    await authService.logout();
    await expect(
      authService.login({ loginId: "교사김코딩", password: "1234" }),
    ).resolves.toMatchObject({ user: { sessionKind: "full" } });
  });

  it("rejects protected, missing, and stale reset targets before issuing a key", async () => {
    await loginAdmin();
    await authService.reauthenticate({ password: "admin123" });
    const newPassword = "A suitable temporary password 44";

    await expect(
      adminService.createPasswordResetOperation({
        targetId: ADMIN_ID,
        expectedAccountVersion: 1,
        newPassword,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_ACCOUNT_PROTECTED",
      httpStatus: 403,
    });
    await expect(
      adminService.createPasswordResetOperation({
        targetId: "00000000-0000-4000-8000-000000000999",
        expectedAccountVersion: 1,
        newPassword,
      }),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", httpStatus: 404 });
    await expect(
      adminService.createPasswordResetOperation({
        targetId: MEMBER_ID,
        expectedAccountVersion: 2,
        newPassword,
      }),
    ).rejects.toMatchObject({ code: "USER_STATE_CONFLICT", httpStatus: 409 });
    expect(await adminService.getUser(MEMBER_ID)).toMatchObject({
      accountVersion: 1,
      approved: true,
    });
  });

  it("keeps unknown work unresolved until the same key is explicitly cancelled", async () => {
    await loginAdmin();
    const operation = await adminService.createApprovalOperation({
      targetId: PENDING_ID,
      expectedAccountVersion: 1,
      approved: true,
    });
    setMockScenario("admin_write_unresolved");
    await expect(
      adminService.setApproval(PENDING_ID, true, 1, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    expect(
      await adminService.getApprovalOperation(operation.key),
    ).toMatchObject({
      state: "unresolved",
      appliedApproved: null,
    });
    const cancelled = await adminService.cancelApprovalOperation(operation.key);
    expect(cancelled).toMatchObject({
      state: "rejected",
      rejectionCode: "OPERATION_CANCELLED",
    });
    expect(
      await adminService.cancelApprovalOperation(operation.key),
    ).toMatchObject({
      state: "rejected",
      rejectionCode: "OPERATION_CANCELLED",
    });
    setMockScenario("original");
    await expect(
      adminService.setApproval(PENDING_ID, true, 1, operation.key),
    ).rejects.toMatchObject({ code: "OPERATION_ALREADY_RESOLVED" });
    expect(await adminService.getUser(PENDING_ID)).toMatchObject({
      approved: false,
      accountVersion: 1,
    });
  });

  it("allows a result read to confirm a committed request after its response is lost", async () => {
    await loginAdmin();
    const operation = await adminService.createApprovalOperation({
      targetId: PENDING_ID,
      expectedAccountVersion: 1,
      approved: true,
    });
    setMockScenario("admin_write_unknown");
    await expect(
      adminService.setApproval(PENDING_ID, true, 1, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    setMockScenario("original");
    expect(
      await adminService.getApprovalOperation(operation.key),
    ).toMatchObject({
      state: "succeeded",
      appliedApproved: true,
      appliedAccountVersion: 2,
    });
    expect(await adminService.getUser(PENDING_ID)).toMatchObject({
      approved: true,
      accountVersion: 2,
    });
  });

  it("blocks expired keys without claiming that the past operation failed", async () => {
    await loginAdmin();
    const operation = await adminService.createApprovalOperation({
      targetId: PENDING_ID,
      expectedAccountVersion: 1,
      approved: true,
    });
    const state = getMockSnapshot();
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        ...state,
        approval_operations: state.approval_operations.map((item) =>
          item.key === operation.key
            ? {
                ...item,
                issued_at: "2000-01-01T00:00:00.000Z",
                expires_at: "2000-01-02T00:00:00.000Z",
              }
            : item,
        ),
      }),
    );
    await expect(
      adminService.setApproval(PENDING_ID, true, 1, operation.key),
    ).rejects.toMatchObject({ code: "OPERATION_EXPIRED", httpStatus: 410 });
    expect(
      getMockSnapshot().approval_operations.find(
        (item) => item.key === operation.key,
      ),
    ).toMatchObject({ state: "unresolved", applied_approved: null });
    expect(await adminService.getUser(PENDING_ID)).toMatchObject({
      approved: false,
      accountVersion: 1,
    });
  });

  it("finalizes a missing target without recreating it", async () => {
    await registerPendingAccounts(1);
    await loginAdmin();
    const target = await adminService.getUser(
      "00000000-0000-4000-8000-000000000107",
    );
    const operation = await adminService.createApprovalOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      approved: true,
    });
    const state = getMockSnapshot();
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        ...state,
        registered_accounts: state.registered_accounts.filter(
          (user) => user.id !== target.id,
        ),
        admin_users: state.admin_users.filter((user) => user.id !== target.id),
      }),
    );
    await expect(
      adminService.setApproval(
        target.id,
        true,
        target.accountVersion,
        operation.key,
      ),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", httpStatus: 404 });
    expect(
      await adminService.getApprovalOperation(operation.key),
    ).toMatchObject({
      state: "rejected",
      rejectionCode: "USER_NOT_FOUND",
    });
  });

  it("requires reauthentication, protects administrators, and binds deletion to its key", async () => {
    await loginAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    await expect(
      adminService.createUserDeleteOperation({
        targetId: target.id,
        expectedAppCount: target.appCount,
      }),
    ).rejects.toMatchObject({ code: "REAUTH_REQUIRED", httpStatus: 403 });

    await authService.reauthenticate({ password: "admin123" });
    await expect(
      adminService.createUserDeleteOperation({
        targetId: ADMIN_ID,
        expectedAppCount: 0,
      }),
    ).rejects.toMatchObject({
      code: "ADMIN_ACCOUNT_PROTECTED",
      httpStatus: 403,
    });

    const operation = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });
    await expect(
      adminService.deleteUser(target.id, target.appCount + 1, operation.key),
    ).rejects.toMatchObject({ code: "OPERATION_KEY_MISMATCH" });
  });

  it("deletes a pending fixture account without removing another member's apps", async () => {
    await reauthenticateAdmin();
    const before = await adminService.listApps();
    const target = await adminService.getUser(PENDING_ID);
    expect(target.appCount).toBe(0);
    const operation = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: 0,
    });

    await adminService.deleteUser(target.id, 0, operation.key);

    expect((await adminService.listApps()).items).toEqual(before.items);
    expect((await adminService.listUsers()).stats).toMatchObject({
      totalUsers: 6,
      pendingUsers: 1,
      totalApps: 17,
      healthyApps: 15,
    });
    await expect(adminService.getUser(PENDING_ID)).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
  });

  it("removes registered credentials and prevents a deleted account from returning", async () => {
    const registered = await authService.register({
      loginId: "delete-this-member",
      password: "A long fake member password for deletion",
      nickname: "삭제할 가입 회원",
    });
    await reauthenticateAdmin();
    const target = await adminService.getUser(registered.id);
    const operation = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });

    await adminService.deleteUser(target.id, target.appCount, operation.key);

    const state = getMockSnapshot();
    expect(state.deleted_account_ids).toContain(target.id);
    expect(state.registered_accounts).not.toContainEqual(
      expect.objectContaining({ id: target.id }),
    );
    expect(state.admin_users).not.toContainEqual(
      expect.objectContaining({ id: target.id }),
    );
    expect(getMockAccounts()).not.toContainEqual(
      expect.objectContaining({ id: target.id }),
    );
    await authService.logout();
    await expect(
      authService.login({
        loginId: registered.loginId,
        password: "A long fake member password for deletion",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("deletes the current app set after unrelated account-state changes", async () => {
    await reauthenticateAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    const before = await adminService.listUsers();
    const deletion = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });
    const reset = await adminService.createPasswordResetOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      newPassword: "New temporary password for account delete",
    });
    await adminService.setPasswordReset(
      target.id,
      "New temporary password for account delete",
      target.accountVersion,
      reset.key,
    );

    await adminService.deleteUser(target.id, target.appCount, deletion.key);
    expect(
      await adminService.getUserDeleteOperation(deletion.key),
    ).toMatchObject({ state: "succeeded", targetId: target.id });
    expect(
      await adminService.getPasswordResetOperation(reset.key),
    ).toMatchObject({ state: "succeeded" });
    await expect(adminService.getUser(target.id)).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    const after = await adminService.listUsers();
    expect(after.stats).toMatchObject({
      totalUsers: before.stats.totalUsers - 1,
      totalApps: before.stats.totalApps - target.appCount,
    });
    expect(
      (await adminService.listApps()).items.some(
        (app) => app.ownerId === target.id,
      ),
    ).toBe(false);
    expect(getMockAccounts()).not.toContainEqual(
      expect.objectContaining({ id: target.id }),
    );
  });

  it("rejects queued approval and password-reset work after account deletion", async () => {
    await reauthenticateAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    const deletion = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });
    const approval = await adminService.createApprovalOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      approved: false,
    });
    const resetPassword = "A pending reset operation for deleted member";
    const reset = await adminService.createPasswordResetOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      newPassword: resetPassword,
    });

    await adminService.deleteUser(target.id, target.appCount, deletion.key);
    await expect(
      adminService.setApproval(
        target.id,
        false,
        target.accountVersion,
        approval.key,
      ),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", httpStatus: 404 });
    await expect(
      adminService.setPasswordReset(
        target.id,
        resetPassword,
        target.accountVersion,
        reset.key,
      ),
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND", httpStatus: 404 });
    expect(await adminService.getApprovalOperation(approval.key)).toMatchObject(
      {
        state: "rejected",
        rejectionCode: "USER_NOT_FOUND",
      },
    );
    expect(
      await adminService.getPasswordResetOperation(reset.key),
    ).toMatchObject({ state: "rejected", rejectionCode: "USER_NOT_FOUND" });
  });

  it("keeps account deletion valid when reset and approval finish first", async () => {
    await reauthenticateAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    const deletion = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });
    const resetPassword = "Temporary password before account deletion";
    const reset = await adminService.createPasswordResetOperation({
      targetId: target.id,
      expectedAccountVersion: target.accountVersion,
      newPassword: resetPassword,
    });
    await adminService.setPasswordReset(
      target.id,
      resetPassword,
      target.accountVersion,
      reset.key,
    );
    const updated = await adminService.getUser(target.id);
    const approval = await adminService.createApprovalOperation({
      targetId: updated.id,
      expectedAccountVersion: updated.accountVersion,
      approved: updated.approved,
    });
    await adminService.setApproval(
      target.id,
      updated.approved,
      updated.accountVersion,
      approval.key,
    );
    await adminService.deleteUser(target.id, target.appCount, deletion.key);
    expect(
      await adminService.getUserDeleteOperation(deletion.key),
    ).toMatchObject({ state: "succeeded" });
  });

  it("rejects a changed app count, but accepts a same-count app composition change", async () => {
    await reauthenticateAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    const conflicted = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });
    await authService.logout();
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    const created = await appsService.issueCreateOperation(memberAppInput);
    await appsService.create(memberAppInput, created.key);
    await authService.logout();
    await reauthenticateAdmin();
    await expect(
      adminService.deleteUser(target.id, target.appCount, conflicted.key),
    ).rejects.toMatchObject({ code: "APP_COUNT_CONFLICT", httpStatus: 409 });
    expect(await adminService.getUser(target.id)).toMatchObject({
      appCount: target.appCount + 1,
    });
    expect(
      await adminService.getUserDeleteOperation(conflicted.key),
    ).toMatchObject({ state: "rejected", rejectionCode: "APP_COUNT_CONFLICT" });

    const current = await adminService.getUser(target.id);
    const sameCount = await adminService.createUserDeleteOperation({
      targetId: current.id,
      expectedAppCount: current.appCount,
    });
    const ownedApps = [
      ...getMockSnapshot().apps,
      ...getMockSnapshot().private_apps,
    ].filter((app) => app.owner.id === target.id);
    await authService.logout();
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    const replacement = await appsService.issueCreateOperation({
      ...memberAppInput,
      name: "같은 수의 구성 교체 앱",
    });
    await appsService.create(
      { ...memberAppInput, name: "같은 수의 구성 교체 앱" },
      replacement.key,
    );
    const removed = ownedApps[0];
    const removedOperation = await appsService.issueDeleteOperation(
      removed.id,
      removed.version,
    );
    await appsService.delete(removed.id, removed.version, removedOperation.key);
    await authService.logout();
    await reauthenticateAdmin();
    await adminService.deleteUser(target.id, current.appCount, sameCount.key);
    expect(
      await adminService.getUserDeleteOperation(sameCount.key),
    ).toMatchObject({ state: "succeeded" });
    await expect(adminService.getUser(target.id)).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
  });

  it("keeps confirmation pending after deletion and resolves it by the same key", async () => {
    await reauthenticateAdmin();
    const target = await adminService.getUser(MEMBER_ID);
    const operation = await adminService.createUserDeleteOperation({
      targetId: target.id,
      expectedAppCount: target.appCount,
    });
    setMockScenario("admin_delete_pending_confirmation");
    await expect(
      adminService.deleteUser(target.id, target.appCount, operation.key),
    ).rejects.toMatchObject({
      code: "DELETION_CONFIRMATION_PENDING",
      httpStatus: 503,
      outcome: "unknown",
    });
    await expect(adminService.getUser(target.id)).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    expect(
      await adminService.getUserDeleteOperation(operation.key),
    ).toMatchObject({ state: "confirming_deletion" });
    setMockClock("2026-09-22T00:13:00.000Z");
    expect(
      await adminService.getUserDeleteOperation(operation.key),
    ).toMatchObject({ state: "succeeded" });
  });
});
