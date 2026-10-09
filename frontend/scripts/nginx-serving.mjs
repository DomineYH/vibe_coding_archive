import { spawn, spawnSync } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { get } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const templateFile = path.resolve(
  frontend,
  "../deploy/nginx/eduvibe.conf.template",
);
const tokens = [
  "RELEASE_ROOT",
  "API_UPSTREAM",
  "SERVER_NAME",
  "HTTPS_AUTHORITY",
  "HTTP_PORT",
  "HTTPS_PORT",
  "TLS_CERTIFICATE",
  "TLS_CERTIFICATE_KEY",
  "RUNTIME_ROOT",
  "LOG_ROOT",
];
const paths = [
  "RELEASE_ROOT",
  "TLS_CERTIFICATE",
  "TLS_CERTIFICATE_KEY",
  "RUNTIME_ROOT",
  "LOG_ROOT",
];
const port = (value) => /^[1-9]\d*$/.test(value) && Number(value) <= 65535;

export function renderNginx(template, values) {
  for (const name of tokens) {
    if (typeof values[name] !== "string" || !values[name])
      throw new Error(`Unsafe template value: ${name}`);
    if (!template.includes(`{{${name}}}`))
      throw new Error(`Missing template placeholder: ${name}`);
  }
  for (const name of paths) {
    if (
      !/^\/[a-zA-Z0-9_./-]+$/.test(values[name]) ||
      path.resolve(values[name]) !== values[name]
    )
      throw new Error(`Unsafe template value: ${name}`);
  }
  if (
    values.LOG_ROOT === values.RELEASE_ROOT ||
    values.LOG_ROOT.startsWith(`${values.RELEASE_ROOT}/`)
  )
    throw new Error("Unsafe template value: LOG_ROOT");
  if (
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(values.SERVER_NAME) ||
    values.SERVER_NAME.includes("..")
  )
    throw new Error("Unsafe template value: SERVER_NAME");
  for (const name of ["HTTP_PORT", "HTTPS_PORT"])
    if (!port(values[name])) throw new Error(`Unsafe template value: ${name}`);
  if (values.HTTP_PORT === values.HTTPS_PORT)
    throw new Error("Unsafe template value: HTTP_PORT");
  const upstream = /^(?:127\.0\.0\.1|\[::1\]):([0-9]+)$/.exec(
    values.API_UPSTREAM,
  );
  if (!upstream || !port(upstream[1]))
    throw new Error("Unsafe template value: API_UPSTREAM");
  const authority =
    values.SERVER_NAME +
    (values.HTTPS_PORT === "443" ? "" : `:${values.HTTPS_PORT}`);
  if (values.HTTPS_AUTHORITY !== authority)
    throw new Error("Unsafe template value: HTTPS_AUTHORITY");
  const rendered = template.replace(/\{\{([^{}]+)\}\}/g, (_, name) => {
    if (!tokens.includes(name))
      throw new Error(`Unknown template placeholder: ${name}`);
    return values[name];
  });
  if (rendered.includes("{{") || rendered.includes("}}"))
    throw new Error("Unresolved template placeholder");
  return rendered;
}

export function requireNginxTools() {
  for (const [command, args] of [
    ["nginx", ["-v"]],
    ["openssl", ["version"]],
  ]) {
    const result = spawnSync(command, args, { stdio: "ignore" });
    if (result.error || result.status !== 0)
      throw new Error(
        `Nginx serving NOT RUN: required executable '${command}' is missing or unusable; --nginx never falls back to Vite.`,
      );
  }
}

export async function prepareNginx(parent) {
  requireNginxTools();
  for (const args of [
    ["run", "build"],
    ["run", "check:dist"],
  ]) {
    const result = spawnSync("npm", args, { cwd: frontend, stdio: "inherit" });
    if (result.error || result.status !== 0)
      throw new Error("Checked API release build failed.");
  }
  const directory = await realpath(parent);
  const release = path.join(directory, "nginx-release");
  await cp(path.join(frontend, "dist"), release, { recursive: true });
  const cert = path.join(directory, "cert.pem"),
    key = path.join(directory, "key.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
      "-keyout",
      key,
      "-out",
      cert,
    ],
    { stdio: "ignore" },
  );
  if (result.error || result.status !== 0)
    throw new Error("Test TLS certificate creation failed.");
  await chmod(key, 0o600);
  const values = {
    RELEASE_ROOT: release,
    API_UPSTREAM: "127.0.0.1:8000",
    SERVER_NAME: "localhost",
    HTTPS_AUTHORITY: "localhost:8443",
    HTTP_PORT: "8080",
    HTTPS_PORT: "8443",
    TLS_CERTIFICATE: cert,
    TLS_CERTIFICATE_KEY: key,
    RUNTIME_ROOT: path.join(directory, "nginx-runtime"),
    LOG_ROOT: path.join(directory, "logs"),
  };
  const file = path.join(directory, "nginx-values.json");
  await writeFile(file, JSON.stringify(values), { mode: 0o600, flag: "wx" });
  return {
    API_E2E_NGINX_VALUES: file,
    API_E2E_RELEASE_ROOT: release,
    API_E2E_UPSTREAM_PID: path.join(directory, "upstream.pid"),
    API_E2E_LOG_ROOT: values.LOG_ROOT,
  };
}

function ready(port_) {
  return new Promise((resolve) => {
    const request = get(
      {
        hostname: "127.0.0.1",
        port: port_,
        servername: "localhost",
        path: "/",
        headers: { Host: `localhost:${port_}` },
        rejectUnauthorized: false,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode === 200);
      },
    );
    request.setTimeout(500, () => request.destroy());
    request.on("error", () => resolve(false));
  });
}

export async function startNginx(values) {
  const rendered = renderNginx(await readFile(templateFile, "utf8"), values);
  await mkdir(values.RUNTIME_ROOT, { mode: 0o700 });
  let child,
    exited,
    stopping = false;
  const onSignal = () => {
    stopping = true;
    void stop();
  };
  const stop = async () => {
    if (child && child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    if (exited) await exited;
    await rm(values.RUNTIME_ROOT, { recursive: true, force: true });
    for (const signal of ["SIGINT", "SIGTERM"])
      process.removeListener(signal, onSignal);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, onSignal);
  try {
    await mkdir(values.LOG_ROOT, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    await writeFile(path.join(values.LOG_ROOT, "nginx-access.log"), "", {
      mode: 0o600,
      flag: "wx",
    });
    const config = path.join(values.RUNTIME_ROOT, "nginx.conf");
    await writeFile(config, rendered, { mode: 0o600, flag: "wx" });
    const args = ["-p", `${values.RUNTIME_ROOT}/`, "-c", config];
    const check = spawnSync("nginx", [...args, "-t"], { stdio: "ignore" });
    if (check.error || check.status !== 0)
      throw new Error(
        "Nginx startup failed: configuration check rejected (diagnostics suppressed).",
      );
    child = spawn("nginx", [...args, "-g", "daemon off;"], { stdio: "ignore" });
    let dead = false;
    exited = new Promise((resolve) => {
      child.once("error", () => {
        dead = true;
        resolve();
      });
      child.once("exit", () => {
        dead = true;
        resolve();
      });
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (dead || stopping)
        throw new Error("Nginx startup failed: owned process exited.");
      const pid = await readFile(
        path.join(values.RUNTIME_ROOT, "nginx.pid"),
        "utf8",
      ).catch(() => "");
      if (
        pid.trim() === String(child.pid) &&
        (await ready(values.HTTPS_PORT))
      ) {
        if (dead)
          throw new Error("Nginx startup failed: owned process exited.");
        return { stop, exited };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Nginx startup failed: HTTPS readiness timed out.");
  } catch (error) {
    await stop();
    throw error;
  }
}

async function main() {
  if (process.argv[2] === "--render") {
    const values = JSON.parse(readFileSync(0, "utf8"));
    const rendered = renderNginx(await readFile(templateFile, "utf8"), values);
    await writeFile(process.argv[3], rendered, { mode: 0o600, flag: "wx" });
    return;
  }
  if (process.env.APP_ENV !== "test" || process.env.API_E2E_NGINX !== "1")
    throw new Error(
      "Nginx harness requires the isolated --nginx test environment.",
    );
  if (process.argv[2] === "--upstream") {
    await mkdir(process.env.API_E2E_LOG_ROOT, { mode: 0o700 }).catch(
      (error) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const log = await open(
      path.join(process.env.API_E2E_LOG_ROOT, "upstream.log"),
      "wx",
      0o600,
    );
    const child = spawn(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        `import os
from app.api import run
fd = os.open(os.environ['API_E2E_UPSTREAM_PID'], os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as handle:
    handle.write(str(os.getpid()))
raise SystemExit(run('tests.auth_server:app'))
`,
      ],
      {
        cwd: path.resolve(frontend, "../backend"),
        stdio: ["ignore", log.fd, log.fd],
      },
    );
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      process.exitCode = (await exited) ?? 1;
    } finally {
      await log.close();
      await rm(process.env.API_E2E_UPSTREAM_PID, { force: true });
    }
    return;
  }
  const values = JSON.parse(
    await readFile(process.env.API_E2E_NGINX_VALUES, "utf8"),
  );
  const server = await startNginx(values);
  await server.exited;
  await server.stop();
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    console.error(
      "Nginx harness failed; no development-server fallback (diagnostics suppressed).",
    );
    process.exitCode = 1;
  });
}
