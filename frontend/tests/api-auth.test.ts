import { describe, expect, it } from "vitest";
import { authService } from "../src/services/api/auth";

describe("Phase 1 API auth boundary", () => {
  it("keeps auth unavailable in API mode until its phase is implemented", async () => {
    await expect(authService.getCurrentAuthState()).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
    await expect(authService.getMe()).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
    await expect(authService.getCsrf()).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
    await expect(
      authService.register({
        loginId: "new-teacher",
        password: "correct horse battery staple",
        nickname: "새 교사",
      }),
    ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await expect(
      authService.login({ loginId: "admin", password: "admin123" }),
    ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await expect(
      authService.changePassword({ password: "new demo password phrase" }),
    ).rejects.toMatchObject({ code: "FEATURE_UNAVAILABLE" });
    await expect(authService.logout()).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
  });
});
