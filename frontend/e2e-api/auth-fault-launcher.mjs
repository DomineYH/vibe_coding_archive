import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
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
const child = spawn(
  "uv",
  [
    "run",
    "--frozen",
    "python",
    "-m",
    "uvicorn",
    "tests.auth_fault_server:app",
    "--host",
    "127.0.0.1",
    "--port",
    String(upstreamPort),
    "--no-access-log",
  ],
  { cwd: backend, env: process.env, stdio: "inherit" },
);
const proxy = await startFaultProxy({
  port: 8000,
  upstreamPort,
  controlPath: process.env.AUTH_PROXY_CONTROL,
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  await proxy.close();
  if (child.exitCode === null)
    await new Promise((resolve) => child.once("exit", resolve));
  clearTimeout(timer);
  await rm(process.env.AUTH_FAULT_CONTROL, { force: true });
  await rm(process.env.AUTH_PROXY_CONTROL, { force: true });
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", () => {
  if (!stopping) {
    process.exitCode = 1;
    void stop();
  }
});
