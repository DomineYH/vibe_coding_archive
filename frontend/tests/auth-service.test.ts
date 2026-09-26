import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { resetMockState, setMockScenario } from "../src/services/mock/state";

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
