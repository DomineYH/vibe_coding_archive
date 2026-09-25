import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/mock/apps";
import {
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockScenario,
} from "../src/services/mock/state";

describe("deterministic gallery mock", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps original public fixture order and filters only public search fields", async () => {
    const first = await appsService.list({ limit: 24, offset: 0 });
    const again = await appsService.list({ limit: 24, offset: 0 });
    expect(first.items.map((item) => item.name)).toEqual(
      again.items.map((item) => item.name),
    );
    expect(first.items).toHaveLength(16);
    expect(
      (await appsService.list({ q: "교사김코딩", limit: 24, offset: 0 })).items
        .length,
    ).toBeGreaterThan(0);
    expect(
      (await appsService.list({ q: "app-01", limit: 24, offset: 0 })).items,
    ).toHaveLength(0);
  });

  it("rejects damaged storage and only restores fixtures after explicit reset", async () => {
    localStorage.setItem("eduvibe-archive-mock-v1", "{");
    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
    resetMockState();
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });

  it("rejects unsupported saved versions until explicit reset", async () => {
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        generation: 0,
        scenario: "original",
        apps: [],
      }),
    );
    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
    resetMockState();
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });

  it("rejects malformed saved app records without resetting them", async () => {
    resetMockState();
    const valid = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null");
    const damaged = JSON.stringify({ ...valid, apps: [{}] });
    localStorage.setItem(MOCK_STORAGE_KEY, damaged);

    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBe(damaged);

    resetMockState();
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });

  it("reports storage write failures instead of serving an unpersisted fixture", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    });
    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
  });

  it("fails the current request when reset invalidates its generation", async () => {
    const pending = appsService.list({ limit: 24, offset: 0 });
    resetMockState();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("returns a deterministic list failure until the mock scenario changes", async () => {
    setMockScenario("list_failure");
    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
    setMockScenario("original");
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });

  it("keeps the list pending during its deterministic loading scenario", async () => {
    vi.useFakeTimers();
    try {
      setMockScenario("list_delayed");
      let settled = false;
      const result = appsService.list({ limit: 24, offset: 0 }).then((page) => {
        settled = true;
        return page;
      });
      await Promise.resolve();
      expect(settled).toBe(false);
      await vi.runOnlyPendingTimersAsync();
      expect((await result).items).toHaveLength(16);
    } finally {
      vi.useRealTimers();
    }
  });
});
