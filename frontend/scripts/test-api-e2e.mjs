import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prepareNginx, requireNginxTools } from "./nginx-serving.mjs";

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
  const nginx = process.argv.includes("--nginx");
  if (
    nginx &&
    process.argv
      .slice(2)
      .some(
        (arg) =>
          /auth-|admin-apps-empty|health-real/.test(arg) ||
          (/\.spec\.js$/.test(arg) && !arg.endsWith("static-serving.spec.js")),
      )
  )
    throw new Error(
      "--nginx requires an isolated static-serving run; fault/health/unavailable modes cannot be mixed.",
    );
  if (
    !nginx &&
    process.argv.some((arg) => arg.includes("static-serving.spec.js"))
  )
    throw new Error("static-serving.spec.js requires --nginx.");
  if (nginx) requireNginxTools();
  await requireFreePort(8000, "127.0.0.1");
  if (nginx) {
    await requireFreePort(8080, "0.0.0.0");
    await requireFreePort(8443, "0.0.0.0");
  } else await requireFreePort(5174, "localhost");

  const temporary = await mkdtemp(path.join(os.tmpdir(), "eduvibe-api-e2e-"));
  const emptyOnly = process.argv.includes("--admin-apps-empty");
  const arguments_ = process.argv
    .slice(2)
    .filter(
      (arg) =>
        arg !== "--auth-unavailable" &&
        arg !== "--admin-apps-empty" &&
        arg !== "--nginx",
    );
  const authPrepared =
    nginx ||
    (!process.argv.includes("--auth-unavailable") &&
      arguments_.some((arg) =>
        /health-real|auth-(candidate|support|prepare|login|reauth|password|register|lifecycle|access|races|recovery)|admin-(apps|approval|password-reset|user-delete)|app-(create|edit|delete)/.test(
          arg,
        ),
      ));
  const env = {
    ...process.env,
    APP_ENV: "test",
    HEALTH_CHECKS_ENABLED: "false",
    SUPPORT_EMAIL: "",
    SUPPORT_SERVICE_URL: "",
    SUPPORT_ANNOUNCEMENT_URL: "",
    API_E2E_SUPPORT_MODE: "",
    API_E2E_AGE_AVAILABLE:
      spawnSync("age", ["--version"], { stdio: "ignore" }).status === 0 &&
      spawnSync("age-keygen", ["--version"], { stdio: "ignore" }).status === 0
        ? "1"
        : "",
    API_E2E_AUTH_BOUNDARY: authPrepared ? "prepared" : "unavailable",
    API_E2E_TEMP_ROOT: temporary,
    DATABASE_PATH: path.join(temporary, "api.sqlite3"),
    PASSWORD_BLOCKLIST_PATH: path.join(temporary, "ncsc.txt"),
    PASSWORD_RESET_HMAC_PATH: path.join(temporary, "reset-hmac.json"),
    PUBLIC_ORIGIN: nginx ? "https://localhost:8443" : "http://localhost:5174",
    API_E2E_NGINX: nginx ? "1" : "",
    ...(nginx
      ? {
          HEALTH_CHECKS_ENABLED: "false",
          HEALTH_ACTIVATION_PATH: path.join(temporary, "no-activation.json"),
        }
      : {}),
    AUTH_FAULT_CONTROL: path.join(temporary, "auth-control.sock"),
    AUTH_PROXY_CONTROL: path.join(temporary, "proxy-control.sock"),
    AUTH_PROCESS_CONTROL: path.join(temporary, "process-control.sock"),
  };

  try {
    if (nginx) Object.assign(env, await prepareNginx(temporary));
    const secret = randomBytes(32);
    await writeFile(
      env.PASSWORD_RESET_HMAC_PATH,
      JSON.stringify({
        secret_hex: secret.toString("hex"),
        key_id: createHash("sha256").update(secret).digest("hex"),
      }),
      { mode: 0o600, flag: "wx" },
    );
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
    // The monitor lists every app, so the true empty-list proof owns a separate
    // zero-app database: the bootstrapped administrator only, no app fixtures.
    const emptyTemplate = path.join(temporary, "empty-apps.sqlite3");
    await copyFile(env.DATABASE_PATH, emptyTemplate);
    const emptyCheck = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        "import os, sqlite3, sys; c = sqlite3.connect(sys.argv[1]); sys.exit(0 if c.execute('SELECT count(*) FROM apps').fetchone()[0] == 0 else 1)",
        emptyTemplate,
      ],
      { cwd: backend, env, stdio: "inherit" },
    );
    if (emptyCheck.error || emptyCheck.status !== 0)
      throw new Error("The zero-app API E2E database is not empty.");
    if (!emptyOnly) {
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
    }
    if (receivedSignal) {
      process.exitCode = signalExitCode();
      return;
    }

    // Each independent Playwright run starts from the same verified test-owned
    // database. In-process restart/restore drills never reinsert fixtures.
    const template = path.join(temporary, "prepared.sqlite3");
    if (!emptyOnly) await copyFile(env.DATABASE_PATH, template);
    const normal = [
      "e2e-api/auth-prepare.spec.js",
      "e2e-api/auth-login.spec.js",
      "e2e-api/auth-reauth.spec.js",
      "e2e-api/auth-password.spec.js",
      "e2e-api/auth-register.spec.js",
      "e2e-api/admin-approval.spec.js",
      "e2e-api/admin-password-reset.spec.js",
      "e2e-api/admin-password-reset-recovery.spec.js",
      "e2e-api/admin-user-delete.spec.js",
      "e2e-api/admin-user-delete-recovery.spec.js",
      "e2e-api/admin-apps.spec.js",
      "e2e-api/admin-apps-recovery.spec.js",
      "e2e-api/admin-apps-manage.spec.js",
      "e2e-api/admin-apps-manage-recovery.spec.js",
      "e2e-api/auth-lifecycle.spec.js",
      "e2e-api/auth-access.spec.js",
      "e2e-api/app-create.spec.js",
      "e2e-api/app-edit.spec.js",
      "e2e-api/app-delete.spec.js",
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
    const isSupport = (arg) => /auth-support/.test(arg);
    const selectedSupport = arguments_.filter(isSupport);
    const supportRuns = (files, prepared = true) =>
      files.flatMap((file) =>
        (prepared ? [true, false] : [false]).map((enabled) => ({
          arguments_: [file, ...options],
          prepared: enabled,
          faults: false,
          support: true,
        })),
      );
    const isCandidate = (arg) => /auth-candidate/.test(arg);
    const selectedCandidate = arguments_.filter(isCandidate);
    const isFault = (arg) => /auth-(races|recovery)/.test(arg);
    const isHealth = (arg) => /health-real/.test(arg);
    const selectedFaults = arguments_.filter(isFault);
    const selectedHealth = arguments_.filter(isHealth);
    const selectedNormal = arguments_.filter(
      (arg) =>
        !isFault(arg) && !isHealth(arg) && !isCandidate(arg) && !isSupport(arg),
    );
    const normalFiles = selectedNormal.filter((arg) => /\.spec\.js$/.test(arg));
    const options = selectedNormal.filter((arg) => !/\.spec\.js$/.test(arg));
    const emptyRun = (files) => ({
      arguments_: files,
      prepared: true,
      faults: false,
      empty: true,
    });
    const runs = emptyOnly
      ? [
          emptyRun(
            arguments_.length
              ? arguments_
              : ["e2e-api/admin-apps-empty.spec.js"],
          ),
        ]
      : arguments_.length || process.argv.includes("--auth-unavailable")
        ? [
            ...(normalFiles.length ||
            (!selectedFaults.length &&
              !selectedHealth.length &&
              !selectedCandidate.length &&
              !selectedSupport.length)
              ? [
                  {
                    arguments_: selectedNormal,
                    prepared: authPrepared,
                    faults: false,
                  },
                ]
              : []),
            ...supportRuns(selectedSupport, authPrepared),
            ...selectedCandidate.flatMap((file) =>
              (authPrepared
                ? ["approved", "pending", "invalid", "revoked"]
                : ["pending"]
              ).map((candidate) => ({
                arguments_: [file, ...options],
                prepared: authPrepared,
                faults: false,
                candidate,
              })),
            ),
            ...(selectedFaults.length
              ? [
                  {
                    arguments_: [...selectedFaults, ...options],
                    prepared: true,
                    faults: true,
                  },
                ]
              : []),
            ...(selectedHealth.length
              ? [
                  {
                    arguments_: [...selectedHealth, ...options],
                    prepared: true,
                    faults: false,
                    health: true,
                  },
                ]
              : []),
          ]
        : [
            {
              arguments_: ["^(?!.*auth-support).*\\.spec\\.js$"],
              prepared: false,
              faults: false,
            },
            ...supportRuns(["e2e-api/auth-support.spec.js"]),
            { arguments_: normal, prepared: true, faults: false },
            ...["approved", "pending", "invalid", "revoked"].map(
              (candidate) => ({
                arguments_: ["e2e-api/auth-candidate.spec.js"],
                prepared: true,
                faults: false,
                candidate,
              }),
            ),
            { arguments_: faults, prepared: true, faults: true },
            {
              arguments_: ["e2e-api/health-real.spec.js"],
              prepared: true,
              faults: false,
              health: true,
            },
            emptyRun(["e2e-api/admin-apps-empty.spec.js"]),
          ];
    const selectedRuns = nginx
      ? [
          {
            arguments_: arguments_.some((arg) => /\.spec\.js$/.test(arg))
              ? arguments_
              : ["e2e-api/static-serving.spec.js", ...arguments_],
            prepared: true,
            faults: false,
          },
        ]
      : runs;
    // Functional contracts always use a moving clock. Only the card captures
    // get a separate server with a fixed clock, including the default CI run.
    const capture =
      "change-only card and field errors|registration cards|administrator approval cards|private access states|integration recovery captures";
    const separated = selectedRuns.flatMap((run) => {
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
            ...options,
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
      await mkdir(runDirectory, { mode: 0o700 });
      const runEnv = {
        ...env,
        ...(run.support
          ? {
              API_E2E_SUPPORT_MODE: "configured",
              SUPPORT_EMAIL: "support@example.test",
              SUPPORT_SERVICE_URL: "https://service.example.test/help",
              SUPPORT_ANNOUNCEMENT_URL: "https://notice.example.test/updates",
            }
          : {}),
        DATABASE_PATH: path.join(runDirectory, "api.sqlite3"),
        AUTH_FAULT_CONTROL: path.join(runDirectory, "auth-control.sock"),
        AUTH_PROXY_CONTROL: path.join(runDirectory, "proxy-control.sock"),
        AUTH_PROCESS_CONTROL: path.join(runDirectory, "process-control.sock"),
        HEALTH_WORKER_LOCK_PATH: path.join(runDirectory, "health-worker.lock"),
      };
      await copyFile(
        run.empty ? emptyTemplate : template,
        runEnv.DATABASE_PATH,
      );
      await chmod(runEnv.DATABASE_PATH, 0o600);
      if (run.candidate) {
        runEnv.AUTH_ACTIVATION_PATH = path.join(
          runDirectory,
          "synthetic-auth.json",
        );
        runEnv.APP_RELEASE_ID = "synthetic-api-e2e-release";
        runEnv.API_E2E_CANDIDATE_STATUS = run.candidate;
        const fixture = spawnSync(
          "uv",
          [
            "run",
            "--frozen",
            "python",
            "-c",
            "import os; from app.settings import Settings; from tests.auth_candidate import write_fixture; write_fixture(Settings.from_environment(), os.environ['API_E2E_CANDIDATE_STATUS'])",
          ],
          { cwd: backend, env: runEnv, stdio: "inherit" },
        );
        if (fixture.error || fixture.status !== 0)
          throw new Error("Synthetic candidate fixture preparation failed.");
      }
      playwright = spawn(
        path.join(frontend, "node_modules", ".bin", "playwright"),
        ["test", "--config=playwright.api.config.js", ...run.arguments_],
        {
          cwd: frontend,
          env: {
            ...runEnv,
            API_E2E_AUTH_BOUNDARY: run.prepared ? "prepared" : "unavailable",
            API_E2E_FAULTS: run.faults ? "1" : "",
            API_E2E_HEALTH: run.health ? "1" : "",
            API_E2E_EMPTY_APPS: run.empty ? "1" : "",
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
