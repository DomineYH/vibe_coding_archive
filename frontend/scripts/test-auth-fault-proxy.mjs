import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { startFaultProxy } from "../e2e-api/auth-fault-proxy.mjs";
import { control } from "../e2e-api/fault-control.mjs";

for (const stage of [
  "before_forward",
  "before_headers",
  "after_headers",
  "mid_body",
]) {
  test(`streaming ${stage} preserves raw cookies without a proxy cookie jar`, async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "auth-proxy-check-"),
    );
    const socket = path.join(directory, "control.sock");
    const ingress = [];
    const upstream = http.createServer((request, response) => {
      ingress.push(request.headers.cookie ?? null);
      response.writeHead(200, [
        "Set-Cookie",
        "first=synthetic; Path=/; HttpOnly; SameSite=Lax",
        "Set-Cookie",
        "second=synthetic; Path=/; HttpOnly; SameSite=Lax",
        "Content-Length",
        "11",
      ]);
      response.end('{"ok":true}');
    });
    await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startFaultProxy({
      port: 0,
      upstreamPort: upstream.address().port,
      controlPath: socket,
    });
    try {
      await control(socket, { action: "arm", path: "/test", stage });
      let headers = false;
      let bytes = 0;
      const request = () =>
        new Promise((resolve, reject) => {
          http
            .get(`http://127.0.0.1:${proxy.port}/test`, (reply) => {
              headers = true;
              reply.on("data", (chunk) => {
                bytes += chunk.length;
              });
              reply.on("end", () => resolve(reply.headers["set-cookie"]));
            })
            .on("error", reject);
        });
      const pending = request();
      const deadline = Date.now() + 5000;
      while (!(await control(socket, { action: "status" })).held) {
        assert.ok(Date.now() < deadline, "the stage must be reached");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(ingress.length, stage === "before_forward" ? 0 : 1);
      // The private stage proves bytes written, the client proves receipt.
      if (["after_headers", "mid_body"].includes(stage)) {
        while (!headers || (stage === "mid_body" && bytes !== 1)) {
          assert.ok(Date.now() < deadline);
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } else assert.equal(headers, false);
      assert.equal(bytes, stage === "mid_body" ? 1 : 0);
      await control(socket, { action: "release" });
      const cookies = await pending;
      assert.equal(cookies.length, 2);
      assert.ok(cookies[0].startsWith("first="));
      assert.ok(cookies[1].startsWith("second="));
      assert.equal(bytes, 11);
      await control(socket, { action: "duplicate" });
      const duplicated = await request();
      assert.deepEqual(duplicated, cookies);
      assert.deepEqual(ingress, [null]);
      await request();
      assert.deepEqual(ingress, [null, null]);
    } finally {
      await proxy.close();
      await new Promise((resolve) => upstream.close(resolve));
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("dropping before_forward never reaches the upstream", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "auth-proxy-drop-"));
  const socket = path.join(directory, "control.sock");
  const ingress = [];
  const upstream = http.createServer((request, response) => {
    ingress.push(request.url);
    response.end("unexpected");
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const proxy = await startFaultProxy({
    port: 0,
    upstreamPort: upstream.address().port,
    controlPath: socket,
  });
  try {
    await control(socket, {
      action: "arm",
      path: "/never-forward",
      stage: "before_forward",
    });
    const dropped = new Promise((resolve, reject) => {
      http
        .get(`http://127.0.0.1:${proxy.port}/never-forward`, () =>
          reject(new Error("dropped request received a response")),
        )
        .on("error", resolve);
    });
    const deadline = Date.now() + 5000;
    while (!(await control(socket, { action: "status" })).held) {
      assert.ok(Date.now() < deadline);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await control(socket, { action: "drop" });
    await dropped;
    // A control round-trip observes the resumed callback without a timing budget change.
    const observed = await control(socket, { action: "status" });
    assert.equal(
      observed.events.some((event) => event.stage === "forwarded"),
      false,
    );
    assert.equal(ingress.length, 0);
  } finally {
    await proxy.close();
    await new Promise((resolve) => upstream.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
