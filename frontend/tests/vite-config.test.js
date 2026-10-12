// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import viteConfig from "../vite.config.js";
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
