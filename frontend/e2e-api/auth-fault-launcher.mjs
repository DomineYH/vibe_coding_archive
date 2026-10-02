import { spawn, spawnSync } from "node:child_process";
import { chmod, rm } from "node:fs/promises";
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
    { cwd: backend, env: process.env, stdio: "inherit", detached: false },
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
function python(code, ...args) {
  const result = spawnSync(
    "uv",
    ["run", "--frozen", "python", ...code, ...args],
    { cwd: backend, env: process.env, stdio: "pipe" },
  );
  if (result.status !== 0) throw new Error("Private process drill failed");
}
const lifecycle = net.createServer((socket) => {
  let input = "";
  socket.on("data", async (data) => {
    input += data;
    if (!input.includes("\n")) return;
    try {
      const message = JSON.parse(input);
      if (message.action === "snapshot") {
        python([
          "-c",
          "import os, sqlite3; db=sqlite3.connect(os.environ['DATABASE_PATH']); out=sqlite3.connect(os.environ['DATABASE_PATH']+'.snapshot'); db.backup(out); out.close(); db.close()",
        ]);
      } else if (
        message.action === "cli" &&
        message.command === "sweep-pending"
      ) {
        python(["-m", "app.cli", "sweep-pending"]);
      } else if (message.action === "stop") {
        restarting = true;
        await kill();
      } else if (message.action === "restore") {
        if (child.exitCode === null && child.signalCode === null)
          throw new Error("Restore requires stopped server");
        python([
          "-c",
          "import os, sqlite3; source=sqlite3.connect(os.environ['DATABASE_PATH']+'.snapshot'); db=sqlite3.connect(os.environ['DATABASE_PATH']); source.backup(db); db.close(); source.close()",
        ]);
        python(["-m", "app.cli", "invalidate-restored-auth"]);
      } else if (message.action === "restart" || message.action === "start") {
        restarting = true;
        if (message.action === "restart") await kill();
        else if (child.exitCode === null && child.signalCode === null)
          throw new Error("Already running");
        start();
        const deadline = Date.now() + 4000;
        while (!(await probe())) {
          if (Date.now() > deadline)
            throw new Error("Private restart not available");
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        restarting = false;
      } else throw new Error("Unknown process drill");
      socket.end(
        '{"ok":true,"fixtureReinjection":false,"migrationOnRestart":false}\n',
      );
    } catch {
      socket.end(
        '{"error":"private process drill failed; keep auth stopped"}\n',
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
