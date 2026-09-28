import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(frontend, "..");
const backend = path.join(root, "backend");
const children = new Set();
let interrupted = false;

function freePort(port, host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) => {
      if (error.code === "EADDRINUSE")
        reject(new Error(`Required API E2E port ${port} is already in use.`));
      else reject(error);
    });
    server.listen(port, host, () => server.close(resolve));
  });
}

function start(command, args, { cwd, env, inherit = false }) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: inherit ? "inherit" : "ignore",
  });
  children.add(child);
  child.once("exit", () => children.delete(child));
  return child;
}

function stop(child) {
  if (!child.pid) return Promise.resolve();
  const signal = (name) => {
    try {
      if (process.platform === "win32") child.kill(name);
      else process.kill(-child.pid, name);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  signal("SIGTERM");
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      signal("SIGKILL");
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal("SIGKILL");
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      signal("SIGKILL");
      resolve();
    });
  });
}

function handleInterrupt() {
  interrupted = true;
  void Promise.all([...children].map(stop));
}

async function waitFor(url, child, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (interrupted) throw new Error("API E2E was interrupted.");
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`${label} exited before becoming ready.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.ok) return;
    } catch {
      // The process may need a moment to bind its fixed port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not become ready on its fixed port.`);
}

async function run() {
  await freePort(8000, "127.0.0.1");
  await freePort(5174, "localhost");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "eduvibe-api-e2e-"));
  const env = {
    ...process.env,
    APP_ENV: "test",
    DATABASE_PATH: path.join(temporary, "api.sqlite3"),
    PUBLIC_ORIGIN: "http://localhost:5174",
  };
  try {
    const migration = spawnSync(
      "uv",
      ["run", "--frozen", "alembic", "upgrade", "head"],
      { cwd: backend, env, stdio: "inherit" },
    );
    if (migration.error) throw migration.error;
    if (migration.status !== 0)
      throw new Error("The isolated API E2E database migration failed.");

    // T02 serves metadata only; T03 owns app rows and their fixtures.
    const api = start(
      "uv",
      [
        "run",
        "--frozen",
        "uvicorn",
        "app.main:app",
        "--host",
        "127.0.0.1",
        "--port",
        "8000",
      ],
      { cwd: backend, env },
    );
    await waitFor("http://127.0.0.1:8000/healthz", api, "API process");

    const web = start("npm", ["run", "dev:api"], {
      cwd: frontend,
      env: { ...env, VITE_DATA_MODE: "api" },
    });
    await waitFor("http://localhost:5174/", web, "API-mode screen");

    const playwright = start(
      path.join(frontend, "node_modules", ".bin", "playwright"),
      ["test", "--config=playwright.api.config.js"],
      { cwd: frontend, env: { ...env, VITE_DATA_MODE: "api" }, inherit: true },
    );
    const result = await new Promise((resolve, reject) => {
      playwright.once("error", reject);
      playwright.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (result.code !== 0)
      throw new Error(
        `API E2E browser checks failed (${result.code ?? result.signal}).`,
      );
  } finally {
    await Promise.all([...children].map(stop));
    await rm(temporary, { recursive: true, force: true });
  }
}

process.on("SIGINT", handleInterrupt);
process.on("SIGTERM", handleInterrupt);

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "API E2E failed.");
  process.exitCode = interrupted ? 130 : 1;
}
