// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../vite.config.js";

afterEach(() => vi.unstubAllEnvs());

describe("Vite environment guard", () => {
  it("rejects VITE variables other than VITE_DATA_MODE", () => {
    vi.stubEnv("VITE_API_KEY", "must-not-be-forwarded");
    expect(() => viteConfig({ command: "serve", mode: "test" })).toThrow(
      "VITE_API_KEY",
    );
  });
});
