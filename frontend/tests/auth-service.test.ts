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
