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
import { healthService } from "../src/services/mock/health";
import { resetMockState, setMockScenario } from "../src/services/mock/state";

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

const healthOperationalNote =
  "연결 검사 운영 준비가 확인되지 않아 새 검사를 접수할 수 없어요. 기존 연결 결과는 확인할 수 있어요.";

it.each(["health_check", "health_batch"])(
  "explains %s independently for every affected button and removes the notice when enabled",
  async (key) => {
    vi.stubGlobal("__DATA_MODE__", "api");
    vi.spyOn(adminService, "listApps").mockResolvedValue(firstPage(2, 2));
    const requestCheck = vi.spyOn(healthService, "requestCheck");
    const requestBatch = vi.spyOn(healthService, "requestBatch");
    const meta = await appsService.getMeta();
    meta.capabilities[key] = capability(false);
    const view = await mount({ props: { meta } });
    await screen.findByText("모니터 앱 1");
    const note = screen.getByText(healthOperationalNote);
    expect(note).toBeVisible();
    expect(note).not.toHaveClass("sr-only");
    expect(note.closest('[role="alert"], [aria-live="assertive"]')).toBeNull();
    const rows = screen.getAllByRole("button", { name: "즉시 재검사" });
    expect(rows).toHaveLength(2);
    const batch = screen.getByRole("button", { name: "전체 재검사" });
    const restricted = key === "health_check" ? rows : [batch];
    const available = key === "health_check" ? [batch] : rows;
    for (const button of restricted) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(healthOperationalNote);
      expect(button).toHaveAttribute("aria-describedby", note.id);
      await userEvent.click(button);
    }
    for (const button of available) {
      expect(button).toBeEnabled();
      expect(button).not.toHaveAccessibleDescription(healthOperationalNote);
    }
    const ids = [...view.container.querySelectorAll("[id]")].map(
      (element) => element.id,
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const button of view.container.querySelectorAll("[aria-describedby]"))
      for (const id of button.getAttribute("aria-describedby").split(/\s+/))
        expect(document.getElementById(id)).not.toBeNull();
    expect(screen.getAllByLabelText("연결 결과: 정상")).toHaveLength(2);
    expect(requestCheck).not.toHaveBeenCalled();
    expect(requestBatch).not.toHaveBeenCalled();

    const enabledMeta = {
      ...meta,
      capabilities: {
        ...meta.capabilities,
        [key]: { ...capability(false), enabled: true },
      },
    };
    view.rerender(view.tree("scope-a", { meta: enabledMeta }));
    expect(screen.queryByText(healthOperationalNote)).not.toBeInTheDocument();
    expect(document.getElementById(note.id)).toBeNull();
    for (const button of restricted) {
      expect(button).toBeEnabled();
      expect(button.getAttribute("aria-describedby")).not.toContain(note.id);
    }
  },
);

it.each([
  undefined,
  { enabled: false, reasons: [] },
  { enabled: false, reasons: ["not_implemented"] },
  { enabled: false, reasons: ["verification_pending"] },
  { enabled: true, reasons: ["operational_restriction"] },
])("does not invent health operational restrictions for %j", async (value) => {
  vi.stubGlobal("__DATA_MODE__", "api");
  vi.spyOn(adminService, "listApps").mockResolvedValue(firstPage(2, 2));
  const meta = await appsService.getMeta();
  if (value) {
    meta.capabilities.health_check = value;
    meta.capabilities.health_batch = value;
  }
  await mount({ props: { meta: value ? meta : undefined } });
  await screen.findByText(
    value ? "모니터 앱 1" : "앱 목록을 지금은 불러올 수 없어요.",
  );
  expect(screen.queryByText(healthOperationalNote)).not.toBeInTheDocument();
  for (const button of screen.getAllByRole("button", {
    name: /^(즉시 재검사|전체 재검사)$/,
  })) {
    expect(button.disabled).toBe(value?.enabled === true ? false : true);
    expect(button).not.toHaveAccessibleDescription(healthOperationalNote);
  }
});

it("keeps existing batch progress read recovery available while both health admissions are restricted", async () => {
  setMockScenario("health_batch_query_failure");
  await healthService.requestBatch();
  vi.stubGlobal("__DATA_MODE__", "api");
  const request = vi.spyOn(healthService, "requestBatch");
  const meta = await appsService.getMeta();
  meta.capabilities.health_check = capability(false);
  meta.capabilities.health_batch = capability(false);
  await mount({ props: { meta } });
  await screen.findByText("전체 검사 진행 상태를 불러오지 못했어요.");
  expect(screen.getAllByText(healthOperationalNote)).toHaveLength(1);
  expect(screen.getByRole("button", { name: "전체 재검사" })).toBeDisabled();
  const retry = screen.getByRole("button", { name: "진행 다시 조회" });
  expect(retry).toBeEnabled();
  setMockScenario("original");
  await userEvent.click(retry);
  await screen.findByRole("region", { name: "전체 검사 진행 상황" });
  expect(
    screen.queryByText("전체 검사 진행 상태를 불러오지 못했어요."),
  ).not.toBeInTheDocument();
  expect(request).not.toHaveBeenCalled();
});

it("does not describe a pending enabled batch request as an operational restriction", async () => {
  const pending = deferred();
  const original = healthService.requestBatch;
  vi.spyOn(healthService, "requestBatch").mockReturnValue(pending.promise);
  await mount();
  await userEvent.click(screen.getByRole("button", { name: "전체 재검사" }));
  expect(screen.getByRole("button", { name: "접수 중…" })).toBeDisabled();
  expect(screen.queryByText(healthOperationalNote)).not.toBeInTheDocument();
  await act(async () => pending.resolve(await original()));
  await screen.findByRole("region", { name: "전체 검사 진행 상황" });
});

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
