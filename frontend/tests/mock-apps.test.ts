import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsService } from "../src/services/mock/apps";
import {
  MOCK_RESET_EVENT,
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockScenario,
} from "../src/services/mock/state";

function failNextStorageWrite() {
  vi.spyOn(Storage.prototype, "setItem").mockImplementationOnce(() => {
    throw new DOMException("temporary write failure", "QuotaExceededError");
  });
}

describe("deterministic gallery mock", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the shared validation error for invalid list queries", async () => {
    await expect(appsService.list({ limit: 0 })).rejects.toMatchObject({
      name: "ServiceError",
      code: "VALIDATION_ERROR",
      outcome: "rejected",
    });
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

  it("selects deterministic long-list and long-copy scenarios without changing original data", async () => {
    const originalDetail = await appsService.get(
      "00000000-0000-4000-8000-000000000001",
    );

    setMockScenario("long_list");
    const longList = await appsService.list({ limit: 24, offset: 0 });
    const allLongList = await appsService.list({ limit: 100, offset: 0 });
    expect(longList.pagination.total).toBe(28);
    expect(longList.items).toHaveLength(24);
    expect(longList.items.at(-1)?.name).toContain("긴 목록 8");
    expect(allLongList.items).toHaveLength(28);
    expect(new Set(allLongList.items.map((item) => item.id)).size).toBe(28);

    setMockScenario("long_copy");
    const longCopy = await appsService.get(originalDetail.id);
    expect(longCopy.description.length).toBeGreaterThan(2000);
    expect(longCopy.prompt.length).toBeGreaterThan(2000);

    setMockScenario("original");
    expect((await appsService.get(originalDetail.id)).prompt).toBe(
      originalDetail.prompt,
    );
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

  it("rejects a negative generation and recovers only after explicit reset", async () => {
    resetMockState();
    const saved = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null");
    const damaged = JSON.stringify({ ...saved, generation: -1 });
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

  it("rejects enum values with the wrong stored shape", async () => {
    resetMockState();
    const saved = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null");
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({ ...saved, scenario: ["empty"] }),
    );

    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
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

  it("rejects malformed app collections and records without resetting them", async () => {
    resetMockState();
    const valid = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null");
    for (const damaged of [
      JSON.stringify({ ...valid, apps: {} }),
      JSON.stringify({ ...valid, apps: [{}] }),
    ]) {
      localStorage.setItem(MOCK_STORAGE_KEY, damaged);

      await expect(
        appsService.list({ limit: 24, offset: 0 }),
      ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
      expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBe(damaged);
    }

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

  it("initializes on retry after a one-time initial storage write failure", async () => {
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    failNextStorageWrite();

    await expect(
      appsService.list({ limit: 24, offset: 0 }),
    ).rejects.toMatchObject({ code: "MOCK_STORAGE_ERROR" });
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBeNull();
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MOCK_RESET_EVENT }),
    );
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });

  it("keeps scenario state and reset events unchanged when persistence fails once", async () => {
    resetMockState();
    const saved = localStorage.getItem(MOCK_STORAGE_KEY);
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    failNextStorageWrite();

    expect(() => setMockScenario("list_failure")).toThrow(
      "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
    );
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBe(saved);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MOCK_RESET_EVENT }),
    );
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });

  it("keeps reset generation and reset events unchanged when persistence fails once", async () => {
    resetMockState();
    const saved = localStorage.getItem(MOCK_STORAGE_KEY);
    const dispatchEvent = vi.spyOn(window, "dispatchEvent");
    failNextStorageWrite();

    expect(() => resetMockState()).toThrow(
      "개발용 저장 데이터를 읽거나 저장하지 못했어요.",
    );
    expect(localStorage.getItem(MOCK_STORAGE_KEY)).toBe(saved);
    expect(dispatchEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: MOCK_RESET_EVENT }),
    );
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
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

  it("recovers storage with the largest safe generation", async () => {
    resetMockState();
    const saved = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null");
    localStorage.setItem(
      MOCK_STORAGE_KEY,
      JSON.stringify({ ...saved, generation: Number.MAX_SAFE_INTEGER }),
    );

    resetMockState();
    expect(
      JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY) ?? "null").generation,
    ).toBe(0);
    expect(
      (await appsService.list({ limit: 24, offset: 0 })).items,
    ).toHaveLength(16);
  });
});
