// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearApiStartupStorage } from "../src/services/startup-storage.js";

afterEach(() => vi.unstubAllGlobals());

describe("API startup storage cleanup", () => {
  it("clears both legacy keys when storage is available", () => {
    const removeItem = vi.fn();
    vi.stubGlobal("localStorage", { removeItem });

    clearApiStartupStorage();

    expect(removeItem.mock.calls).toEqual([
      ["eduvibe-archive-coty2026"],
      ["eduvibe-archive-mock-v1"],
    ]);
  });

  it("continues when the browser denies storage access", () => {
    vi.stubGlobal(
      "localStorage",
      new Proxy(
        {},
        {
          get: () => {
            throw new DOMException("Denied", "SecurityError");
          },
        },
      ),
    );

    expect(() => clearApiStartupStorage()).not.toThrow();
  });
});
