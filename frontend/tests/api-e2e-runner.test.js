// @vitest-environment node
import { spawnSync } from "node:child_process";
import { afterEach, vi } from "vitest";
import { expect, it } from "vitest";
import { selectNginxRuns } from "../scripts/test-api-e2e.mjs";

it("selects only the approved HTTPS critical path, configured support, restore and controlled worker", () => {
  const runs = selectNginxRuns(["--nginx-functional"]);
  expect(runs).toEqual([
    {
      arguments_: [
        "e2e-api/auth-register.spec.js",
        "e2e-api/admin-approval.spec.js",
        "e2e-api/auth-login.spec.js",
        "e2e-api/auth-access.spec.js",
        "e2e-api/app-create.spec.js",
        "e2e-api/app-edit.spec.js",
        "e2e-api/app-delete.spec.js",
        "e2e-api/admin-password-reset.spec.js",
        "e2e-api/admin-user-delete.spec.js",
      ],
      prepared: true,
      faults: false,
    },
    {
      arguments_: ["e2e-api/auth-support.spec.js"],
      prepared: true,
      faults: false,
      support: true,
    },
    {
      arguments_: ["e2e-api/auth-recovery-process.spec.js"],
      prepared: true,
      faults: true,
    },
    {
      arguments_: ["e2e-api/health-real.spec.js"],
      prepared: true,
      faults: false,
      health: true,
    },
  ]);
});

it("preserves static-only selection and rejects conflicting or excluded variants", () => {
  expect(selectNginxRuns(["--nginx"])).toEqual([
    {
      arguments_: ["e2e-api/static-serving.spec.js"],
      prepared: true,
      faults: false,
    },
  ]);
  expect(selectNginxRuns([])).toBeNull();
  for (const args of [
    ["--nginx", "--nginx-functional"],
    ["--nginx-functional", "--auth-unavailable"],
    ["--nginx-functional", "--admin-apps-empty"],
    ["--nginx", "e2e-api/auth-login.spec.js"],
    ["--nginx-functional", "e2e-api/auth-races.spec.js"],
  ])
    expect(() => selectNginxRuns(args)).toThrow();
  expect(
    selectNginxRuns([
      "--nginx-functional",
      "e2e-api/auth-support.spec.js",
      "--grep",
      "metadata",
    ]),
  ).toEqual([
    {
      arguments_: ["e2e-api/auth-support.spec.js", "--grep", "metadata"],
      prepared: true,
      faults: false,
      support: true,
    },
  ]);
});

afterEach(() => vi.unstubAllEnvs());
it("uses the runner HTTPS Origin for successful reset issuance", async () => {
  vi.stubEnv("PUBLIC_ORIGIN", "https://localhost:8443");
  vi.resetModules();
  const { issue } = await import("../e2e-api/password-reset-helpers.js");
  const post = vi.fn(async () => ({
    status: () => 201,
    json: async () => ({ key: "test" }),
  }));
  await issue(
    { evaluate: async () => ({}), request: { post } },
    { id: "test-member" },
  );
  expect(post.mock.calls[0][1].headers.Origin).toBe("https://localhost:8443");
}, 30000);
function config(extra) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `import config from './playwright.api.config.js'; console.log(JSON.stringify(config));`,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        APP_ENV: "test",
        API_E2E_NGINX: "1",
        API_E2E_NGINX_FUNCTIONAL: "1",
        ...extra,
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
}
it("functional HTTPS uses production assets and the fault/health upstreams with no Vite fallback", () => {
  const faults = config({ API_E2E_FAULTS: "1", API_E2E_HEALTH: "" });
  expect(faults.webServer[0].command).toBe(
    "node e2e-api/auth-fault-launcher.mjs",
  );
  expect(faults.webServer[1].command).toBe("node scripts/nginx-serving.mjs");
  expect(faults.use).toMatchObject({
    baseURL: "https://localhost:8443",
    ignoreHTTPSErrors: true,
  });
  expect(faults.testMatch).toBeUndefined();
  const health = config({ API_E2E_FAULTS: "", API_E2E_HEALTH: "1" });
  expect(health.webServer[0].command).toContain("tests.health_server:app");
  const normal = config({
    API_E2E_FAULTS: "",
    API_E2E_HEALTH: "",
    API_E2E_AUTH_BOUNDARY: "prepared",
  });
  expect(normal.webServer[0].command).toContain("tests.auth_server:app");
  const smoke = config({ API_E2E_NGINX_FUNCTIONAL: "" });
  expect(smoke.testMatch).toBe("**/static-serving.spec.js");
  expect(smoke.webServer[0].command).toBe(
    "node scripts/nginx-serving.mjs --upstream",
  );
}, 30000);
