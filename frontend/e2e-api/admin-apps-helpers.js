import { browserContextOptions } from "./helpers.js";
import { expect, test as base } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { login } from "./approval-helpers.js";
export { login };
export const PASSWORD = "Synthetic admin apps read password 162!";
export const SENTINEL = "e162-forbidden-sentinel";
export const LIST_URL = /\/api\/v1\/admin\/apps(\?|$)/;

export function fixture(action, value) {
  const result = spawnSync(
    "uv",
    ["run", "--frozen", "python", "-m", "tests.admin_apps_browser_fixtures"],
    {
      cwd: "../backend",
      env: process.env,
      input: JSON.stringify([action, value]),
      encoding: "utf8",
    },
  );
  expect(
    result.status,
    `isolated admin apps fixture ${action}: ${result.stderr}`,
  ).toBe(0);
  return JSON.parse(result.stdout);
}

// Every case owns its members, apps, browser flows and rate-limit rows, and the
// teardown proves zero surviving owned rows even when the test body failed.
export const test = base.extend({
  owned: async ({ context, browser }, provideFixture) => {
    const count = process.env.API_E2E_EMPTY_APPS === "1" ? 0 : 30;
    const value = fixture("create", [
      PASSWORD,
      `e162-${randomUUID().slice(0, 8)}`,
      count,
    ]);
    const flows = new Set();
    const contexts = [context];
    const pending = new Set();
    const releases = [];
    const track = (ctx) => {
      ctx.on("request", (request) => {
        const flow = request.headers()["x-eduvibe-flow-id"];
        if (flow) flows.add(flow);
      });
      ctx.on("response", (response) => {
        if (
          response.request().method() === "POST" &&
          response.url().endsWith("/auth/flows") &&
          response.status() === 201
        ) {
          const read = response
            .json()
            .then((body) => flows.add(body.flow_id))
            .catch(() => {});
          pending.add(read);
          read.finally(() => pending.delete(read));
        }
      });
    };
    track(context);
    const owned = {
      ...value.members,
      apps: value.apps,
      baseline: value.baseline,
      onCleanup: (release) => releases.push(release),
      async newContext() {
        const ctx = await browser.newContext(browserContextOptions);
        contexts.push(ctx);
        track(ctx);
        return ctx;
      },
    };
    try {
      await provideFixture(owned);
    } finally {
      for (const release of releases) release();
      await Promise.all(contexts.map((ctx) => ctx.close()));
      await Promise.all(pending);
      const leftover = fixture("cleanup", {
        ...value,
        flows: [...flows],
      });
      console.log("admin-apps owned leftovers", JSON.stringify(leftover));
      expect(Object.values(leftover).every((count) => count === 0)).toBe(true);
    }
  },
});

export function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function signIn(page, member) {
  await login(page, member.login, PASSWORD);
  await expect(
    page.getByRole("banner").getByText(member.login, { exact: true }),
  ).toBeVisible();
}

export function monitorList(page) {
  return page.getByRole("list", { name: "전체 앱 목록" });
}

export async function openMonitor(page, member) {
  await signIn(page, member);
  await page.goto("/admin?tab=health");
  await expect(monitorList(page)).toBeVisible();
}

// The flow id survives logout and login in one browser profile; the revision
// and session generation identify the observation a read was issued under.
function authContext(request) {
  const headers = request.headers();
  return [
    headers["x-eduvibe-flow-id"],
    headers["x-eduvibe-auth-revision"],
    headers["x-eduvibe-session-generation"],
  ].join("/");
}

// Records the app list responses with their bodies for later assertions.
export function collectLists(page) {
  const lists = [];
  page.on("response", (response) => {
    if (response.request().method() !== "GET" || !LIST_URL.test(response.url()))
      return;
    lists.push({
      url: new URL(response.url()),
      status: response.status(),
      headers: response.headers(),
      body: response.text().catch(() => ""),
      context: authContext(response.request()),
    });
  });
  return lists;
}

export function collectWrites(page) {
  const writes = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") && request.method() !== "GET")
      writes.push(`${request.method()} ${url.pathname}`);
  });
  return writes;
}

// Context headers only: no CSRF token, Origin or idempotency key.
export function readHeaders(page) {
  return page.evaluate(async () => {
    const { flowId } = JSON.parse(localStorage.getItem("eduvibe-auth-flow-v1"));
    const flow = await (
      await fetch("/api/v1/auth/flow-state", {
        headers: { "X-EduVibe-Flow-Id": flowId },
      })
    ).json();
    return {
      "X-EduVibe-Flow-Id": flowId,
      "X-EduVibe-Auth-Revision": flow.revision,
      "X-EduVibe-Session-Generation": flow.session_generation,
    };
  });
}

export async function appNames(page) {
  return monitorList(page)
    .getByRole("button", { name: /^앱 관리: / })
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
}

// Holds the actual backend result until released, then delivers it unchanged.
// `reached` resolves once the backend has really answered the held request.
export async function holdLists(page, barrier, { match = () => true } = {}) {
  const held = { contexts: [], reached: deferred() };
  await page.route(LIST_URL, async (route) => {
    if (!match(new URL(route.request().url()))) return route.continue();
    held.contexts.push(authContext(route.request()));
    const response = await route.fetch();
    held.reached.resolve();
    await barrier.promise;
    try {
      await route.fulfill({ response });
    } catch {
      // The page cancelled the read or navigated away; the late result is discarded.
    }
  });
  return held;
}

// Fails delivery of the actual backend result for every matching request until
// stopped (React StrictMode may issue the first read twice in development).
export async function failLists(page, { match = () => true } = {}) {
  const control = {
    served: [],
    failing: true,
    stop: () => (control.failing = false),
  };
  await page.route(LIST_URL, async (route) => {
    const url = new URL(route.request().url());
    if (!match(url) || !control.failing) return route.continue();
    const response = await route.fetch();
    control.served.push(response.status());
    await route.abort("failed");
  });
  return control;
}
