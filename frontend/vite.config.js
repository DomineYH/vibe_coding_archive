import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

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

  return {
    plugins: [
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
    define: { __DATA_MODE__: JSON.stringify(dataMode) },
    server: {
      host: "localhost",
      port: dataMode === "mock" ? 5173 : 5174,
      strictPort: true,
      fs: { allow: [root, path.resolve(root, "../contracts")] },
      proxy:
        dataMode === "api" ? { "/api": "http://127.0.0.1:8000" } : undefined,
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
