import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { renderNginx, startNginx } from "../scripts/nginx-serving.mjs";

const template = readFileSync("../deploy/nginx/eduvibe.conf.template", "utf8");
const values = {
  RELEASE_ROOT: "/srv/eduvibe/releases/api",
  API_UPSTREAM: "127.0.0.1:8000",
  SERVER_NAME: "localhost",
  HTTPS_AUTHORITY: "localhost:8443",
  HTTP_PORT: "8080",
  HTTPS_PORT: "8443",
  TLS_CERTIFICATE: "/private/tls/cert.pem",
  TLS_CERTIFICATE_KEY: "/private/tls/key.pem",
  RUNTIME_ROOT: "/private/nginx",
  LOG_ROOT: "/private/logs",
};
const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
it("renders fixed deployment tokens while preserving Nginx variables", () => {
  const rendered = renderNginx(template, values);
  expect(rendered).toContain("root /srv/eduvibe/releases/api;");
  expect(rendered).toContain("$remote_addr");
  expect(rendered).toContain("$request_uri");
  expect(rendered).not.toContain("{{");
});
it.each([
  ["RELEASE_ROOT", "/srv/release; return 200"],
  ["TLS_CERTIFICATE", '/tls/"bad"'],
  ["TLS_CERTIFICATE_KEY", "/tls/line\nbreak"],
  ["RUNTIME_ROOT", "relative/path"],
  ["LOG_ROOT", "/srv/eduvibe/releases/api/logs"],
  ["RELEASE_ROOT", "/srv/../private"],
  ["API_UPSTREAM", "attacker.example:8000"],
  ["SERVER_NAME", "localhost *.example"],
  ["HTTPS_AUTHORITY", "evil.example:8443"],
  ["HTTPS_AUTHORITY", "localhost:443"],
  ["HTTP_PORT", "0"],
  ["HTTPS_PORT", "65536"],
])("rejects unsafe template values: %s %s", (name, value) => {
  expect(() => renderNginx(template, { ...values, [name]: value })).toThrow(
    /template value/,
  );
});
it("rejects missing template placeholders", () => {
  expect(() =>
    renderNginx(template.replaceAll("{{RELEASE_ROOT}}", "/fixed"), values),
  ).toThrow(/placeholder/);
  expect(() => renderNginx(template + "{{UNKNOWN}}", values)).toThrow(
    /placeholder/,
  );
  const incomplete = { ...values };
  delete incomplete.TLS_CERTIFICATE_KEY;
  expect(() => renderNginx(template, incomplete)).toThrow(/template value/);
});
it("cleans up failed startup", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nginx-start-test-"));
  temporary.push(directory);
  const executable = path.join(directory, "nginx");
  writeFileSync(
    executable,
    '#!/bin/sh\nfor arg do [ "$arg" = "-t" ] && exit 0; done\nexit 1\n',
  );
  chmodSync(executable, 0o700);
  const previousPath = process.env.PATH;
  process.env.PATH = `${directory}:${previousPath}`;
  const runtime = path.join(directory, "runtime");
  try {
    await expect(
      startNginx({
        ...values,
        RUNTIME_ROOT: runtime,
        LOG_ROOT: path.join(directory, "logs"),
      }),
    ).rejects.toThrow(/Nginx startup failed/);
    expect(existsSync(runtime)).toBe(false);
  } finally {
    process.env.PATH = previousPath;
  }
});

it("renders a deployment configuration from stdin without overwriting an existing file", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "nginx-render-test-"));
  temporary.push(directory);
  const output = path.join(directory, "nginx.conf");
  const result = spawnSync(
    process.execPath,
    ["scripts/nginx-serving.mjs", "--render", output],
    { input: JSON.stringify(values), encoding: "utf8" },
  );
  expect(result.status).toBe(0);
  expect(readFileSync(output, "utf8")).toContain(
    "root /srv/eduvibe/releases/api;",
  );
  const repeat = spawnSync(
    process.execPath,
    ["scripts/nginx-serving.mjs", "--render", output],
    {
      input: JSON.stringify({ ...values, RELEASE_ROOT: "/different" }),
      encoding: "utf8",
    },
  );
  expect(repeat.status).not.toBe(0);
  expect(readFileSync(output, "utf8")).toContain(
    "root /srv/eduvibe/releases/api;",
  );
});
it("rejects unresolved template delimiters", () => {
  expect(() => renderNginx(template + "{{BROKEN", values)).toThrow(
    /placeholder/,
  );
});

it("logs only generated IDs, constant route classes, status and duration", () => {
  expect(template).toContain("log_format eduvibe escape=json");
  const format = template.slice(
    template.indexOf("log_format eduvibe"),
    template.indexOf(";", template.indexOf("log_format eduvibe")),
  );
  expect([...format.matchAll(/\$([a-z_]+)/g)].map((match) => match[1])).toEqual(
    ["request_id", "eduvibe_log_route", "status", "request_time"],
  );
  expect(template).toContain("error_log /dev/null;");
  expect(template).toContain("/nginx-access.log eduvibe;");
});
