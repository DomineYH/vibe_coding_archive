// Test-only streaming transport. Node HTTP has no cookie jar; raw duplicate
// Set-Cookie fields go unchanged to the browser. Control uses a private socket.
import http from "node:http";
import net from "node:net";
import { chmod } from "node:fs/promises";

export async function startFaultProxy({ port, upstreamPort, controlPath }) {
  let armed;
  let held;
  const events = [];
  const sockets = new Set();
  const stages = new Set([
    "before_forward",
    "before_headers",
    "after_headers",
    "mid_body",
  ]);
  const server = http.createServer(async (incoming, outgoing) => {
    const fault = armed?.path === incoming.url ? armed : null;
    if (fault) armed = undefined;
    const ingress = (incoming.headers.cookie ?? "")
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter(Boolean);
    events.push({ path: incoming.url, stage: "ingress", cookies: ingress });
    const pause = async (stage) => {
      if (fault?.stage !== stage) return;
      events.push({ path: incoming.url, stage });
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          outgoing.destroy();
          resolve();
        }, 20000);
        held = {
          outgoing,
          release: () => {
            clearTimeout(timer);
            resolve();
          },
        };
      });
      held = undefined;
    };
    await pause("before_forward");
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: upstreamPort,
      path: incoming.url,
      method: incoming.method,
      headers: incoming.headers,
    });
    upstream.on("error", () => outgoing.destroy());
    upstream.on("response", async (reply) => {
      // Keep evidence safe: names/attributes and stage flags, never values/body.
      events.push({
        path: incoming.url,
        stage: "upstream_headers",
        status: reply.statusCode,
        cookies: (reply.headers["set-cookie"] ?? []).map((cookie) => ({
          name: cookie.split("=")[0],
          deletion: /Max-Age=0/i.test(cookie),
          httpOnly: /HttpOnly/i.test(cookie),
          sameSiteLax: /SameSite=Lax/i.test(cookie),
        })),
      });
      reply.pause();
      await pause("before_headers");
      if (outgoing.destroyed) {
        reply.destroy();
        return;
      }
      outgoing.writeHead(reply.statusCode, reply.rawHeaders);
      outgoing.flushHeaders();
      events.push({ path: incoming.url, stage: "downstream_headers" });
      await pause("after_headers");
      if (outgoing.destroyed) {
        reply.destroy();
        return;
      }
      let first = true;
      for await (const chunk of reply) {
        if (first && fault?.stage === "mid_body") {
          first = false;
          // At least one original byte, strictly less than the full JSON body.
          outgoing.write(chunk.subarray(0, 1));
          await pause("mid_body");
          if (outgoing.destroyed) {
            reply.destroy();
            return;
          }
          outgoing.write(chunk.subarray(1));
        } else outgoing.write(chunk);
      }
      outgoing.end();
      events.push({ path: incoming.url, stage: "complete" });
    });
    events.push({ path: incoming.url, stage: "forwarded" });
    incoming.pipe(upstream);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  const control = net.createServer((socket) => {
    let input = "";
    socket.on("data", (data) => {
      input += data;
      if (!input.includes("\n")) return;
      try {
        const message = JSON.parse(input);
        if (message.action === "arm") {
          if (armed || held || !stages.has(message.stage)) throw new Error();
          armed = { path: message.path, stage: message.stage };
          events.length = 0;
        } else if (message.action === "release" || message.action === "drop") {
          if (message.action === "drop") held?.outgoing.destroy();
          held?.release();
          armed = undefined;
        } else if (message.action !== "status") throw new Error();
        socket.end(JSON.stringify({ events, held: Boolean(held) }) + "\n");
      } catch {
        socket.end('{"error":"invalid private proxy command"}\n');
      }
    });
  });
  await new Promise((resolve, reject) => {
    control.once("error", reject);
    control.listen(controlPath, resolve);
  });
  await chmod(controlPath, 0o600);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    port: server.address().port,
    async close() {
      held?.release();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise((resolve) => server.close(resolve)),
        new Promise((resolve) => control.close(resolve)),
      ]);
    },
  };
}
