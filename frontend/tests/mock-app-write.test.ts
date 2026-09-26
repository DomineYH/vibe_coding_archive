import { beforeEach, describe, expect, it } from "vitest";
import { authService } from "../src/services/mock/auth";
import { appsService } from "../src/services/mock/apps";
import {
  getMockSnapshot,
  resetMockState,
  setMockScenario,
} from "../src/services/mock/state";

const input = {
  name: "새 수업 도구",
  url: "https://example.org/class",
  prompt: "질문\n답변",
  description: "수업 설명",
  subject: "수학" as const,
  grades: ["초3", "중1"] as const,
  isPublic: true,
  themeId: "niagara",
  stack: { db: "", backend: "", frontend: "React", hosting: "Vercel" },
};

beforeEach(() => resetMockState());

async function loginMember() {
  await authService.login({ loginId: "교사김코딩", password: "1234" });
}

describe("mock app creation", () => {
  it("issues a key without saving, then creates and reads the confirmed app", async () => {
    await loginMember();
    const before = getMockSnapshot().apps.length;
    const operation = await appsService.issueCreateOperation(input);

    expect(operation).toMatchObject({
      kind: "app_create",
      state: "unresolved",
      targetId: null,
    });
    expect(getMockSnapshot().apps).toHaveLength(before);

    const app = await appsService.create(input, operation.key);
    expect(app).toMatchObject({
      name: input.name,
      version: 1,
      urlVersion: 1,
      health: { result: { state: "unchecked" } },
    });
    expect(await appsService.getCreateOperation(operation.key)).toMatchObject({
      state: "succeeded",
      targetId: app.id,
      resultVersion: 1,
    });
    expect(getMockSnapshot().apps).toHaveLength(before + 1);
    await expect(
      appsService.create(input, operation.key),
    ).rejects.toMatchObject({
      code: "OPERATION_ALREADY_RESOLVED",
      outcome: "unknown",
    });
  });

  it("allows duplicate URLs while assigning distinct app IDs", async () => {
    await loginMember();
    const firstOperation = await appsService.issueCreateOperation(input);
    const first = await appsService.create(input, firstOperation.key);
    const secondInput = { ...input, name: "다른 이름의 같은 URL 앱" };
    const secondOperation = await appsService.issueCreateOperation(secondInput);
    const second = await appsService.create(secondInput, secondOperation.key);

    expect(first.url).toBe(second.url);
    expect(first.id).not.toBe(second.id);
  });

  it("clears tab-memory operation keys on an explicit mock reset", async () => {
    await loginMember();
    const operation = await appsService.issueCreateOperation(input);
    resetMockState();
    await loginMember();

    await expect(
      appsService.getCreateOperation(operation.key),
    ).rejects.toMatchObject({ code: "OPERATION_NOT_FOUND" });
  });

  it("keeps an unresolved result distinct and allows explicit same-key retry", async () => {
    await loginMember();
    const operation = await appsService.issueCreateOperation(input);
    setMockScenario("app_create_unresolved");

    await expect(
      appsService.create(input, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    await expect(
      appsService.getCreateOperation(operation.key),
    ).resolves.toMatchObject({
      state: "unresolved",
      targetId: null,
    });
    setMockScenario("original");
    await expect(
      appsService.create(input, operation.key),
    ).resolves.toMatchObject({
      name: input.name,
    });
  });

  it("records explicit rejection without creating an app", async () => {
    await loginMember();
    const before = getMockSnapshot().apps.length;
    const operation = await appsService.issueCreateOperation(input);
    setMockScenario("app_create_failure");

    await expect(
      appsService.create(input, operation.key),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      outcome: "rejected",
    });
    await expect(
      appsService.getCreateOperation(operation.key),
    ).resolves.toMatchObject({
      state: "rejected",
      rejectionCode: "VALIDATION_ERROR",
    });
    expect(getMockSnapshot().apps).toHaveLength(before);
  });

  it("does not make a lost response look unresolved after a committed create", async () => {
    await loginMember();
    const operation = await appsService.issueCreateOperation(input);
    setMockScenario("app_create_unknown");

    await expect(
      appsService.create(input, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    await expect(
      appsService.getCreateOperation(operation.key),
    ).resolves.toMatchObject({
      state: "succeeded",
    });
  });
});
