import { beforeEach, describe, expect, it } from "vitest";
import { adminService } from "../src/services/mock/admin";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { healthService } from "../src/services/mock/health";
import {
  deleteMockApp,
  getMockSnapshot,
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockClock,
  setMockScenario,
} from "../src/services/mock/state";

const newAppInput = {
  name: "전체 검사 경계 앱",
  url: "https://example.org/batch-boundary",
  prompt: "검사 대상",
  description: "합성 경계 확인",
  subject: "수학" as const,
  grades: ["초3"] as const,
  isPublic: true,
  themeId: "niagara",
  stack: { db: "", backend: "", frontend: "", hosting: "" },
};
const memberId = "00000000-0000-4000-8000-000000000101";

async function createApp() {
  const operation = await appsService.issueCreateOperation(newAppInput);
  return appsService.create(newAppInput, operation.key);
}

describe("administrator health batches", () => {
  beforeEach(async () => {
    localStorage.clear();
    resetMockState();
    await authService.login({ loginId: "admin", password: "admin123" });
  });

  it("advertises health batches in the synthetic mock capability set", async () => {
    await expect(appsService.getMeta()).resolves.toMatchObject({
      capabilities: { health_batch: { enabled: true } },
    });
  });

  it("keeps a fixed target count and rediscovers active work by ID", async () => {
    const targetCount = (await adminService.listApps({ limit: 100 })).pagination
      .total;
    const started = await healthService.requestBatch();

    expect(started).toMatchObject({
      disposition: "created",
      batch: {
        isFinished: false,
        targetCount,
        processedCount: 0,
        counts: { queued: targetCount, running: 0, reused: 0 },
      },
    });

    await expect(healthService.requestBatch()).resolves.toMatchObject({
      disposition: "active_reused",
      batch: { id: started.batch.id, targetCount },
    });
    await expect(
      healthService.getBatch(started.batch.id),
    ).resolves.toMatchObject({
      id: started.batch.id,
      targetCount,
      isFinished: false,
    });
    await expect(adminService.listUsers()).resolves.toMatchObject({
      stats: { activeHealthBatchId: started.batch.id },
    });

    await createApp();
    await expect(adminService.listApps({ limit: 100 })).resolves.toMatchObject({
      pagination: { total: targetCount + 1 },
    });
    await expect(
      healthService.getBatch(started.batch.id),
    ).resolves.toMatchObject({
      targetCount,
    });
  });

  it("reuses fresh results once and applies the cooldown from batch creation", async () => {
    const state = getMockSnapshot();
    const setCooldown = (app: (typeof state.apps)[number]) => ({
      ...app,
      health: { ...app.health, next_check_at: "2026-09-22T00:13:00.000Z" },
    });
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        ...state,
        apps: state.apps.map(setCooldown),
        private_apps: state.private_apps.map(setCooldown),
      }),
    );
    const before = await adminService.listApps({ limit: 100 });
    const accepted = await healthService.requestBatch();

    expect(accepted.batch).toMatchObject({
      isFinished: true,
      targetCount: before.items.length,
      processedCount: before.items.length,
      counts: {
        queued: 0,
        running: 0,
        resultObtained: before.items.length,
        reused: before.items.length,
      },
    });
    const after = await adminService.listApps({ limit: 100 });
    expect(after.items.map((app) => app.health.checked_at)).toEqual(
      before.items.map((app) => app.health.checked_at),
    );
    await expect(healthService.requestBatch()).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryAt: "2026-09-22T00:17:00.000Z",
    });

    setMockClock("2026-09-22T00:17:00.000Z");
    await expect(healthService.requestBatch()).resolves.toMatchObject({
      disposition: "created",
      batch: { isFinished: false, targetCount: before.items.length },
    });
  });

  it("runs mixed outcomes without changing old results for failed or cancelled apps", async () => {
    setMockScenario("health_batch_mixed");
    const before = getMockSnapshot();
    const accepted = await healthService.requestBatch();
    let batch = accepted.batch;
    for (let attempt = 0; !batch.isFinished && attempt < 10; attempt += 1)
      batch = await healthService.getBatch(batch.id);

    expect(batch).toMatchObject({
      isFinished: true,
      targetCount: 17,
      processedCount: 17,
      counts: {
        resultObtained: 15,
        failed: 1,
        cancelled: 1,
        reused: 0,
      },
    });
    const saved = getMockSnapshot();
    const completed = saved.health_batches.find(
      (item) => item.id === batch.id,
    )!;
    expect(completed.targets[1]?.state).toBe("failed");
    expect(completed.targets[2]?.state).toBe("cancelled");
    for (const target of completed.targets.slice(1, 3)) {
      const previousApp = [...before.apps, ...before.private_apps].find(
        (app) => app.id === target.app_id,
      );
      const currentApp = [...saved.apps, ...saved.private_apps].find(
        (app) => app.id === target.app_id,
      );
      expect(currentApp?.health.result).toEqual(previousApp?.health.result);
    }

    const terminalSnapshot = completed;
    const appToDelete = completed.targets[0]!.app_id!;
    deleteMockApp(appToDelete);
    expect(
      getMockSnapshot().health_batches.find((item) => item.id === batch.id),
    ).toEqual(terminalSnapshot);
  });

  it("does not reuse stale results during an app cooldown", async () => {
    const state = getMockSnapshot();
    const setCooldown = (app: (typeof state.apps)[number]) => ({
      ...app,
      health: { ...app.health, next_check_at: "2026-09-22T00:30:00.000Z" },
    });
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        ...state,
        apps: state.apps.map(setCooldown),
        private_apps: state.private_apps.map(setCooldown),
        mock_now: "2026-09-22T00:27:00.000Z",
      }),
    );

    await expect(adminService.listUsers()).resolves.toMatchObject({
      stats: { healthyApps: 0, nextHealthExpiryAt: null },
    });
    const accepted = await healthService.requestBatch();
    expect(accepted).toMatchObject({
      batch: {
        isFinished: false,
        counts: { queued: 17, resultObtained: 0, reused: 0 },
      },
    });
    await expect(
      healthService.getBatch(accepted.batch.id),
    ).resolves.toMatchObject({
      processedCount: 0,
      counts: { queued: 17, running: 0 },
    });
    setMockClock("2026-09-22T00:30:00.000Z");
    await expect(
      healthService.getBatch(accepted.batch.id),
    ).resolves.toMatchObject({
      counts: { queued: 11, running: 6 },
    });
  });

  it("cancels a fixed active target after its URL changes", async () => {
    const app = await createApp();
    const accepted = await healthService.requestBatch();
    const targetCount = accepted.batch.targetCount;
    const patch = { url: "https://example.org/batch-boundary-updated" };
    const operation = await appsService.issueUpdateOperation(
      app.id,
      patch,
      app.version,
    );
    await appsService.update(app.id, patch, app.version, operation.key);

    const batch = await healthService.getBatch(accepted.batch.id);
    expect(batch.targetCount).toBe(targetCount);
    expect(batch.counts.cancelled).toBe(1);
    expect(
      getMockSnapshot().health_batches[0]?.targets.filter(
        (target) => target.state === "cancelled",
      ),
    ).toHaveLength(1);
  });

  it("cancels a fixed active target after an app is deleted", async () => {
    const app = await createApp();
    const accepted = await healthService.requestBatch();
    const operation = await appsService.issueDeleteOperation(
      app.id,
      app.version,
    );
    await appsService.delete(app.id, app.version, operation.key);

    const batch = await healthService.getBatch(accepted.batch.id);
    expect(batch.targetCount).toBe(accepted.batch.targetCount);
    expect(batch.counts.cancelled).toBe(1);
  });

  it("cancels a deleted member's active targets without changing the denominator", async () => {
    const accepted = await healthService.requestBatch();
    await authService.reauthenticate({ password: "admin123" });
    const member = await adminService.getUser(memberId);
    const operation = await adminService.createUserDeleteOperation({
      targetId: member.id,
      expectedAppCount: member.appCount,
    });
    await adminService.deleteUser(member.id, member.appCount, operation.key);

    const batch = await healthService.getBatch(accepted.batch.id);
    expect(batch.targetCount).toBe(accepted.batch.targetCount);
    expect(batch.counts.cancelled).toBe(member.appCount);
  });

  it("returns an immediate empty batch and rejects the unavailable capability", async () => {
    setMockScenario("health_batch_empty");
    await expect(adminService.listUsers()).resolves.toMatchObject({
      stats: { totalApps: 0, healthyApps: 0 },
    });
    await expect(adminService.listApps()).resolves.toMatchObject({
      pagination: { total: 0 },
    });
    await expect(healthService.requestBatch()).resolves.toMatchObject({
      batch: {
        isFinished: true,
        targetCount: 0,
        processedCount: 0,
        counts: { queued: 0, running: 0, reused: 0 },
      },
    });

    setMockClock("2026-09-22T00:17:00.000Z");
    setMockScenario("health_check_unavailable");
    await expect(healthService.requestBatch()).rejects.toMatchObject({
      code: "FEATURE_UNAVAILABLE",
    });
  });

  it("stops batch polling failures from changing job counts and permits explicit recovery", async () => {
    const accepted = await healthService.requestBatch();
    setMockScenario("health_batch_query_failure");
    await expect(
      healthService.getBatch(accepted.batch.id),
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
    });
    expect(
      getMockSnapshot().health_batches[0]?.targets.every(
        (target) => target.state === "queued",
      ),
    ).toBe(true);

    setMockScenario("original");
    await expect(
      healthService.getBatch(accepted.batch.id),
    ).resolves.toMatchObject({
      isFinished: false,
      counts: { running: expect.any(Number), failed: 0, cancelled: 0 },
    });
  });
});
