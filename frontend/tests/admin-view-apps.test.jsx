import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminView } from "../src/features/admin/view-admin";
import { ServiceError } from "../src/services/service-error";
import { adminService } from "../src/services/mock/admin";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { resetMockState } from "../src/services/mock/state";

let client;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  await authService.login({ loginId: "admin", password: "admin123" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const checked = "2026-10-01T00:00:00.000Z";
const fresh = "2026-10-01T00:15:00.000Z";
const app = (n, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  ownerId: "00000000-0000-4000-8000-000000000101",
  owner: `작성자${n}`,
  name: `모니터 앱 ${n}`,
  url: `https://example.test/${n}`,
  isPublic: n % 2 === 0,
  themeId: "niagara",
  version: 1,
  urlVersion: 1,
  createdAt: checked,
  health: { state: "healthy", checked_at: checked, fresh_until: fresh },
  ...extra,
});
const page = (items, offset, total, limit = 24) => ({
  items,
  pagination: {
    limit,
    offset,
    total,
    hasMore: offset + items.length < total,
  },
  serverTime: checked,
});
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const cachedAppData = () =>
  client
    .getQueryCache()
    .findAll({ queryKey: ["api", "admin", "apps"] })
    .filter((query) => query.state.data !== undefined);
const capability = (enabled) => ({
  enabled,
  reasons: enabled ? [] : ["operational_restriction"],
});

async function mount({ scopeKey = "scope-a", read = true, props = {} } = {}) {
  const meta = await appsService.getMeta();
  meta.capabilities.admin_apps_read = capability(read);
  const tree = (key, extra = {}) => (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin?tab=health"]}>
        <AdminView scopeKey={key} meta={meta} {...props} {...extra} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(scopeKey));
  return { ...view, tree };
}

const firstPage = (count = 24, total = 30) =>
  page(
    Array.from({ length: count }, (_, i) => app(i + 1)),
    0,
    total,
  );

it("passes the captured read context to every apps read", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const readContext = { isCurrent: () => true, state: {} };
  const spy = vi
    .spyOn(adminService, "listApps")
    .mockResolvedValue(page([app(1)], 0, 1));
  await mount({ props: { readContext } });
  await screen.findByText("모니터 앱 1");
  expect(spy.mock.calls[0][1].readContext).toBe(readContext);
});

it("replaces the preparation notice with an operational state and sends nothing", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const spy = vi.spyOn(adminService, "listApps");
  await mount({ read: false });
  expect(
    await screen.findByText("앱 목록을 지금은 불러올 수 없어요."),
  ).toBeVisible();
  expect(
    screen.queryByText("아카이브 앱 관리 기능은 아직 준비 중이에요."),
  ).not.toBeInTheDocument();
  expect(spy).not.toHaveBeenCalled();
});

it("keeps loaded rows and retries the same offset after a transient load-more failure", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const retry = deferred();
  const spy = vi
    .spyOn(adminService, "listApps")
    .mockResolvedValueOnce(firstPage())
    .mockRejectedValueOnce(
      new ServiceError("NETWORK_ERROR", "연결할 수 없어요.", {}),
    )
    .mockReturnValueOnce(retry.promise);
  const onAuthRecheck = vi.fn();
  await mount({ props: { onAuthRecheck } });
  await screen.findByText("모니터 앱 1");
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /추가 앱 불러오기/ }));
  expect(await screen.findByText(/추가 앱을 불러오지 못했어요/)).toBeVisible();
  expect(screen.getByText("모니터 앱 1")).toBeVisible();
  expect(onAuthRecheck).not.toHaveBeenCalled();
  const button = screen.getByRole("button", { name: "추가 앱 다시 불러오기" });
  await user.click(button);
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
  expect(spy.mock.calls[2][0]).toEqual({ limit: 24, offset: 24 });
  expect(spy.mock.calls[1][0]).toEqual({ limit: 24, offset: 24 });
  await act(async () => {
    retry.resolve(page([app(25), app(26)], 24, 30));
  });
  await screen.findByText("모니터 앱 25");
  expect(screen.getByText("모니터 앱 1")).toBeVisible();
});

it.each(["AUTH_REQUIRED", "FORBIDDEN", "AUTH_STATE_CHANGED"])(
  "clears protected rows and rechecks authority when load-more is denied with %s",
  async (code) => {
    vi.stubGlobal("__DATA_MODE__", "api");
    vi.spyOn(adminService, "listApps")
      .mockResolvedValueOnce(firstPage())
      .mockRejectedValueOnce(
        new ServiceError(code, "거절", { httpStatus: 403 }),
      );
    const onAuthRecheck = vi.fn();
    await mount({ props: { onAuthRecheck } });
    await screen.findByText("모니터 앱 1");
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /추가 앱 불러오기/ }));
    await waitFor(() => expect(onAuthRecheck).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("모니터 앱 1")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/표시된 목록은 유지됩니다/),
    ).not.toBeInTheDocument();
    await waitFor(() => expect(cachedAppData()).toHaveLength(0));
  },
);

it("drops a late first page that resolves after the scope changed", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const late = deferred();
  vi.spyOn(adminService, "listApps")
    .mockReturnValueOnce(late.promise)
    .mockResolvedValue(page([app(90)], 0, 1));
  const { rerender, tree } = await mount({ scopeKey: "scope-a" });
  rerender(tree("scope-b"));
  await screen.findByText("모니터 앱 90");
  await act(async () => {
    late.resolve(firstPage());
  });
  expect(screen.queryByText("모니터 앱 1")).not.toBeInTheDocument();
  expect(screen.getByText("모니터 앱 90")).toBeVisible();
  const keys = client
    .getQueryCache()
    .findAll({ queryKey: ["api", "admin", "apps"] })
    .map((query) => query.queryKey[3]);
  expect(keys).not.toContain("scope-a");
});

it("removes rows already shown when the scope changes and does not reuse them", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const next = deferred();
  vi.spyOn(adminService, "listApps")
    .mockResolvedValueOnce(firstPage())
    .mockReturnValueOnce(next.promise);
  const { rerender, tree } = await mount({ scopeKey: "scope-a" });
  await screen.findByText("모니터 앱 1");
  rerender(tree("scope-b"));
  await waitFor(() =>
    expect(screen.queryByText("모니터 앱 1")).not.toBeInTheDocument(),
  );
  await act(async () => {
    next.resolve(page([app(91)], 0, 1));
  });
  expect(await screen.findByText("모니터 앱 91")).toBeVisible();
});

it("hides and removes the list when the view becomes inactive mid-request", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const late = deferred();
  vi.spyOn(adminService, "listApps").mockReturnValueOnce(late.promise);
  const { rerender, tree } = await mount();
  rerender(tree("scope-a", { active: false }));
  await act(async () => {
    late.resolve(firstPage());
  });
  expect(screen.queryByText("모니터 앱 1")).not.toBeInTheDocument();
  await waitFor(() => expect(cachedAppData()).toHaveLength(0));
});

it("surfaces a failed background refresh with an explicit retry and no write", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const spy = vi
    .spyOn(adminService, "listApps")
    .mockResolvedValueOnce(firstPage(2, 2))
    .mockRejectedValueOnce(new ServiceError("SERVICE_UNAVAILABLE", "x", {}))
    .mockResolvedValueOnce(page([app(1), app(2), app(3)], 0, 3));
  await mount();
  await screen.findByText("모니터 앱 1");
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["api", "admin", "apps"] });
  });
  expect(await screen.findByText(/목록을 새로 고치지 못했어요/)).toBeVisible();
  expect(screen.getByText("모니터 앱 1")).toBeVisible();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "다시 시도" }));
  await screen.findByText("모니터 앱 3");
  expect(spy).toHaveBeenCalledTimes(3);
});

it("keeps the four server statistics independent of the visible page", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  vi.spyOn(adminService, "listApps").mockResolvedValue(firstPage(24, 70));
  const users = await adminService.listUsers();
  vi.spyOn(adminService, "listUsers").mockResolvedValue({
    ...users,
    stats: { ...users.stats, totalApps: 70, healthyApps: 5 },
  });
  await mount();
  await screen.findByText("모니터 앱 1");
  const stat = (label) =>
    screen.getByText(label).closest("div").querySelector("dd").textContent;
  expect(stat("등록된 앱")).toBe("70");
  expect(stat("정상 가동")).toBe("5 / 70");
  expect(
    within(screen.getByRole("list", { name: "전체 앱 목록" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(24);
});

it("still reads the first page under React StrictMode double effects", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const spy = vi
    .spyOn(adminService, "listApps")
    .mockResolvedValue(page([app(1)], 0, 1));
  const meta = await appsService.getMeta();
  meta.capabilities.admin_apps_read = capability(true);
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin?tab=health"]}>
          <AdminView scopeKey="strict" meta={meta} />
        </MemoryRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
  expect(await screen.findByText("모니터 앱 1")).toBeVisible();
  expect(spy).toHaveBeenCalled();
});
