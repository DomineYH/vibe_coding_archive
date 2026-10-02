// Mock auth is only a regression seam; protected reads use the real API adapter.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import catalog from "../../contracts/catalog.json";
import { MOCK_STORAGE_KEY, resetMockState } from "../src/services/mock/state";
import publicApps from "../src/fixtures/public-apps.json";

vi.mock("@services/apps", () => import("../src/services/api/apps"));
const id = publicApps[0].id;
const item = {
  ...publicApps[0],
  name: "T06 보호 화면",
  prompt: "T06 전용 본문",
  is_public: false,
};
let client;
let fetch;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  const account = DEMO_ACCOUNTS[1];
  await authService.login({
    loginId: account.loginId,
    password: account.password,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fetch = vi.fn(async (url, options) => {
    if (url === "/api/v1/meta")
      return new Response(
        JSON.stringify({
          ...catalog,
          server_time: "2026-10-02T00:00:00Z",
          support: { email: null, service_url: null, announcement_url: null },
          initial_pending_days: 90,
          capabilities: Object.fromEntries(
            [
              "apps_read",
              "auth_register",
              "auth_login",
              "auth_logout",
              "auth_password_change",
              "admin_users_read",
              "admin_approval",
              "admin_summary",
              "apps_create",
              "apps_update_own",
              "apps_delete_own",
              "admin_apps_read",
              "admin_apps_manage",
              "admin_reauth",
              "admin_password_reset",
              "admin_user_delete",
              "health_read",
              "health_check",
              "health_batch",
              "email_collection",
              "phone_collection",
            ].map((key) => [
              key,
              {
                enabled: key === "apps_read",
                reasons: key === "apps_read" ? [] : ["not_implemented"],
              },
            ]),
          ),
        }),
      );
    const context = options.headers;
    if (!context.has("X-EduVibe-Flow-Id"))
      return new Response(
        JSON.stringify({
          error: { code: "NOT_FOUND", message: "자료 없음", request_id: null },
        }),
        { status: 404 },
      );
    return new Response(
      JSON.stringify({ item, server_time: "2026-10-02T00:00:00Z" }),
      {
        headers: {
          "X-EduVibe-Flow-Id": context.get("X-EduVibe-Flow-Id"),
          "X-EduVibe-Auth-Revision": context.get("X-EduVibe-Auth-Revision"),
          "X-EduVibe-Session-Generation": context.get(
            "X-EduVibe-Session-Generation",
          ),
          "Cache-Control": "private, no-store",
        },
      },
    );
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visit() {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/apps/${id}`]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
function missedScenario(scenario) {
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  localStorage.setItem(
    MOCK_STORAGE_KEY,
    JSON.stringify({ ...state, scenario }),
  );
}

it("uses a captured owner observation and never stores protected detail in public or persistent caches", async () => {
  visit();
  expect(
    await screen.findByRole("heading", { name: item.name }),
  ).toBeInTheDocument();
  const queries = client
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey[2] === "detail");
  expect(
    queries.some(
      (query) =>
        query.queryKey[4] === "member" && query.state.data?.isPublic === false,
    ),
  ).toBe(true);
  expect(
    queries
      .filter((query) => query.queryKey[4] === "public")
      .every((query) => query.state.data?.isPublic !== false),
  ).toBe(true);
  expect(Object.values(localStorage).join(" ")).not.toContain(item.name);
});

it("rechecks on focus without a preceding departure and on every pageshow", async () => {
  visit();
  expect(
    await screen.findByRole("heading", { name: item.name }),
  ).toBeInTheDocument();
  missedScenario("auth_observation_error");
  await act(async () => window.dispatchEvent(new Event("focus")));
  await waitFor(() =>
    expect(screen.queryByText(item.prompt)).not.toBeInTheDocument(),
  );
  expect(
    await screen.findByText("로그인 상태를 확인할 수 없습니다"),
  ).toBeInTheDocument();
  missedScenario("original");
  await act(async () => window.dispatchEvent(new Event("pageshow")));
  expect(
    await screen.findByRole("heading", { name: item.name }),
  ).toBeInTheDocument();
});

it("discards a real-adapter response completing after blur without replay or private DOM", async () => {
  const original = fetch.getMockImplementation();
  let release;
  let held = false;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  fetch.mockImplementation(async (url, options) => {
    const response = await original(url, options);
    if (options?.headers.has("X-EduVibe-Flow-Id")) {
      held = true;
      await delayed;
    }
    return response;
  });
  visit();
  await waitFor(() => expect(held).toBe(true));
  await act(async () => window.dispatchEvent(new Event("blur")));
  const calls = fetch.mock.calls.length;
  await act(async () => {
    release();
    await delayed;
  });
  expect(screen.queryByText(item.name)).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "복사하기" }),
  ).not.toBeInTheDocument();
  expect(
    client
      .getQueryCache()
      .getAll()
      .every((query) => query.state.data?.isPublic !== false),
  ).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(calls);
});
