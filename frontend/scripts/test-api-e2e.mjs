import { spawn, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
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
    // Playwright's runner handles SIGINT with web-server teardown; SIGTERM
    // would terminate it before its separately grouped servers are stopped.
    playwright?.kill("SIGINT");
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
    arguments_.some((arg) =>
      /auth-(prepare|login|password|register|lifecycle|access|races|recovery)|admin-approval|app-create/.test(
        arg,
      ),
    );
  const env = {
    ...process.env,
    APP_ENV: "test",
    API_E2E_AUTH_BOUNDARY: authPrepared ? "prepared" : "unavailable",
    API_E2E_TEMP_ROOT: temporary,
    DATABASE_PATH: path.join(temporary, "api.sqlite3"),
    PASSWORD_BLOCKLIST_PATH: path.join(temporary, "ncsc.txt"),
    PUBLIC_ORIGIN: "http://localhost:5174",
    AUTH_FAULT_CONTROL: path.join(temporary, "auth-control.sock"),
    AUTH_PROXY_CONTROL: path.join(temporary, "proxy-control.sock"),
    AUTH_PROCESS_CONTROL: path.join(temporary, "process-control.sock"),
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
        "import os; from pathlib import Path; from tests.support import populate_auth_members, populate_public_and_private_apps, prepare_issue83_detail_fixture; database_path = Path(os.environ['DATABASE_PATH']); populate_public_and_private_apps(database_path, 27, include_search_edge_cases=True); prepare_issue83_detail_fixture(database_path); populate_auth_members(database_path); from tests.approval_fixtures import populate_approval_members; populate_approval_members(database_path); from tests.access_fixtures import populate_access_apps; populate_access_apps(database_path)",
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

    // Each independent Playwright run starts from the same verified test-owned
    // database. In-process restart/restore drills never reinsert fixtures.
    const template = path.join(temporary, "prepared.sqlite3");
    await copyFile(env.DATABASE_PATH, template);
    const normal = [
      "e2e-api/auth-prepare.spec.js",
      "e2e-api/auth-login.spec.js",
      "e2e-api/auth-password.spec.js",
      "e2e-api/auth-register.spec.js",
      "e2e-api/admin-approval.spec.js",
      "e2e-api/auth-lifecycle.spec.js",
      "e2e-api/auth-access.spec.js",
      "e2e-api/app-create.spec.js",
    ];
    const faults = [
      "e2e-api/auth-races.spec.js",
      "e2e-api/auth-races-orders.spec.js",
      "e2e-api/auth-recovery.spec.js",
      "e2e-api/auth-recovery-members.spec.js",
      "e2e-api/auth-recovery-process.spec.js",
      "e2e-api/auth-recovery-boundaries.spec.js",
      "e2e-api/auth-recovery-captures.spec.js",
    ];
    const isFault = (arg) => /auth-(races|recovery)/.test(arg);
    const selectedFaults = arguments_.filter(isFault);
    const selectedNormal = arguments_.filter((arg) => !isFault(arg));
    const normalFiles = selectedNormal.filter((arg) => /\.spec\.js$/.test(arg));
    const options = selectedNormal.filter((arg) => !/\.spec\.js$/.test(arg));
    const runs =
      arguments_.length || process.argv.includes("--auth-unavailable")
        ? [
            ...(normalFiles.length || !selectedFaults.length
              ? [
                  {
                    arguments_: selectedNormal,
                    prepared: authPrepared,
                    faults: false,
                  },
                ]
              : []),
            ...(selectedFaults.length
              ? [
                  {
                    arguments_: [...selectedFaults, ...options],
                    prepared: true,
                    faults: true,
                  },
                ]
              : []),
          ]
        : [
            { arguments_: [], prepared: false, faults: false },
            { arguments_: normal, prepared: true, faults: false },
            { arguments_: faults, prepared: true, faults: true },
          ];
    // Functional contracts always use a moving clock. Only the card captures
    // get a separate server with a fixed clock, including the default CI run.
    const capture =
      "change-only card and field errors|registration cards|administrator approval cards|private access states|integration recovery captures";
    const separated = runs.flatMap((run) => {
      if (
        !run.prepared ||
        !run.arguments_.some((arg) =>
          /auth-(password|register|access|recovery-captures)|admin-approval/.test(
            arg,
          ),
        )
      )
        return [run];
      // Preserve explicitly selected cases; they run with the ordinary moving clock.
      if (run.arguments_.some((arg) => /^--grep/.test(arg))) return [run];
      const functional = {
        ...run,
        arguments_: [...run.arguments_, "--grep-invert", capture],
      };
      return [
        ...(run.arguments_.some(
          (arg) =>
            /\.spec\.js$/.test(arg) && !/auth-recovery-captures/.test(arg),
        )
          ? [functional]
          : []),
        {
          arguments_: [
            ...run.arguments_.filter((arg) =>
              /auth-(password|register|access|recovery-captures)|admin-approval/.test(
                arg,
              ),
            ),
            "--grep",
            capture,
          ],
          prepared: true,
          faults: run.faults,
          capture: true,
        },
      ];
    });
    for (const [index, run] of separated.entries()) {
      const runDirectory = path.join(temporary, `run-${index}`);
      await mkdir(runDirectory);
      const runEnv = {
        ...env,
        DATABASE_PATH: path.join(runDirectory, "api.sqlite3"),
        AUTH_FAULT_CONTROL: path.join(runDirectory, "auth-control.sock"),
        AUTH_PROXY_CONTROL: path.join(runDirectory, "proxy-control.sock"),
        AUTH_PROCESS_CONTROL: path.join(runDirectory, "process-control.sock"),
      };
      await copyFile(template, runEnv.DATABASE_PATH);
      playwright = spawn(
        path.join(frontend, "node_modules", ".bin", "playwright"),
        ["test", "--config=playwright.api.config.js", ...run.arguments_],
        {
          cwd: frontend,
          env: {
            ...runEnv,
            API_E2E_AUTH_BOUNDARY: run.prepared ? "prepared" : "unavailable",
            API_E2E_FAULTS: run.faults ? "1" : "",
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
