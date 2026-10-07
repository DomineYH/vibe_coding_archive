// The real admin app-list adapter inside the real AppShell observation boundary.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { MOCK_STORAGE_KEY, resetMockState } from "../src/services/mock/state";

vi.mock("@services/admin", async () => {
  const mock = await import("../src/services/mock/admin");
  const api = await import("../src/services/api/admin");
  return {
    adminService: { ...mock.adminService, listApps: api.adminService.listApps },
  };
});

const checked = "2026-10-01T00:00:00.000Z";
const wireApp = {
  id: "00000000-0000-4000-8000-000000000555",
  owner: { id: "00000000-0000-4000-8000-000000000101", nickname: "작성자" },
  name: "격리 대상 앱",
  url: "https://example.test/isolated",
  is_public: false,
  theme_id: "niagara",
  version: 1,
  url_version: 1,
  created_at: checked,
  health: {
    state: "healthy",
    checked_at: checked,
    fresh_until: "2026-10-01T00:15:00.000Z",
  },
};
let client;
let fetch;
let release;
let held;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  const admin = DEMO_ACCOUNTS[0];
  await authService.login({ loginId: admin.loginId, password: admin.password });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  held = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  fetch = vi.fn(async (url, options) => {
    const headers = options.headers;
    held = true;
    await gate;
    return new Response(
      JSON.stringify({
        items: [wireApp],
        pagination: { limit: 24, offset: 0, total: 1, has_more: false },
        server_time: "2026-10-01T00:00:00.000Z",
      }),
      {
        headers: {
          "X-EduVibe-Flow-Id": headers.get("X-EduVibe-Flow-Id"),
          "X-EduVibe-Auth-Revision": headers.get("X-EduVibe-Auth-Revision"),
          "X-EduVibe-Session-Generation": headers.get(
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

const appData = () =>
  client
    .getQueryCache()
    .findAll({ queryKey: [__DATA_MODE__, "admin", "apps"] })
    .filter((query) => query.state.data !== undefined);

function visit() {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin?tab=health"]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("sends the captured flow context and shows the page once the read completes", async () => {
  visit();
  await waitFor(() => expect(held).toBe(true));
  const [, init] = fetch.mock.calls[0];
  expect(init.cache).toBe("no-store");
  expect(init.headers.get("X-EduVibe-Flow-Id")).toBeTruthy();
  expect(init.headers.has("X-CSRF-Token")).toBe(false);
  await act(async () => release());
  expect(await screen.findByText("격리 대상 앱")).toBeVisible();
});

it("never installs a response that completes after the screen was concealed", async () => {
  visit();
  await waitFor(() => expect(held).toBe(true));
  await act(async () => window.dispatchEvent(new Event("blur")));
  await act(async () => release());
  expect(screen.queryByText("격리 대상 앱")).not.toBeInTheDocument();
  await waitFor(() => expect(appData()).toHaveLength(0));
});

it("clears rows already displayed when the admin logs out in another window", async () => {
  visit();
  await waitFor(() => expect(held).toBe(true));
  await act(async () => release());
  await screen.findByText("격리 대상 앱");
  await authService.logout();
  await act(async () =>
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: MOCK_STORAGE_KEY,
        newValue: localStorage.getItem(MOCK_STORAGE_KEY),
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByText("격리 대상 앱")).not.toBeInTheDocument(),
  );
  await waitFor(() => expect(appData()).toHaveLength(0));
});
