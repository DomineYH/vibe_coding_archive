import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = path.resolve(frontend, "..");
const backend = path.join(root, "backend");
let playwright;
let receivedSignal;

function signalExitCode() {
  return receivedSignal === "SIGINT" ? 130 : 143;
}

function requireFreePort(port, host) {
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

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    receivedSignal = signal;
    playwright?.kill(signal);
  });
}

async function run() {
  await requireFreePort(8000, "127.0.0.1");
  await requireFreePort(5174, "localhost");

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
    const fixtures = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        "import os; from pathlib import Path; from tests.support import populate_public_and_private_apps, prepare_issue83_detail_fixture; database_path = Path(os.environ['DATABASE_PATH']); populate_public_and_private_apps(database_path, 27, include_search_edge_cases=True); prepare_issue83_detail_fixture(database_path)",
      ],
      { cwd: backend, env, stdio: "inherit" },
    );
    if (fixtures.error) throw fixtures.error;
    if (fixtures.status !== 0)
      throw new Error("The isolated API E2E fixtures could not be created.");
    if (receivedSignal) {
      process.exitCode = signalExitCode();
      return;
    }

    // E2E uses isolated synthetic rows; it never calls the development seed.
    playwright = spawn(
      path.join(frontend, "node_modules", ".bin", "playwright"),
      ["test", "--config=playwright.api.config.js"],
      {
        cwd: frontend,
        env,
        stdio: "inherit",
        detached: process.platform !== "win32",
      },
    );
    const result = await new Promise((resolve, reject) => {
      playwright.once("error", reject);
      playwright.once("exit", (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = receivedSignal
      ? signalExitCode()
      : (result.code ?? (result.signal ? 1 : 0));
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  await run();
} catch (error) {
  console.error(error instanceof Error ? error.message : "API E2E failed.");
  process.exitCode = receivedSignal ? signalExitCode() : 1;
}
