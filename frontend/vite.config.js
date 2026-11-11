import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

const MALFORMED_PATH_BODY =
  "Bad Request: malformed percent-encoding in the URL path\n";

// Pathname only: a malformed query must still reach the app and API.
function hasMalformedPath(url) {
  const pathname = (url ?? "").split(/[?#]/, 1)[0];
  if (!pathname.includes("%")) return false;
  try {
    decodeURI(pathname);
    return false;
  } catch {
    return true;
  }
}

// KST has no DST, so a fixed +9h shift of the committer time is exact.
export const kstDate = (seconds) =>
  new Date((seconds + 9 * 3600) * 1000).toISOString().slice(0, 10);

function commitInfo() {
  const date = process.env.APP_COMMIT_DATE;
  const sha = process.env.APP_COMMIT_SHA;
  // Empty string = unset, same as VITE_DATA_MODE.
  if (date || sha) {
    if (!date || !sha)
      throw new Error(
        "APP_COMMIT_DATE and APP_COMMIT_SHA must be set together",
      );
    const time = Date.parse(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(time) ||
      new Date(time).toISOString().slice(0, 10) !== date
    )
      throw new Error("APP_COMMIT_DATE must be a real YYYY-MM-DD date");
    if (!/^[0-9a-f]{7,40}$/.test(sha))
      throw new Error("APP_COMMIT_SHA must be 7-40 lowercase hex characters");
    return { date, sha };
  }
  try {
    const match = /^([0-9a-f]{4,40}) (\d+)$/.exec(
      execFileSync("git", ["log", "-1", "--format=%h %ct"], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
    if (match) return { date: kstDate(Number(match[2])), sha: match[1] };
  } catch {
    // git missing, not a repository, or refused: build without a version.
  }
  return { date: "", sha: "" };
}

export default defineConfig(({ command, mode: viteMode }) => {
  const env = loadEnv(viteMode, root, "VITE_");
  const unsupported = new Set(
    [...Object.keys(env), ...Object.keys(process.env)].filter(
      (key) => key.startsWith("VITE_") && key !== "VITE_DATA_MODE",
    ),
  );
  if (unsupported.size)
    throw new Error(
      `Unsupported VITE_* environment variables: ${[...unsupported].join(", ")}`,
    );
  const configured = process.env.VITE_DATA_MODE || env.VITE_DATA_MODE;
  const dataMode = configured || (command === "serve" ? "mock" : "api");
  if (dataMode !== "mock" && dataMode !== "api")
    throw new Error("VITE_DATA_MODE must be mock or api");
  if (command === "build" && dataMode === "mock" && viteMode !== "mock")
    throw new Error("Mock output requires --mode mock");
  if (command === "build" && dataMode === "api" && viteMode === "mock")
    throw new Error("Mock mode cannot produce the API build");
  const commit = commitInfo();

  return {
    plugins: [
      {
        name: "dev-malformed-path-guard",
        apply: "serve",
        configureServer(server) {
          // Registered pre-hook so it runs before the proxy/static/html-fallback that throw on bad URIs.
          server.middlewares.use(
            function devMalformedPathGuard(req, res, next) {
              if (!hasMalformedPath(req.url)) return next();
              res.statusCode = 400;
              res.setHeader("Content-Type", "text/plain; charset=utf-8");
              res.setHeader("X-Content-Type-Options", "nosniff");
              res.end(MALFORMED_PATH_BODY);
            },
          );
        },
      },
      react(),
      ...(dataMode === "api"
        ? [
            {
              name: "api-public-license",
              apply: "build",
              generateBundle() {
                this.emitFile({
                  type: "asset",
                  fileName: "licenses/Pretendard-OFL.txt",
                  source: readFileSync(
                    path.join(root, "public/licenses/Pretendard-OFL.txt"),
                  ),
                });
              },
            },
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@services/apps": path.resolve(
          root,
          `src/services/${dataMode}/apps.ts`,
        ),
        "@services/mock-reset": path.resolve(
          root,
          `src/services/${dataMode}/reset-page.jsx`,
        ),
        "@services/auth": path.resolve(
          root,
          `src/services/${dataMode}/auth.ts`,
        ),
        "@services/admin": path.resolve(
          root,
          `src/services/${dataMode}/admin.ts`,
        ),
        "@services/health": path.resolve(
          root,
          `src/services/${dataMode}/health.ts`,
        ),
      },
    },
    define: {
      __DATA_MODE__: JSON.stringify(dataMode),
      __APP_COMMIT_DATE__: JSON.stringify(commit.date),
      __APP_COMMIT_SHA__: JSON.stringify(commit.sha),
    },
    server: {
      host: "localhost",
      port: dataMode === "mock" ? 5173 : 5174,
      strictPort: true,
      fs: { allow: [root, path.resolve(root, "../contracts")] },
      proxy:
        dataMode === "api"
          ? {
              "/api": {
                target: "http://127.0.0.1:8000",
                configure(proxy) {
                  // start runs before headers are copied, including Expect requests.
                  proxy.on("start", (req) => {
                    const peer = req.socket.remoteAddress;
                    if (peer) {
                      req.headers["x-forwarded-for"] = peer;
                      req.headers["x-real-ip"] = peer;
                    } else {
                      delete req.headers["x-forwarded-for"];
                      delete req.headers["x-real-ip"];
                    }
                    req.headers["x-forwarded-proto"] = req.socket.encrypted
                      ? "https"
                      : "http";
                    delete req.headers.forwarded;
                  });
                },
              },
            }
          : undefined,
    },
    build: { sourcemap: false, copyPublicDir: dataMode !== "api" },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./tests/setup.js"],
      include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    },
  };
});
