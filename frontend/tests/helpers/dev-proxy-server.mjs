import { createServer } from "vite";
import viteConfig from "../../vite.config.js";

process.env.VITE_DATA_MODE = "api";
const config = viteConfig({ command: "serve", mode: "test" });
const proxy = config.server.proxy["/api"];
// Preserve the real boundary hook, including on the unfixed string configuration.
config.server.proxy["/api"] =
  typeof proxy === "string"
    ? { target: process.argv[2] }
    : { ...proxy, target: process.argv[2] };
const server = await createServer({
  ...config,
  configFile: false,
  mode: "test",
  cacheDir: process.argv[3],
  logLevel: "silent",
  server: { ...config.server, host: "127.0.0.1", port: 0 },
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
// Vite 6's server.listen treats port 0 as the default; bind its native server.
await new Promise((resolve, reject) => {
  server.httpServer.once("error", reject);
  server.httpServer.listen(0, "127.0.0.1", () => {
    server.httpServer.off("error", reject);
    resolve();
  });
});
process.stdout.write(
  JSON.stringify({
    url: `http://127.0.0.1:${server.httpServer.address().port}`,
  }) + "\n",
);
