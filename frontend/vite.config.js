import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ command, mode: viteMode }) => {
  const configured =
    process.env.VITE_DATA_MODE ||
    loadEnv(viteMode, root, "VITE_").VITE_DATA_MODE;
  const dataMode = configured || (command === "serve" ? "mock" : "api");
  if (dataMode !== "mock" && dataMode !== "api")
    throw new Error("VITE_DATA_MODE must be mock or api");
  if (command === "build" && dataMode === "mock" && viteMode !== "mock")
    throw new Error("Mock output requires --mode mock");
  if (command === "build" && dataMode === "api" && viteMode === "mock")
    throw new Error("Mock mode cannot produce the API build");

  return {
    plugins: [react()],
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
    build: { sourcemap: false },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./tests/setup.js"],
      include: ["tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    },
  };
});
