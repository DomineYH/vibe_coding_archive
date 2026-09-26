import { beforeEach, describe, expect, it } from "vitest";
import { authService } from "../src/services/mock/auth";
import { appsService } from "../src/services/mock/apps";
import { adminService } from "../src/services/mock/admin";
import {
  getMockSnapshot,
  MOCK_STORAGE_KEY,
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

describe("mock app updates", () => {
  it("issues a versioned key and increments the owned app exactly once", async () => {
    await loginMember();
    const createKey = await appsService.issueCreateOperation(input);
    const created = await appsService.create(input, createKey.key);
    const beforeUpdate = getMockSnapshot().apps.length;
    const patch = { name: "수정한 수업 도구" };
    const operation = await appsService.issueUpdateOperation(
      created.id,
      patch,
      created.version,
    );

    expect(operation).toMatchObject({
      kind: "app_update",
      targetId: created.id,
      state: "unresolved",
    });
    expect(getMockSnapshot().apps).toHaveLength(beforeUpdate);

    const updated = await appsService.update(
      created.id,
      patch,
      created.version,
      operation.key,
    );
    expect(updated).toMatchObject({
      id: created.id,
      name: patch.name,
      version: 2,
      urlVersion: 1,
      health: { result: { state: "unchecked" } },
    });
    await expect(
      appsService.getUpdateOperation(operation.key),
    ).resolves.toMatchObject({
      state: "succeeded",
      targetId: created.id,
      resultVersion: 2,
    });
    expect(getMockSnapshot().apps).toHaveLength(beforeUpdate);
    await expect(
      appsService.update(created.id, patch, created.version, operation.key),
    ).rejects.toMatchObject({
      code: "OPERATION_ALREADY_RESOLVED",
      outcome: "unknown",
    });
  });

  it("invalidates results only when the URL changes beyond its fragment", async () => {
    await loginMember();
    const create = await appsService.issueCreateOperation(input);
    const created = await appsService.create(input, create.key);
    const state = getMockSnapshot();
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        ...state,
        apps: state.apps.map((app) =>
          app.id === created.id
            ? {
                ...app,
                health: {
                  ...app.health,
                  next_check_at: "2026-09-22T00:20:00.000Z",
                },
              }
            : app,
        ),
      }),
    );

    const changedUrl = "https://example.org/changed#first";
    const urlOperation = await appsService.issueUpdateOperation(
      created.id,
      { url: changedUrl },
      1,
    );
    const changed = await appsService.update(
      created.id,
      { url: changedUrl },
      1,
      urlOperation.key,
    );
    expect(changed).toMatchObject({
      version: 2,
      urlVersion: 2,
      url: changedUrl,
      health: {
        result: { state: "unchecked", checked_at: null, fresh_until: null },
        latestJob: null,
        nextCheckAt: "2026-09-22T00:20:00.000Z",
      },
    });

    const fragmentOnly = "https://example.org/changed#second";
    const fragmentOperation = await appsService.issueUpdateOperation(
      created.id,
      { url: fragmentOnly },
      changed.version,
    );
    const withFragment = await appsService.update(
      created.id,
      { url: fragmentOnly },
      changed.version,
      fragmentOperation.key,
    );
    expect(withFragment.version).toBe(3);
    expect(withFragment.urlVersion).toBe(2);
    expect(withFragment.health).toEqual(changed.health);
  });

  it("rejects a stale update without applying it", async () => {
    await loginMember();
    const create = await appsService.issueCreateOperation(input);
    const created = await appsService.create(input, create.key);
    const first = await appsService.issueUpdateOperation(
      created.id,
      { name: "첫 번째 수정" },
      created.version,
    );
    const stale = await appsService.issueUpdateOperation(
      created.id,
      { name: "오래된 수정" },
      created.version,
    );
    await appsService.update(
      created.id,
      { name: "첫 번째 수정" },
      1,
      first.key,
    );

    await expect(
      appsService.update(created.id, { name: "오래된 수정" }, 1, stale.key),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", outcome: "rejected" });
    await expect(
      appsService.getUpdateOperation(stale.key),
    ).resolves.toMatchObject({
      state: "rejected",
      rejectionCode: "VERSION_CONFLICT",
    });
    await expect(appsService.get(created.id)).resolves.toMatchObject({
      name: "첫 번째 수정",
      version: 2,
    });
  });

  it("rejects a delayed update when the auth flow changes before it completes", async () => {
    await loginMember();
    const create = await appsService.issueCreateOperation(input);
    const created = await appsService.create(input, create.key);
    const patch = { name: "인증 변경 후 도착한 응답" };
    const operation = await appsService.issueUpdateOperation(
      created.id,
      patch,
      created.version,
    );
    setMockScenario("app_update_delayed");

    const pendingUpdate = appsService.update(
      created.id,
      patch,
      created.version,
      operation.key,
    );
    await authService.logout();
    await loginMember();

    await expect(pendingUpdate).rejects.toMatchObject({
      code: "AUTH_STATE_CHANGED",
      outcome: "rejected",
    });
    await expect(appsService.get(created.id)).resolves.toMatchObject({
      name: input.name,
      version: 1,
    });
    await expect(
      appsService.getUpdateOperation(operation.key),
    ).resolves.toMatchObject({ state: "unresolved" });
  });

  it("removes an app from public reads when the owner makes it private", async () => {
    await loginMember();
    const create = await appsService.issueCreateOperation(input);
    const created = await appsService.create(input, create.key);
    const update = await appsService.issueUpdateOperation(
      created.id,
      { isPublic: false },
      created.version,
    );
    const madePrivate = await appsService.update(
      created.id,
      { isPublic: false },
      created.version,
      update.key,
    );

    expect(getMockSnapshot().apps.some((app) => app.id === created.id)).toBe(
      false,
    );
    expect(
      getMockSnapshot().private_apps.some((app) => app.id === created.id),
    ).toBe(true);
    await authService.logout();
    await authService.login({ loginId: "과학덕후박샘", password: "1234" });
    await expect(appsService.get(created.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await appsService.list()).items).not.toContainEqual(
      expect.objectContaining({ id: madePrivate.id }),
    );
  });

  it("keeps unresolved edits locked until an explicit same-key retry or result check", async () => {
    await loginMember();
    const create = await appsService.issueCreateOperation(input);
    const created = await appsService.create(input, create.key);
    const patch = { name: "미확정 수정" };
    const operation = await appsService.issueUpdateOperation(
      created.id,
      patch,
      created.version,
    );
    setMockScenario("app_update_unresolved");

    await expect(
      appsService.update(created.id, patch, created.version, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    await expect(
      appsService.getUpdateOperation(operation.key),
    ).resolves.toMatchObject({ state: "unresolved" });
    expect(await appsService.get(created.id)).toMatchObject({ version: 1 });
    setMockScenario("original");
    await expect(
      appsService.update(created.id, patch, created.version, operation.key),
    ).resolves.toMatchObject({ name: patch.name, version: 2 });
  });
});

describe("mock app deletion", () => {
  it("deletes only the owner's current app and updates aggregate counts", async () => {
    await loginMember();
    const appId = "00000000-0000-4000-8000-000000000091";
    const before = getMockSnapshot();
    const operation = await appsService.issueDeleteOperation(appId, 1);

    expect(operation).toMatchObject({
      kind: "app_delete",
      targetId: appId,
      state: "unresolved",
    });
    expect(getMockSnapshot().private_apps).toHaveLength(
      before.private_apps.length,
    );

    await appsService.delete(appId, 1, operation.key);
    await expect(
      appsService.getDeleteOperation(operation.key),
    ).resolves.toMatchObject({
      kind: "app_delete",
      state: "succeeded",
      targetId: appId,
      resultVersion: null,
    });
    expect(getMockSnapshot().private_apps.some((app) => app.id === appId)).toBe(
      false,
    );
    const deletedSnapshot = getMockSnapshot();
    await appsService.delete(appId, 1, operation.key);
    expect(getMockSnapshot().generation).toBe(deletedSnapshot.generation);
    await expect(appsService.get(appId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      outcome: "rejected",
    });

    await authService.logout();
    await authService.login({ loginId: "admin", password: "admin123" });
    const page = await adminService.listUsers();
    expect(page.stats.totalApps).toBe(
      before.apps.length + before.private_apps.length - 1,
    );
    expect(page.stats.healthyApps).toBe(
      [...before.apps, ...before.private_apps].filter(
        (app) => app.health.result.state === "healthy",
      ).length - 1,
    );
  });

  it("rejects non-owner, stale-version, and mismatched-key deletes", async () => {
    const appId = "00000000-0000-4000-8000-000000000091";
    await authService.login({ loginId: "과학덕후박샘", password: "1234" });
    await expect(
      appsService.issueDeleteOperation(appId, 1),
    ).rejects.toMatchObject({ code: "NOT_FOUND", outcome: "rejected" });

    await authService.logout();
    await loginMember();
    await expect(
      appsService.issueDeleteOperation(appId, 2),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", outcome: "rejected" });
    const operation = await appsService.issueDeleteOperation(appId, 1);
    await expect(
      appsService.delete(appId, 2, operation.key),
    ).rejects.toMatchObject({
      code: "OPERATION_KEY_MISMATCH",
      outcome: "rejected",
    });
    expect(getMockSnapshot().private_apps.some((app) => app.id === appId)).toBe(
      true,
    );
  });

  it("keeps an unresolved delete until the author explicitly retries the same key", async () => {
    await loginMember();
    const appId = "00000000-0000-4000-8000-000000000091";
    const operation = await appsService.issueDeleteOperation(appId, 1);
    setMockScenario("app_delete_unresolved");

    await expect(
      appsService.delete(appId, 1, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    await expect(
      appsService.getDeleteOperation(operation.key),
    ).resolves.toMatchObject({ state: "unresolved" });
    expect(getMockSnapshot().private_apps.some((app) => app.id === appId)).toBe(
      true,
    );

    setMockScenario("original");
    await appsService.delete(appId, 1, operation.key);
    await expect(
      appsService.getDeleteOperation(operation.key),
    ).resolves.toMatchObject({ state: "succeeded" });
  });

  it("requires explicit key lookup after a committed response is lost", async () => {
    await loginMember();
    const appId = "00000000-0000-4000-8000-000000000091";
    const operation = await appsService.issueDeleteOperation(appId, 1);
    setMockScenario("app_delete_unknown");

    await expect(
      appsService.delete(appId, 1, operation.key),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    expect(getMockSnapshot().private_apps.some((app) => app.id === appId)).toBe(
      false,
    );
    await expect(
      appsService.getDeleteOperation(operation.key),
    ).resolves.toMatchObject({ state: "succeeded", targetId: appId });
  });

  it("keeps deletion confirmation pending until the same key is retried", async () => {
    await loginMember();
    const appId = "00000000-0000-4000-8000-000000000091";
    const operation = await appsService.issueDeleteOperation(appId, 1);
    setMockScenario("app_delete_pending_confirmation");

    await expect(
      appsService.delete(appId, 1, operation.key),
    ).rejects.toMatchObject({
      code: "DELETION_CONFIRMATION_PENDING",
      outcome: "unknown",
    });
    await expect(
      appsService.getDeleteOperation(operation.key),
    ).resolves.toMatchObject({ state: "confirming_deletion" });
    await appsService.delete(appId, 1, operation.key);
    await expect(
      appsService.getDeleteOperation(operation.key),
    ).resolves.toMatchObject({ state: "succeeded" });
  });

  it("drops a delayed deletion when mock state resets before it commits", async () => {
    await loginMember();
    const appId = "00000000-0000-4000-8000-000000000091";
    setMockScenario("app_delete_delayed");
    const operation = await appsService.issueDeleteOperation(appId, 1);
    const request = appsService.delete(appId, 1, operation.key);

    resetMockState();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(getMockSnapshot().private_apps.some((app) => app.id === appId)).toBe(
      true,
    );
  });
});
