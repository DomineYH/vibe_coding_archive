// A test-only Vite transport that flushes real upstream headers independently
// of body data, so after_headers is an actual browser-receipt stage.
import { defineConfig, mergeConfig } from "vite";
import productConfig from "../vite.config.js";

export default defineConfig((environment) => {
  if (process.env.APP_ENV !== "test" || process.env.API_E2E_FAULTS !== "1")
    throw new Error("Streaming Vite transport requires the private fault run.");
  return mergeConfig(productConfig(environment), {
    server: {
      proxy: {
        "/api": {
          target: "http://127.0.0.1:8000",
          configure(proxy) {
            proxy.on("proxyRes", (reply, _request, response) => {
              reply.on("aborted", () => response.destroy());
              // http-proxy copies original headers synchronously after this
              // event; flush after that copy, before any body bytes arrive.
              queueMicrotask(() => {
                if (!response.destroyed && response.headersSent === false)
                  response.flushHeaders();
              });
            });
          },
        },
      },
    },
  });
});
