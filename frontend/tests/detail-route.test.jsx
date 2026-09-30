import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import catalog from "../../contracts/catalog.json";
import uuidCases from "../../contracts/fixtures/uuid-cases.json";
import App from "../src/app/app";
import publicApps from "../src/fixtures/public-apps.json";

// Use the real API service and DTO mapper at the route's network boundary.
vi.mock("@services/apps", () => import("../src/services/api/apps"));

const serverTime = "2026-09-22T00:12:00.000Z";
const meta = {
  ...catalog,
  server_time: serverTime,
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
  support: { email: null, service_url: null, announcement_url: null },
  initial_pending_days: 90,
};
let queryClient;
let fetch;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  fetch = vi.fn(async (url) => {
    const body =
      url === "/api/v1/meta"
        ? meta
        : {
            item: { ...publicApps[0], id: url.split("/").at(-1).toLowerCase() },
            server_time: serverTime,
          };
    return new Response(JSON.stringify(body), {
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetch);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function visit(id, query = "") {
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/apps/${encodeURIComponent(id)}${query}`]}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("detail route UUID boundaries", () => {
  it.each(uuidCases.invalid)(
    "shows NOT_FOUND for %j without a detail request",
    async (id) => {
      visit(id);
      expect(
        await screen.findByText("아카이브 앱을 찾을 수 없어요"),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(queryClient.getQueryState([__DATA_MODE__, "meta"])?.status).toBe(
          "success",
        ),
      );
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(["/api/v1/meta"]);
    },
  );

  it.each(uuidCases.valid)(
    "requests and maps valid detail ID %j",
    async (id) => {
      visit(id);
      expect(
        await screen.findByRole("heading", { name: publicApps[0].name }),
      ).toBeInTheDocument();
      expect(fetch.mock.calls.map(([url]) => url)).toContain(
        `/api/v1/apps/${id}`,
      );
    },
  );

  it("preserves the route's invalid-ID precedence over query errors", async () => {
    visit("not-a-uuid", "?tracking=1");
    expect(
      await screen.findByText("아카이브 앱을 찾을 수 없어요"),
    ).toBeInTheDocument();
    expect(fetch.mock.calls.map(([url]) => url)).not.toContain(
      "/api/v1/apps/not-a-uuid",
    );
  });
});
