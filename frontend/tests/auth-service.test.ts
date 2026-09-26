import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { adminService } from "../src/services/mock/admin";
import {
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockAuthGateOpen,
  setMockClock,
  setMockScenario,
} from "../src/services/mock/state";

const privateMemberApp = "00000000-0000-4000-8000-000000000091";

describe("demo authentication and protected reads", () => {
  beforeEach(() => {
    localStorage.clear();
    resetMockState();
  });

  afterEach(() => localStorage.clear());

  it("restores an approved member after refresh and logs out to anonymous", async () => {
    const result = await authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    const user = result.user;
    expect(user).toMatchObject({
      id: "00000000-0000-4000-8000-000000000101",
      loginId: "교사김코딩",
      nickname: "교사김코딩",
      role: "user",
      approved: true,
      sessionKind: "full",
    });
    expect(await authService.getMe()).toEqual(user);

    await authService.logout();
    await authService.login({ loginId: "admin", password: "admin123" });
    await expect(authService.getMe()).resolves.toMatchObject({
      role: "admin",
      nickname: "아카이브 관리자",
    });
    await authService.logout();
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("signs the prepared temporary member into the bounded change-only session", async () => {
    const result = await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });

    expect(result.user).toMatchObject({
      role: "user",
      approved: true,
      mustChangePassword: true,
      sessionKind: "change_only",
      expiresAt: "2026-09-22T00:27:00.000Z",
      email: null,
      phone: null,
      recentAuthUntil: null,
    });
    expect(await authService.getCurrentAuthState()).toMatchObject({
      user: result.user,
    });
    await expect(appsService.get(privateMemberApp)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("caps change-only expiry at fifteen minutes or the temporary credential expiry", async () => {
    const normal = await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });
    expect(normal.user.expiresAt).toBe("2026-09-22T00:27:00.000Z");
    await authService.logout();

    setMockClock("2026-09-22T23:59:00.000Z");
    const nearCredentialExpiry = await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });
    expect(nearCredentialExpiry.user.expiresAt).toBe(
      "2026-09-23T00:12:00.000Z",
    );
    await authService.logout();

    setMockClock("2026-09-23T00:12:00.000Z");
    await expect(
      authService.login({
        loginId: "임시교사38",
        password: "Temporary Demo Password 38",
      }),
    ).rejects.toMatchObject({
      code: "TEMP_PASSWORD_EXPIRED",
      httpStatus: 403,
    });
    expect((await authService.getCurrentAuthState()).user).toBeNull();
  });

  it("checks approval before reporting an expired temporary password", async () => {
    const state = JSON.parse(
      localStorage.getItem(MOCK_STORAGE_KEY) ?? "null",
    ) as {
      admin_users: {
        id: string;
        approved: boolean;
        first_approved_at: string | null;
      }[];
    };
    const temporaryUser = state.admin_users.find(
      (user) => user.id === "00000000-0000-4000-8000-000000000900",
    )!;
    temporaryUser.approved = false;
    temporaryUser.first_approved_at = null;
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    setMockClock("2026-09-23T00:12:00.000Z");

    await expect(
      authService.login({
        loginId: "임시교사38",
        password: "Temporary Demo Password 38",
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_APPROVED", httpStatus: 403 });
  });

  it("consumes the temporary password and preserves NFC and surrounding spaces", async () => {
    await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });
    const password = "  Cafe\u0301 training phrase 38  ";
    const changed = await authService.changePassword({ password });

    expect(changed.user).toMatchObject({
      mustChangePassword: false,
      sessionKind: "full",
      expiresAt: "2026-09-22T08:12:00.000Z",
    });
    expect(await authService.getMe()).toEqual(changed.user);
    await expect(
      authService.changePassword({ password: "another training phrase 38" }),
    ).rejects.toMatchObject({ code: "SESSION_KIND_NOT_ALLOWED" });

    await authService.logout();
    await expect(
      authService.login({
        loginId: "임시교사38",
        password: "Temporary Demo Password 38",
      }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(
      authService.login({
        loginId: "임시교사38",
        password: "  Café training phrase 38  ",
      }),
    ).resolves.toMatchObject({ user: { sessionKind: "full" } });
  });

  it("rejects a change at the exact session expiry without changing the password", async () => {
    await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });
    setMockClock("2026-09-22T00:27:00.000Z");

    await expect(
      authService.changePassword({ password: "New phrase after expiry 38" }),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED", httpStatus: 401 });
    expect((await authService.getCurrentAuthState()).user).toBeNull();
    await expect(
      authService.login({
        loginId: "임시교사38",
        password: "Temporary Demo Password 38",
      }),
    ).resolves.toMatchObject({ user: { sessionKind: "change_only" } });
  });

  it("starts an administrator full and recent-auth window after the first change", async () => {
    await authService.login({
      loginId: "임시관리자38",
      password: "Temporary Admin Password 38",
    });
    const changed = await authService.changePassword({
      password: "New administrator phrase 38",
    });

    expect(changed.user).toMatchObject({
      role: "admin",
      sessionKind: "full",
      mustChangePassword: false,
      expiresAt: "2026-09-22T08:12:00.000Z",
      recentAuthUntil: "2026-09-22T00:27:00.000Z",
    });
    await expect(
      adminService.listUsers({ limit: 24, offset: 0 }),
    ).resolves.toBeDefined();
  });

  it("discards a delayed password change after logout", async () => {
    vi.useFakeTimers();
    try {
      await authService.login({
        loginId: "임시교사38",
        password: "Temporary Demo Password 38",
      });
      setMockScenario("auth_delayed");
      const pending = authService.changePassword({
        password: "New password for delayed flow 38",
      });
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      const flow = await authService.getFlowState();
      const transitionId = flow.pendingTransition!.transitionId;
      await authService.settleTransition(transitionId, {
        flowId: flow.flowId,
        expectedRevision: flow.revision,
      });
      setMockScenario("original");
      await authService.logout();
      await vi.advanceTimersByTimeAsync(300);
      await rejected;
      setMockScenario("original");
      await expect(
        authService.login({
          loginId: "임시교사38",
          password: "New password for delayed flow 38",
        }),
      ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves auth transition history when the same member returns", async () => {
    const anonymous = await authService.getCurrentAuthState();
    expect(anonymous).toMatchObject({
      user: null,
      flow: {
        flowId: "00000000-0000-4000-8000-000000000200",
        revision: "0",
        sessionGeneration: "0",
        lastIdentityChangeRevision: "0",
      },
      observationGeneration: 0,
    });

    const firstLogin = await authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    const firstState = await authService.getCurrentAuthState();
    expect(firstState).toMatchObject({
      user: { id: firstLogin.user.id },
      flow: {
        revision: "2",
        sessionGeneration: "1",
        lastIdentityChangeRevision: "2",
      },
      observationGeneration: 1,
    });

    setMockScenario("empty");
    expect(await authService.getCurrentAuthState()).toMatchObject({
      flow: firstState.flow,
      observationGeneration: firstState.observationGeneration,
    });

    await authService.logout();
    const loggedOut = await authService.getCurrentAuthState();
    expect(loggedOut.flow.revision).toBe("4");
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    const returned = await authService.getCurrentAuthState();

    expect(returned.user?.id).toBe(firstLogin.user.id);
    expect(returned.flow).toEqual({
      flowId: firstState.flow.flowId,
      revision: "6",
      sessionGeneration: "2",
      lastIdentityChangeRevision: "6",
    });
    expect(returned.observationGeneration).toBe(3);
  });

  it("settles an admitted transition before a later tab can admit another one", async () => {
    const initial = await authService.getFlowState();
    const permit = await authService.admitTransition({
      flowId: initial.flowId,
      transitionId: initial.nextTransitionId!,
      kind: "login",
      expectedRevision: initial.revision,
      expectedSessionGeneration: initial.sessionGeneration,
    });

    expect(await authService.getFlowState(permit.transitionId)).toMatchObject({
      pendingTransition: {
        transitionId: permit.transitionId,
        state: "admitted",
      },
    });

    const settled = await authService.settleTransition(permit.transitionId, {
      flowId: initial.flowId,
      expectedRevision: permit.revision,
    });
    expect(settled).toMatchObject({
      transition: {
        availability: "available",
        state: "cancelled",
      },
    });
    await expect(
      authService.admitTransition({
        flowId: initial.flowId,
        transitionId: initial.nextTransitionId!,
        kind: "login",
        expectedRevision: initial.revision,
        expectedSessionGeneration: initial.sessionGeneration,
      }),
    ).rejects.toMatchObject({ code: "AUTH_STATE_CHANGED" });
  });

  it("settles a lost response as its actual result without hiding a received session", async () => {
    setMockScenario("auth_response_lost");
    await expect(
      authService.login({ loginId: "교사김코딩", password: "1234" }),
    ).rejects.toMatchObject({ outcome: "unknown" });

    const unresolved = await authService.getCurrentAuthState();
    expect(unresolved).toMatchObject({ user: null, status: "unresolved" });
    const transitionId = unresolved.unresolvedTransitionId!;
    const flow = await authService.getFlowState(transitionId);
    const result = await authService.settleTransition(transitionId, {
      flowId: flow.flowId,
      expectedRevision: flow.revision,
    });

    expect(result.transition).toMatchObject({
      availability: "available",
      state: "succeeded",
    });
    expect(await authService.getCurrentAuthState()).toMatchObject({
      status: "ready",
      user: { loginId: "교사김코딩" },
    });
  });

  it("does not let a no-session logout clear an unresolved login result", async () => {
    setMockScenario("auth_response_lost");
    await expect(
      authService.login({ loginId: "교사김코딩", password: "1234" }),
    ).rejects.toMatchObject({ outcome: "unknown" });
    const unresolved = await authService.getCurrentAuthState();

    await expect(authService.logout()).rejects.toMatchObject({
      code: "AUTH_TRANSITION_PENDING",
      httpStatus: 409,
    });
    expect(await authService.getCurrentAuthState()).toMatchObject({
      status: "unresolved",
      unresolvedTransitionId: unresolved.unresolvedTransitionId,
      user: null,
    });
  });

  it("discards only an issued session whose cookie was not received", async () => {
    setMockScenario("auth_session_cookie_lost");
    await expect(
      authService.login({ loginId: "교사김코딩", password: "1234" }),
    ).rejects.toMatchObject({ outcome: "unknown" });

    const unresolved = await authService.getCurrentAuthState();
    expect(unresolved).toMatchObject({
      user: null,
      status: "unresolved",
      sessionCookiePresent: false,
      flow: { sessionGeneration: "1" },
    });
    const transitionId = unresolved.unresolvedTransitionId!;
    const flow = await authService.getFlowState(transitionId);
    await authService.discardSession(transitionId, {
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      expectedSessionGeneration: flow.sessionGeneration!,
    });

    expect(await authService.getCurrentAuthState()).toMatchObject({
      user: null,
      status: "ready",
      flow: { sessionGeneration: null },
    });
  });

  it("keeps a password change after explicitly discarding its unreceived session", async () => {
    await authService.login({
      loginId: "임시교사38",
      password: "Temporary Demo Password 38",
    });
    const password = "Password changed before cookie loss 38";
    setMockScenario("auth_session_cookie_lost");
    await expect(
      authService.changePassword({ password }),
    ).rejects.toMatchObject({
      outcome: "unknown",
    });

    const unresolved = await authService.getCurrentAuthState();
    expect(unresolved).toMatchObject({
      user: null,
      status: "unresolved",
      sessionCookiePresent: false,
      flow: { sessionGeneration: "2" },
    });
    const transitionId = unresolved.unresolvedTransitionId!;
    const flow = await authService.getFlowState(transitionId);
    await authService.discardSession(transitionId, {
      flowId: flow.flowId,
      expectedRevision: flow.revision,
      expectedSessionGeneration: flow.sessionGeneration!,
    });
    setMockScenario("original");

    await expect(
      authService.login({ loginId: "임시교사38", password }),
    ).resolves.toMatchObject({ user: { sessionKind: "full" } });
  });

  it("keeps an unavailable result unresolved until the flow is explicitly reset", async () => {
    setMockScenario("auth_result_unavailable");
    await expect(
      authService.login({ loginId: "교사김코딩", password: "1234" }),
    ).rejects.toMatchObject({ outcome: "unknown" });

    let unresolved = await authService.getCurrentAuthState();
    const transitionId = unresolved.unresolvedTransitionId!;
    let flow = await authService.getFlowState(transitionId);
    const settled = await authService.settleTransition(transitionId, {
      flowId: flow.flowId,
      expectedRevision: flow.revision,
    });
    expect(settled.transition).toMatchObject({
      availability: "unavailable",
      executionBlocked: true,
      state: null,
    });
    unresolved = await authService.getCurrentAuthState();
    expect(unresolved.status).toBe("unresolved");

    flow = await authService.getFlowState(transitionId);
    await expect(
      authService.resetFlow(flow.flowId, {
        expectedRevision: flow.revision,
        expectedSessionGeneration: flow.sessionGeneration,
      }),
    ).resolves.toEqual({ restartEligible: true });
    const unprepared = await authService.createFlow({
      restartFrom: [flow.flowId],
    });
    expect(await authService.getRestartEligibility(unprepared.flowId)).toEqual({
      restartEligible: false,
    });
    await expect(authService.abandonFlow(unprepared.flowId)).resolves.toEqual({
      restartEligible: true,
    });
    const created = await authService.createFlow({
      restartFrom: [unprepared.flowId],
    });
    const recovery = await authService.issueRecoveryCookie(created.flowId);
    expect(await authService.getRecoveryContext()).toEqual({
      items: [
        {
          flowId: created.flowId,
          revision: recovery.revision,
          proofKind: "recovery",
        },
      ],
    });
    expect(await authService.getRecoveryCsrf(created.flowId)).toMatchObject({
      flowId: created.flowId,
      revision: recovery.revision,
      recoveryCsrfToken: recovery.recoveryCsrfToken,
    });
    const ready = await authService.confirmRecoveryCookie(created.flowId, {
      expectedRevision: recovery.revision,
    });
    const prepared = await authService.getFlowState();
    await authService.issueAnonymousSession({
      flowId: created.flowId,
      expectedRevision: ready.revision,
      transitionId: prepared.nextTransitionId!,
    });
    expect(await authService.getCurrentAuthState()).toMatchObject({
      status: "ready",
      user: null,
      flow: { flowId: created.flowId },
    });
  });

  it("uses a sequence gate for deterministic pending and release ordering", async () => {
    setMockScenario("auth_transition_gate");
    const pending = authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    const flow = await authService.getFlowState();
    expect(flow.pendingTransition).toMatchObject({ state: "admitted" });
    setMockAuthGateOpen();
    await expect(pending).resolves.toMatchObject({
      user: { loginId: "교사김코딩" },
    });
  });

  it("expires a pending permit by mock time and blocks its late completion", async () => {
    const initial = await authService.getFlowState();
    const permit = await authService.admitTransition({
      flowId: initial.flowId,
      transitionId: initial.nextTransitionId!,
      kind: "login",
      expectedRevision: initial.revision,
      expectedSessionGeneration: initial.sessionGeneration,
    });
    setMockClock("2026-09-22T00:13:00.000Z");
    const flow = await authService.getFlowState(permit.transitionId);
    const settled = await authService.settleTransition(permit.transitionId, {
      flowId: flow.flowId,
      expectedRevision: flow.revision,
    });
    expect(settled.transition).toMatchObject({
      availability: "available",
      state: "expired",
      executionBlocked: null,
    });
  });

  it("rotates recovery proof without changing the current session", async () => {
    const signedIn = await authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    const initial = await authService.getFlowState();
    const permit = await authService.admitTransition({
      flowId: initial.flowId,
      transitionId: initial.nextTransitionId!,
      kind: "reauthenticate",
      expectedRevision: initial.revision,
      expectedSessionGeneration: initial.sessionGeneration,
    });
    await expect(
      authService.rotateRecoveryCookie(initial.flowId, {
        expectedRevision: permit.revision,
        expectedSessionGeneration: initial.sessionGeneration!,
      }),
    ).rejects.toMatchObject({ code: "AUTH_TRANSITION_PENDING" });
    await authService.settleTransition(permit.transitionId, {
      flowId: initial.flowId,
      expectedRevision: permit.revision,
    });

    const flow = await authService.getFlowState();
    const previous = await authService.getRecoveryCsrf(flow.flowId);
    const rotated = await authService.rotateRecoveryCookie(flow.flowId, {
      expectedRevision: flow.revision,
      expectedSessionGeneration: flow.sessionGeneration!,
    });

    expect(rotated.recoveryCsrfToken).not.toBe(previous.recoveryCsrfToken);
    expect(await authService.getCurrentAuthState()).toMatchObject({
      status: "ready",
      user: { id: signedIn.user.id },
      flow: {
        flowId: flow.flowId,
        sessionGeneration: flow.sessionGeneration,
      },
    });
  });

  it("records a failed reauthentication without changing the principal", async () => {
    const signedIn = await authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    const before = await authService.getCurrentAuthState();
    await expect(
      authService.reauthenticate({ password: "wrong" }),
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", httpStatus: 401 });
    expect(await authService.getCurrentAuthState()).toMatchObject({
      status: "ready",
      user: { id: signedIn.user.id },
      flow: {
        sessionGeneration: before.flow.sessionGeneration,
        lastIdentityChangeRevision: before.flow.lastIdentityChangeRevision,
      },
    });
  });

  it("rotates a recent-auth administrator session without extending its expiry", async () => {
    await authService.login({ loginId: "admin", password: "admin123" });
    const before = await authService.getCurrentAuthState();

    const result = await authService.reauthenticate({ password: "admin123" });
    const after = await authService.getCurrentAuthState();

    expect(result.user).toMatchObject({
      id: before.user?.id,
      role: "admin",
      sessionKind: "full",
      expiresAt: before.user?.expiresAt,
      recentAuthUntil: "2026-09-22T00:27:00.000Z",
    });
    expect(after.flow.sessionGeneration).not.toBe(
      before.flow.sessionGeneration,
    );
    expect(after.flow.lastIdentityChangeRevision).toBe(
      before.flow.lastIdentityChangeRevision,
    );
  });

  it("does not apply a delayed login after mock reset", async () => {
    vi.useFakeTimers();
    try {
      setMockScenario("auth_delayed");
      const pending = authService.login({
        loginId: "교사김코딩",
        password: "1234",
      });
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      resetMockState();
      await vi.advanceTimersByTimeAsync(1000);
      await rejected;
      expect((await authService.getCurrentAuthState()).user).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps auth observation failures explicit for a retry", async () => {
    setMockScenario("auth_observation_error");
    await expect(authService.getCurrentAuthState()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      httpStatus: 503,
    });
  });

  it("uses the same credential error for unknown accounts and wrong passwords", async () => {
    for (const loginId of ["missing-user", "교사김코딩"]) {
      await expect(
        authService.login({ loginId, password: "wrong" }),
      ).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
        httpStatus: 401,
      });
    }
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("rejects the existing unapproved fixture account without signing it in", async () => {
    await expect(
      authService.login({ loginId: "비기너개발자", password: "1234" }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_APPROVED",
      httpStatus: 403,
    });
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
      httpStatus: 401,
    });
  });

  it("creates a normalized member who stays anonymous and pending after refresh", async () => {
    const password = "Cafe\u0301 secure training phrase";
    const registered = await authService.register({
      loginId: "  New_Teacher-1  ",
      password,
      nickname: "  Cafe\u0301 Teacher  ",
      email: "   ",
      phone: null,
    });

    expect(registered).toEqual({
      id: "00000000-0000-4000-8000-000000000107",
      loginId: "New_Teacher-1",
      nickname: "Café Teacher",
      approved: false,
      pendingExpiresAt: "2026-12-21T00:12:00.000Z",
    });
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
    await expect(
      authService.login({ loginId: "new_teacher-1", password }),
    ).rejects.toMatchObject({
      code: "ACCOUNT_NOT_APPROVED",
      httpStatus: 403,
    });
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("rejects synthetic contact input while collection is disabled without creating an account", async () => {
    const input = {
      loginId: "New_Teacher-2",
      password: "correct horse battery staple",
      nickname: "새 교사",
      email: "teacher@example.invalid",
      phone: "+00 000-0000-0000",
    };

    await expect(authService.register(input)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      httpStatus: 422,
      fields: {
        email: expect.any(String),
        phone: expect.any(String),
      },
    });
    await expect(
      authService.register({ ...input, email: null, phone: null }),
    ).resolves.toMatchObject({
      loginId: input.loginId,
      approved: false,
    });
  });

  it("reports a normalized duplicate login ID on the login field", async () => {
    await expect(
      authService.register({
        loginId: " ADMIN ",
        password: "correct horse battery staple",
        nickname: "새 교사",
      }),
    ).rejects.toMatchObject({
      code: "LOGIN_ID_TAKEN",
      httpStatus: 409,
      fields: { login_id: expect.any(String) },
    });
  });

  it.each([
    ["invalid login characters", { loginId: "bad name" }, "login_id"],
    ["short Unicode password", { password: "가".repeat(14) }, "password"],
    ["long Unicode password", { password: "가".repeat(129) }, "password"],
    ["control character in nickname", { nickname: "새\n교사" }, "nickname"],
    ["invalid email", { email: "display name <a@example.invalid>" }, "email"],
    ["invalid phone", { phone: "010-12" }, "phone"],
  ])("rejects %s as a field error", async (_name, patch, field) => {
    await expect(
      authService.register({
        loginId: "new-teacher-3",
        password: "correct horse battery staple",
        nickname: "새 교사",
        ...patch,
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      httpStatus: 422,
      fields: { [field]: expect.any(String) },
    });
  });

  it("does not create a late account after mock reset and reset removes registrations", async () => {
    vi.useFakeTimers();
    try {
      setMockScenario("auth_delayed");
      const input = {
        loginId: "new-teacher-4",
        password: "correct horse battery staple",
        nickname: "새 교사",
      };
      const pending = authService.register(input);
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      resetMockState();
      await vi.advanceTimersByTimeAsync(300);
      await rejected;

      await expect(authService.login(input)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
      await authService.register(input);
      resetMockState();
      await expect(authService.login(input)).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows only the owner or an administrator to read private apps", async () => {
    await expect(appsService.get(privateMemberApp)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });
    await expect(
      appsService.get("00000000-0000-4000-8000-000000000099"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });

    const member = await authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    expect((await appsService.get(privateMemberApp)).ownerId).toBe(
      member.user.id,
    );
    await authService.logout();
    await authService.login({ loginId: "과학덕후박샘", password: "1234" });
    await expect(appsService.get(privateMemberApp)).rejects.toMatchObject({
      code: "NOT_FOUND",
      httpStatus: 404,
    });

    await authService.logout();
    await authService.login({ loginId: "admin", password: "admin123" });
    expect((await appsService.get(privateMemberApp)).isPublic).toBe(false);
  });

  it("does not turn an authentication communication failure into success", async () => {
    setMockScenario("auth_network_error");
    await expect(
      authService.login({ loginId: "admin", password: "admin123" }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "AUTH_REQUIRED",
    });
  });

  it("keeps the signed-in principal when logout communication fails", async () => {
    const result = await authService.login({
      loginId: "교사김코딩",
      password: "1234",
    });
    setMockScenario("auth_network_error");

    await expect(authService.logout()).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      httpStatus: 503,
    });
    expect(await authService.getMe()).toEqual(result.user);
  });

  it("discards a private read that finishes after logout", async () => {
    vi.useFakeTimers();
    try {
      await authService.login({ loginId: "교사김코딩", password: "1234" });
      setMockScenario("detail_delayed");
      const pending = appsService.get(privateMemberApp);
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(0);
      await authService.logout();
      await vi.advanceTimersByTimeAsync(300);

      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
