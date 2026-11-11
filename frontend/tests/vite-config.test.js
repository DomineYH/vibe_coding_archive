// @vitest-environment node
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig, { kstDate } from "../vite.config.js";
import faultConfig from "../e2e-api/vite-fault.config.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("Vite environment guard", () => {
  it("rejects VITE variables other than VITE_DATA_MODE", () => {
    vi.stubEnv("VITE_API_KEY", "must-not-be-forwarded");
    expect(() => viteConfig({ command: "serve", mode: "test" })).toThrow(
      "VITE_API_KEY",
    );
  });
});

describe("Vite API proxy identity boundary", () => {
  function start(headers, socket) {
    vi.stubEnv("VITE_DATA_MODE", "api");
    const config = viteConfig({ command: "serve", mode: "test" });
    const proxy = new EventEmitter();
    config.server.proxy["/api"].configure?.(proxy);
    const request = { headers: { ...headers }, socket };
    proxy.emit("start", request);
    return request.headers;
  }

  it.each([
    ["127.0.0.1", "203.0.113.7"],
    ["127.0.0.2", "203.0.113.7, 198.51.100.8"],
    ["::1", "203.0.113.7, 203.0.113.7"],
  ])(
    "overwrites forwarded identity from the socket peer %s",
    (peer, supplied) => {
      const headers = start(
        {
          "x-forwarded-for": supplied,
          "x-real-ip": "198.51.100.9",
          forwarded: "for=198.51.100.9;proto=https",
        },
        { remoteAddress: peer },
      );
      expect(headers["x-forwarded-for"]).toBe(peer);
      expect(headers["x-real-ip"]).toBe(peer);
      expect(headers).not.toHaveProperty("forwarded");
    },
  );

  it.each([
    [false, "http"],
    [true, "https"],
  ])("derives forwarded scheme from the connection %s", (encrypted, scheme) => {
    const headers = start(
      { "x-forwarded-proto": encrypted ? "http" : "https" },
      { remoteAddress: "127.0.0.1", encrypted },
    );
    expect(headers["x-forwarded-proto"]).toBe(scheme);
  });

  it("sanitizes requests with Expect before upstream request creation", () => {
    expect(
      start(
        {
          expect: "100-continue",
          "x-forwarded-for": "203.0.113.7",
          "x-real-ip": "203.0.113.8",
          "x-forwarded-proto": "https",
          forwarded: "for=203.0.113.7",
          host: "localhost:5174",
          origin: "http://localhost:5174",
          cookie: "session=value",
          "x-csrf-token": "csrf-value",
        },
        { remoteAddress: "127.0.0.1" },
      ),
    ).toEqual({
      expect: "100-continue",
      "x-forwarded-for": "127.0.0.1",
      "x-real-ip": "127.0.0.1",
      "x-forwarded-proto": "http",
      host: "localhost:5174",
      origin: "http://localhost:5174",
      cookie: "session=value",
      "x-csrf-token": "csrf-value",
    });
  });

  it("drops supplied identity when no socket peer exists", () => {
    expect(
      start(
        {
          "x-forwarded-for": "203.0.113.7",
          "x-real-ip": "203.0.113.8",
          "x-forwarded-proto": "https",
          forwarded: "for=203.0.113.7",
        },
        {},
      ),
    ).toEqual({ "x-forwarded-proto": "http" });
  });

  it("retains the identity boundary in the private fault transport", () => {
    vi.stubEnv("VITE_DATA_MODE", "api");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("API_E2E_FAULTS", "1");
    const config = faultConfig({ command: "serve", mode: "test" });
    const proxy = new EventEmitter();
    config.server.proxy["/api"].configure(proxy);
    const request = {
      headers: {
        expect: "100-continue",
        "x-forwarded-for": "203.0.113.7",
        "x-real-ip": "198.51.100.8",
        "x-forwarded-proto": "https",
        forwarded: "for=192.0.2.9",
      },
      socket: { remoteAddress: "127.0.0.1" },
    };
    proxy.emit("start", request);
    expect(request.headers).toEqual({
      expect: "100-continue",
      "x-forwarded-for": "127.0.0.1",
      "x-real-ip": "127.0.0.1",
      "x-forwarded-proto": "http",
    });
  });

  it("leaves mock mode without an API proxy", () => {
    vi.stubEnv("VITE_DATA_MODE", "mock");
    expect(
      viteConfig({ command: "serve", mode: "test" }).server.proxy,
    ).toBeUndefined();
  });
});

describe("Vite commit metadata", () => {
  const cfg = () => viteConfig({ command: "serve", mode: "test" });

  it("uses explicit commit values without reading git", () => {
    vi.stubEnv("APP_COMMIT_DATE", "2026-01-02");
    vi.stubEnv("APP_COMMIT_SHA", "abc1234");
    const { define } = cfg();
    expect(define.__APP_COMMIT_DATE__).toBe('"2026-01-02"');
    expect(define.__APP_COMMIT_SHA__).toBe('"abc1234"');
  });

  it("reads the HEAD short hash and its KST committer date", () => {
    vi.stubEnv("APP_COMMIT_DATE", "");
    vi.stubEnv("APP_COMMIT_SHA", "");
    let expected = ["", ""];
    try {
      const [h, ct] = execFileSync("git", ["log", "-1", "--format=%h %ct"], {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .split(" ");
      expected = [
        new Date((Number(ct) + 32400) * 1000).toISOString().slice(0, 10),
        h,
      ];
    } catch {
      // No readable git: the config must fall back to empty values too.
    }
    const { define } = cfg();
    expect(define.__APP_COMMIT_DATE__).toBe(JSON.stringify(expected[0]));
    expect(define.__APP_COMMIT_SHA__).toBe(JSON.stringify(expected[1]));
  });

  it("falls back to empty values when git cannot be read", () => {
    vi.stubEnv("GIT_DIR", "/nonexistent");
    vi.stubEnv("APP_COMMIT_DATE", "");
    vi.stubEnv("APP_COMMIT_SHA", "");
    const { define } = cfg();
    expect(define.__APP_COMMIT_DATE__).toBe('""');
    expect(define.__APP_COMMIT_SHA__).toBe('""');
  });

  it.each([
    ["2026-01-02", ""],
    ["", "abc1234"],
    ["2026-1-2", "abc1234"],
    ["2026-13-01", "abc1234"],
    ["2026-02-30", "abc1234"],
    ["2026-01-02", "ABC1234"],
    ["2026-01-02", "abc123"],
    ["2026-01-02", "a".repeat(41)],
  ])("rejects APP_COMMIT_DATE=%j APP_COMMIT_SHA=%j", (date, sha) => {
    vi.stubEnv("APP_COMMIT_DATE", date);
    vi.stubEnv("APP_COMMIT_SHA", sha);
    expect(cfg).toThrow(/APP_COMMIT_/);
  });

  it("converts committer time to the Korean calendar date", () => {
    expect(kstDate(1792121763)).toBe("2026-10-16");
  });
});
