import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
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
  const arguments_ = process.argv
    .slice(2)
    .filter((arg) => arg !== "--auth-unavailable");
  const authPrepared =
    !process.argv.includes("--auth-unavailable") &&
    arguments_.some((arg) => /auth-(prepare|login|password)/.test(arg));
  const env = {
    ...process.env,
    APP_ENV: "test",
    API_E2E_AUTH_BOUNDARY: authPrepared ? "prepared" : "unavailable",
    DATABASE_PATH: path.join(temporary, "api.sqlite3"),
    PASSWORD_BLOCKLIST_PATH: path.join(temporary, "ncsc.txt"),
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
    if (!process.env.PASSWORD_BLOCKLIST_PATH)
      throw new Error(
        "Set PASSWORD_BLOCKLIST_PATH to the explicitly prepared R15 source.",
      );
    await copyFile(
      process.env.PASSWORD_BLOCKLIST_PATH,
      env.PASSWORD_BLOCKLIST_PATH,
    );
    await chmod(env.PASSWORD_BLOCKLIST_PATH, 0o600);
    // The real CLI and prepared server both verify the complete R15 source.

    const bootstrap = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        `import os
from tests.admin_cli import run_admin_cli
from tests.support import AUTH_PASSWORD
answers = [('Login ID: ', 'first-admin'), ('Nickname: ', '첫 관리자'), ('Temporary password: ', AUTH_PASSWORD), ('Confirm temporary password: ', AUTH_PASSWORD), ('Type YES to confirm: ', 'YES')]
status, output = run_admin_cli('bootstrap-admin', os.environ['DATABASE_PATH'], os.environ['PASSWORD_BLOCKLIST_PATH'], answers)
assert AUTH_PASSWORD not in output
raise SystemExit(status)`,
      ],
      { cwd: backend, env, stdio: "pipe" },
    );
    if (bootstrap.error || bootstrap.status !== 0)
      throw new Error("Test-owned administrator bootstrap failed.");
    const fixtures = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        "import os; from pathlib import Path; from tests.support import populate_auth_members, populate_public_and_private_apps, prepare_issue83_detail_fixture; database_path = Path(os.environ['DATABASE_PATH']); populate_public_and_private_apps(database_path, 27, include_search_edge_cases=True); prepare_issue83_detail_fixture(database_path); populate_auth_members(database_path)",
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

    // Keep the same migrated database across the ordinary and prepared-boundary runs.
    // Fixtures are inserted once; restarting the server cannot repair test authority.
    const runs =
      arguments_.length || process.argv.includes("--auth-unavailable")
        ? [{ arguments_, prepared: authPrepared }]
        : [
            { arguments_, prepared: false },
            {
              arguments_: [
                "e2e-api/auth-prepare.spec.js",
                "e2e-api/auth-login.spec.js",
                "e2e-api/auth-password.spec.js",
              ],
              prepared: true,
            },
          ];
    // Functional contracts always use a moving clock. Only the card captures
    // get a separate server with a fixed clock, including the default CI run.
    const capture = "change-only card and field errors";
    const separated = runs.flatMap((run) => {
      if (
        !run.prepared ||
        !run.arguments_.some((arg) => /auth-password/.test(arg))
      )
        return [run];
      // Preserve explicitly selected cases; they run with the ordinary moving clock.
      if (run.arguments_.some((arg) => /^--grep/.test(arg))) return [run];
      const functional = {
        ...run,
        arguments_: [...run.arguments_, "--grep-invert", capture],
      };
      return [
        functional,
        {
          arguments_: ["e2e-api/auth-password.spec.js", "--grep", capture],
          prepared: true,
          capture: true,
        },
      ];
    });
    for (const run of separated) {
      playwright = spawn(
        path.join(frontend, "node_modules", ".bin", "playwright"),
        ["test", "--config=playwright.api.config.js", ...run.arguments_],
        {
          cwd: frontend,
          env: {
            ...env,
            API_E2E_AUTH_BOUNDARY: run.prepared ? "prepared" : "unavailable",
            API_E2E_CLOCK: run.capture ? "2026-10-01T00:00:00Z" : "",
          },
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
      if (process.exitCode) break;
    }
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
