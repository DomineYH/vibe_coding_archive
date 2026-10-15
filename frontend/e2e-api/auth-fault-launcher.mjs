import {
  ProcessDrillFailure,
  checkProcessResult,
  processOutcome,
} from "./process-failure.mjs";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  open,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startFaultProxy } from "./auth-fault-proxy.mjs";

if (process.env.APP_ENV !== "test" || !process.env.AUTH_FAULT_CONTROL)
  throw new Error("Private fault launcher requires APP_ENV=test.");
const backend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../backend",
);
const reservation = net.createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const upstreamPort = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const resolvedPython = spawnSync(
  "uv",
  ["run", "--frozen", "python", "-c", "import sys; print(sys.executable)"],
  { cwd: backend, env: process.env, encoding: "utf8" },
);
if (resolvedPython.status !== 0) throw new Error("Prepared Python unavailable");
const pythonExecutable = resolvedPython.stdout.trim();
let child;
let activeEnv = process.env;
let activeBackend = backend;
let migrationRoot;
let encryptedRun;
let stopping = false;
let restarting = false;
function start() {
  child = spawn(
    pythonExecutable,
    [
      "-m",
      "uvicorn",
      "tests.auth_fault_server:app",
      "--host",
      "127.0.0.1",
      "--port",
      String(upstreamPort),
      "--no-access-log",
    ],
    { cwd: activeBackend, env: activeEnv, stdio: "inherit", detached: false },
  );
  child.on("exit", () => {
    if (!stopping && !restarting) {
      process.exitCode = 1;
      void stop();
    }
  });
}
async function kill() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(process.env.AUTH_FAULT_CONTROL, { force: true });
}
function probe() {
  return new Promise((resolve) => {
    const request = http.get(
      `http://127.0.0.1:${upstreamPort}/healthz`,
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.on("error", () => resolve(false));
  });
}
function python(stage, code, ...args) {
  const result = spawnSync(
    "uv",
    ["run", "--frozen", "python", ...code, ...args],
    { cwd: backend, env: process.env, stdio: "pipe" },
  );
  checkProcessResult(stage, result, 0);
}
function restoreCli(command, expected, env, ...args) {
  const result = spawnSync(
    pythonExecutable,
    ["-m", "app.cli", command, ...args],
    {
      cwd: backend,
      env,
      stdio: "pipe",
    },
  );
  return checkProcessResult(command, result, expected);
}
async function encryptedBackup() {
  if (activeEnv !== process.env) throw new Error("Original server required");
  const root = path.join(
    path.dirname(process.env.DATABASE_PATH),
    `restore-${randomUUID()}`,
  );
  for (const directory of [
    root,
    path.join(root, "keys"),
    path.join(root, "backups"),
    path.join(root, "target"),
  ])
    await mkdir(directory, { mode: 0o700 });
  const identity = path.join(root, "keys", "identity.txt");
  const keyFile = await open(identity, "wx", 0o600);
  try {
    const generated = spawnSync("age-keygen", [], {
      stdio: ["ignore", keyFile.fd, "ignore"],
    });
    checkProcessResult("age-keygen-identity", generated, 0);
  } finally {
    await keyFile.close();
  }
  const recipient = spawnSync("age-keygen", ["-y", identity], {
    stdio: "pipe",
  });
  checkProcessResult("age-keygen-recipient", recipient, 0);
  const recipientFile = path.join(root, "keys", "recipients.txt");
  await writeFile(recipientFile, recipient.stdout, { mode: 0o600, flag: "wx" });
  const runId = randomUUID();
  restoreCli(
    "backup-db",
    3,
    process.env,
    "--output-dir",
    path.join(root, "backups"),
    "--recipient-file",
    recipientFile,
    "--release-id",
    "test-restore.198",
    "--run-id",
    runId,
  );
  encryptedRun = {
    root,
    identity,
    backup: path.join(root, "backups", runId),
    target: path.join(root, "target", "restored.sqlite3"),
    ledger: process.env.DATABASE_PATH.replace(/\.[^.]+$/, ".deletions.sqlite3"),
  };
}
async function encryptedRestore(fault) {
  if (!encryptedRun || (child.exitCode === null && child.signalCode === null))
    throw new Error("Encrypted restore requires stopped server");
  let identity = encryptedRun.identity;
  let ledger = encryptedRun.ledger;
  if (fault === "wrong-key") {
    identity = path.join(encryptedRun.root, "keys", "wrong.txt");
    const file = await open(identity, "wx", 0o600);
    try {
      checkProcessResult(
        "age-keygen-identity",
        spawnSync("age-keygen", [], { stdio: ["ignore", file.fd, "ignore"] }),
        0,
      );
    } finally {
      await file.close();
    }
  } else if (fault === "ciphertext") {
    const file = path.join(encryptedRun.backup, "backup.tar.age");
    const raw = await readFile(file);
    await writeFile(file, raw.subarray(0, raw.length - 100));
  } else if (fault === "ledger") {
    ledger = path.join(encryptedRun.root, "keys", "bad.deletions.sqlite3");
    await writeFile(ledger, "invalid independent evidence", {
      mode: 0o600,
      flag: "wx",
    });
  } else if (fault) throw new Error("Unknown restore fault");
  const env = {
    ...process.env,
    DATABASE_PATH: encryptedRun.target,
    HEALTH_CHECKS_ENABLED: "false",
  };
  restoreCli(
    "restore-db",
    fault ? 1 : 3,
    env,
    "--backup-dir",
    encryptedRun.backup,
    "--identity-file",
    identity,
    "--ledger-file",
    ledger,
  );
  activeEnv = env;
}
const lifecycle = net.createServer((socket) => {
  let input = "";
  socket.on("data", async (data) => {
    input += data;
    if (!input.includes("\n")) return;
    let stage = "control";
    try {
      const message = JSON.parse(input);
      stage = message.action;
      let details = {};
      if (message.action === "migration-status") {
        const result = spawnSync(
          pythonExecutable,
          [
            "-c",
            `import hashlib, json, os, sqlite3
from pathlib import Path
def digest(database, tables):
    with sqlite3.connect(database) as db:
        values = {table: sorted(db.execute(f'SELECT * FROM "{table}"').fetchall(), key=repr) for table in tables}
    return hashlib.sha256(json.dumps(values, sort_keys=True).encode()).hexdigest()
database = Path(os.environ['DATABASE_PATH'])
ledger = database.with_suffix('.deletions.sqlite3')
with sqlite3.connect(ledger) as db:
    tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
    count = db.execute('SELECT count(*) FROM completed_app_delete_events').fetchone()[0]
print(json.dumps({'businessDigest': digest(database, ('members','apps','app_grades')), 'ledgerDigest': digest(ledger, tables), 'deletionEvents': count}))`,
          ],
          {
            cwd: activeBackend,
            env: activeEnv,
            stdio: "pipe",
          },
        );
        checkProcessResult("migration-status", result, 0);
        details = JSON.parse(result.stdout);
      } else if (message.action === "migration-block") {
        if (activeEnv !== process.env)
          throw new Error("Original target required");
        restoreCli("maintenance-block", 0, activeEnv);
        if (!migrationRoot) {
          migrationRoot = path.join(
            path.dirname(activeEnv.DATABASE_PATH),
            `migration-${randomUUID()}`,
          );
          await mkdir(migrationRoot, { mode: 0o700 });
          for (const release of ["release-one", "release-two"])
            await symlink(backend, path.join(migrationRoot, release), "dir");
          await symlink(
            "release-one",
            path.join(migrationRoot, "current"),
            "dir",
          );
        }
        activeBackend = path.join(migrationRoot, "current");
      } else if (message.action === "encrypted-backup") {
        await encryptedBackup();
      } else if (message.action === "encrypted-restore") {
        await encryptedRestore(message.fault);
      } else if (message.action === "verify-restore") {
        restoreCli(
          "verify-restore",
          3,
          activeEnv,
          "--backup-dir",
          encryptedRun.backup,
          "--identity-file",
          encryptedRun.identity,
          "--ledger-file",
          encryptedRun.ledger,
        );
      } else if (message.action === "restore-status") {
        const ids = message.ids;
        if (
          !Array.isArray(ids) ||
          !ids.every((id) => /^[0-9a-f-]{36}$/.test(id))
        )
          throw new Error("Invalid fixture IDs");
        const result = spawnSync(
          pythonExecutable,
          [
            "-c",
            `import json, os, sqlite3, sys
ids = json.loads(sys.argv[1])
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    marks = ','.join('?' for _ in ids)
    counts = {table: db.execute(f'SELECT count(*) FROM {table} WHERE id IN ({marks})', ids).fetchone()[0] for table in ('members','apps')}
    counts['live_authority'] = sum(db.execute(f'SELECT count(*) FROM {table} WHERE revoked_at IS NULL').fetchone()[0] for table in ('auth_flows','sessions','recovery_credentials'))
    counts['write_operations'] = db.execute('SELECT count(*) FROM write_operations').fetchone()[0]
print(json.dumps(counts))`,
            JSON.stringify(ids),
          ],
          { cwd: backend, env: activeEnv, stdio: "pipe" },
        );
        checkProcessResult("restore-status", result, 0);
        details = JSON.parse(result.stdout);
      } else if (message.action === "normal-target") {
        restarting = true;
        await kill();
        activeEnv = process.env;
        start();
        const deadline = Date.now() + 4000;
        while (!(await probe())) {
          if (Date.now() > deadline)
            throw new ProcessDrillFailure("normal-target", {
              ...processOutcome({
                status: child.exitCode,
                signal: child.signalCode,
              }),
              reason: "readiness-timeout",
            });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        restarting = false;
      } else if (message.action === "snapshot") {
        python("snapshot", [
          "-c",
          "import os, sqlite3; db=sqlite3.connect(os.environ['DATABASE_PATH']); out=sqlite3.connect(os.environ['DATABASE_PATH']+'.snapshot'); db.backup(out); out.close(); db.close()",
        ]);
      } else if (
        message.action === "cli" &&
        message.command === "sweep-pending"
      ) {
        python("sweep-pending", ["-m", "app.cli", "sweep-pending"]);
      } else if (message.action === "stop") {
        restarting = true;
        await kill();
      } else if (message.action === "restore") {
        if (child.exitCode === null && child.signalCode === null)
          throw new Error("Restore requires stopped server");
        python("restore-snapshot", [
          "-c",
          "import os, sqlite3; source=sqlite3.connect(os.environ['DATABASE_PATH']+'.snapshot'); db=sqlite3.connect(os.environ['DATABASE_PATH']); source.backup(db); db.close(); source.close()",
        ]);
        python("invalidate-restored-auth", [
          "-m",
          "app.cli",
          "invalidate-restored-auth",
        ]);
      } else if (
        ["restart", "start", "migration-resume"].includes(message.action)
      ) {
        restarting = true;
        if (
          message.action === "restart" ||
          message.action === "migration-resume"
        )
          await kill();
        else if (child.exitCode === null && child.signalCode === null)
          throw new Error("Already running");
        if (message.action === "migration-resume") {
          if (activeEnv !== process.env)
            throw new Error("Original target required");
          const parent = path.dirname(activeEnv.DATABASE_PATH);
          await rm(path.join(parent, ".migration-blocked"), { force: true });
          if (migrationRoot) {
            const candidate = path.join(migrationRoot, "next");
            await symlink("release-two", candidate, "dir");
            await rename(candidate, path.join(migrationRoot, "current"));
            const directory = await open(migrationRoot, "r");
            try {
              await directory.sync();
            } finally {
              await directory.close();
            }
            details.releaseSwitched =
              (await readlink(path.join(migrationRoot, "current"))) ===
              "release-two";
          }
          const directory = await open(parent, "r");
          try {
            await directory.sync();
          } finally {
            await directory.close();
          }
        }
        start();
        const deadline = Date.now() + 4000;
        while (!(await probe())) {
          if (Date.now() > deadline)
            throw new ProcessDrillFailure(stage, {
              ...processOutcome({
                status: child.exitCode,
                signal: child.signalCode,
              }),
              reason: "readiness-timeout",
            });
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        restarting = false;
      } else throw new Error("Unknown process drill");
      socket.end(
        JSON.stringify({
          ok: true,
          fixtureReinjection: false,
          migrationOnRestart: false,
          ...details,
        }) + "\n",
      );
    } catch (error) {
      const failure =
        error instanceof ProcessDrillFailure
          ? error
          : new ProcessDrillFailure(stage);
      console.error(failure.message);
      socket.end(
        JSON.stringify({
          error: "private process drill failed; keep auth stopped",
          failure: failure.failure,
        }) + "\n",
      );
    }
  });
});
await new Promise((resolve) =>
  lifecycle.listen(process.env.AUTH_PROCESS_CONTROL, resolve),
);
await chmod(process.env.AUTH_PROCESS_CONTROL, 0o600);
start();
const proxy = await startFaultProxy({
  port: 8000,
  upstreamPort,
  controlPath: process.env.AUTH_PROXY_CONTROL,
});
async function stop() {
  if (stopping) return;
  stopping = true;
  await kill();
  await proxy.close();
  await new Promise((resolve) => lifecycle.close(resolve));
  for (const key of [
    "AUTH_FAULT_CONTROL",
    "AUTH_PROXY_CONTROL",
    "AUTH_PROCESS_CONTROL",
  ])
    await rm(process.env[key], { force: true });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
