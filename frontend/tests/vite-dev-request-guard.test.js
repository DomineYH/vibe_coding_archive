// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import viteConfig from "../vite.config.js";

const frontendRoot = path.dirname(
  fileURLToPath(new URL("../vite.config.js", import.meta.url)),
);
const BODY = "Bad Request: malformed percent-encoding in the URL path\n";
const GUARD = "dev-malformed-path-guard";

afterEach(() => vi.unstubAllEnvs());

function configFor(mode) {
  vi.stubEnv("VITE_DATA_MODE", mode);
  return viteConfig({ command: "serve", mode: "test" });
}

describe("dev malformed path guard plugin", () => {
  function guard(mode = "mock") {
    const plugin = configFor(mode).plugins.find((p) => p?.name === GUARD);
    let middleware;
    plugin.configureServer({
      middlewares: { use: (fn) => (middleware = fn) },
    });
    return { plugin, middleware };
  }

  function run(url) {
    const headers = {};
    const req = { url };
    const res = {
      statusCode: 200,
      setHeader: (name, value) => (headers[name.toLowerCase()] = value),
      end: vi.fn(),
    };
    const next = vi.fn();
    guard().middleware(req, res, next);
    return { req, res, next, headers };
  }

  it.each(["mock", "api"])("is a serve-only plugin in %s mode", (mode) => {
    expect(guard(mode).plugin.apply).toBe("serve");
  });

  it.each([
    "/apps/%E0%A4%A",
    "/apps/%",
    "/apps/%zz",
    "/%FF",
    "/apps/%E0%A4%A/",
    "/@fs/%E0",
    "/src/%E0",
  ])("rejects malformed path %s with a fixed 400", (url) => {
    const { res, next, headers } = run(url);
    expect(res.statusCode).toBe(400);
    expect(headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(res.end).toHaveBeenCalledOnce();
    expect(res.end).toHaveBeenCalledWith(BODY);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([
    "/",
    "/apps/123e4567-e89b-42d3-a456-426614174000",
    "/apps/%E2%9C%93",
    "/apps/a%20b",
    "/src/main.jsx?t=1",
    "/api/v1/apps?q=%EB%B6%84",
    "/?q=%",
    "/?q=%E0%A4%A",
    "/apps/x?q=%FF",
  ])("passes %s through untouched", (url) => {
    const { req, res, next } = run(url);
    expect(next).toHaveBeenCalledOnce();
    expect(res.end).not.toHaveBeenCalled();
    expect(req.url).toBe(url);
  });
});

function raw(port, method, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method, path: requestPath, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"],
            body: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe.each(["mock", "api"])("dev server malformed paths (%s)", (mode) => {
  let server;
  let cacheDir;
  let port;
  let socket;
  const messages = [];

  beforeAll(async () => {
    const config = configFor(mode);
    cacheDir = await mkdtemp(path.join(os.tmpdir(), "eduvibe-vite-guard-"));
    server = await createServer({
      ...config,
      configFile: false,
      mode: "test",
      root: frontendRoot,
      cacheDir,
      logLevel: "silent",
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { ...config.server, host: "127.0.0.1", port: 0 },
    });
    // Vite 6's server.listen treats port 0 as the default; bind its native server.
    await new Promise((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, "127.0.0.1", () => {
        server.httpServer.off("error", reject);
        resolve();
      });
    });
    port = server.httpServer.address().port;
    // A live HMR client receives every error event Vite broadcasts.
    socket = new WebSocket(`ws://127.0.0.1:${port}/`, "vite-hmr");
    socket.addEventListener("message", (event) =>
      messages.push(JSON.parse(event.data)),
    );
    await vi.waitFor(() =>
      expect(messages.map((m) => m.type)).toContain("connected"),
    );
  }, 60_000);

  afterAll(async () => {
    socket?.close();
    await server?.close();
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("answers a malformed path with a fixed 400", async () => {
    const res = await raw(port, "GET", "/apps/%E0%A4%A");
    expect(res.status).toBe(400);
    expect(res.type).toBe("text/plain; charset=utf-8");
    expect(res.body).toBe(BODY);
  });

  // In api mode no upstream runs, so a proxied request would fail instead of 400.
  it("rejects a malformed /api path before the proxy", async () => {
    const res = await raw(port, "GET", "/api/%zz");
    expect(res.status).toBe(400);
    expect(res.body).toBe(BODY);
  });

  it("answers a malformed HTML-fallback path and HEAD with 400", async () => {
    const html = await raw(port, "GET", "/apps/%E0%A4%A/", {
      accept: "text/html",
    });
    expect(html.status).toBe(400);
    expect((await raw(port, "HEAD", "/apps/%")).status).toBe(400);
  });

  it("does not broadcast an HMR error to connected clients", async () => {
    await raw(port, "GET", "/apps/%zz");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(messages.map((m) => m.type)).not.toContain("error");
  });

  it.each([
    ["/", 200],
    ["/apps/%E2%9C%93", 200],
    ["/?q=%E0%A4%A", 200],
  ])(
    "still serves %s",
    async (requestPath, status) => {
      const res = await raw(port, "GET", requestPath, { accept: "text/html" });
      expect(res.status).toBe(status);
      expect(res.type).toContain("text/html");
    },
    30_000,
  );
});
