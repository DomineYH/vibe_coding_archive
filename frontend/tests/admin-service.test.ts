import { beforeEach, describe, expect, it } from "vitest";
import { authService } from "../src/services/mock/auth";
import { adminService } from "../src/services/mock/admin";
import {
  getMockSnapshot,
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockScenario,
} from "../src/services/mock/state";

const ADMIN_ID = "00000000-0000-4000-8000-000000000100";
const PENDING_ID = "00000000-0000-4000-8000-000000000102";

async function loginAdmin() {
  await authService.login({ loginId: "admin", password: "admin123" });
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
    });
    expect(page.items.find((user) => user.id === ADMIN_ID)).toMatchObject({
      role: "admin",
      accountVersion: 1,
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
});
