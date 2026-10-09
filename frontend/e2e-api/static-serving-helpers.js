import { test as base, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { connect } from "node:tls";
import { query } from "./helpers.js";

export const test = base.extend({
  rateCleanup: [
    async ({ context }, use) => {
      const rates = query("SELECT * FROM rate_limit_events");
      try {
        await use();
      } finally {
        await context.close();
        const cleanup = spawnSync(
          "uv",
          [
            "run",
            "--frozen",
            "python",
            "-c",
            `import json, os, sqlite3, sys
previous = {tuple(row) for row in json.load(sys.stdin)}
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    for row in db.execute('SELECT * FROM rate_limit_events').fetchall():
        if tuple(row) not in previous:
            db.execute('DELETE FROM rate_limit_events WHERE id=?', (row[0],))
`,
          ],
          {
            cwd: "../backend",
            env: process.env,
            input: JSON.stringify(rates),
            encoding: "utf8",
          },
        );
        expect(cleanup.status, "owned throttle event cleanup").toBe(0);
      }
    },
    { auto: true },
  ],
});

// TLS preserves the target and header bytes browsers would normalize.
export function wire(
  target,
  { method = "GET", headers = [], body = "", fragment = 0 } = {},
) {
  const fields = [...headers];
  if (!fields.some((line) => /^host:/i.test(line)))
    fields.unshift("Host: localhost:8443");
  if (!fields.some((line) => /^connection:/i.test(line)))
    fields.push("Connection: close");
  if (body && !fields.some((line) => /^content-length:/i.test(line)))
    fields.push(`Content-Length: ${Buffer.byteLength(body)}`);
  const request = `${method} ${target} HTTP/1.1\r\n${fields.join("\r\n")}\r\n\r\n${body}`;
  return new Promise((resolve, reject) => {
    const chunks = [];
    const socket = connect({
      host: "127.0.0.1",
      port: 8443,
      servername: "localhost",
      rejectUnauthorized: false,
    });
    socket.setTimeout(12000, () =>
      socket.destroy(new Error("raw HTTPS request timed out")),
    );
    socket.once("secureConnect", () => {
      if (!fragment) socket.write(request);
      else {
        let offset = 0;
        const write = () => {
          if (socket.destroyed || offset >= request.length) return;
          socket.write(request.slice(offset, offset + fragment));
          offset += fragment;
          setImmediate(write);
        };
        write();
      }
    });
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", (error) => {
      if (!chunks.length) reject(error);
    });
    socket.once("close", () => {
      const response = Buffer.concat(chunks).toString("utf8");
      resolve({
        status: Number(/^HTTP\/1\.[01] (\d+)/.exec(response)?.[1] ?? 0),
        response,
      });
    });
  });
}

// Private captures stay in memory; never attach them to Playwright reports.
export async function safeLogCaptures() {
  const { readFile } = await import("node:fs/promises");
  const path = await import("node:path");
  return Promise.all(
    ["nginx-access.log", "upstream.log"].map((name) =>
      readFile(path.join(process.env.API_E2E_LOG_ROOT, name), "utf8"),
    ),
  );
}

export async function withDatabaseWriteLock(operation) {
  const { spawn } = await import("node:child_process");
  const child = spawn(
    "uv",
    [
      "run",
      "--frozen",
      "python",
      "-c",
      `import os, sqlite3, sys
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    db.execute('BEGIN IMMEDIATE')
    print('LOCKED', flush=True)
    sys.stdin.read(1)
`,
    ],
    { cwd: "../backend", stdio: ["pipe", "pipe", "ignore"], env: process.env },
  );
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    await new Promise((resolve, reject) => {
      child.once("error", () => reject(new Error("test database lock failed")));
      child.once("exit", () =>
        reject(new Error("test database lock exited early")),
      );
      child.stdout.once("data", (data) => {
        if (data.toString().trim() === "LOCKED") resolve();
        else reject(new Error("test database lock failed"));
      });
    });
    return await operation();
  } finally {
    child.stdin.end("x");
    await exited;
  }
}
