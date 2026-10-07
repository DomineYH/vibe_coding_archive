import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCallback, useState } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminView } from "../src/features/admin/view-admin";
import { ServiceError } from "../src/services/service-error";
import { adminService } from "../src/services/mock/admin";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { resetMockState } from "../src/services/mock/state";

// A confirmed account deletion must retire the deleted owner's apps from a
// Health Monitor that was already loaded, held or refreshing.
const STALE = "삭제된 작성자의 앱";
const KEPT = "남아 있는 작성자의 앱";
const checked = "2026-10-01T00:00:00.000Z";
const health = {
  state: "unchecked",
  checked_at: null,
  fresh_until: null,
};
let client;
let target;
let keeper;
let meta;
const row = (n, owner, name) => ({
  id: `00000000-0000-4000-8000-00000000055${n}`,
  ownerId: owner.id,
  owner: owner.nickname,
  name,
  url: "https://example.test",
  isPublic: false,
  themeId: "niagara",
  version: 1,
  urlVersion: 1,
  createdAt: checked,
  health,
});
const listing = () => ({
  items: [row(1, target, STALE), row(2, keeper, KEPT)],
  pagination: { limit: 24, offset: 0, total: 2, hasMore: false },
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
const never = () => new Promise(() => {});

beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  await authService.login({ loginId: "admin", password: "admin123" });
  await authService.reauthenticate({ password: "admin123" });
  const users = (await adminService.listUsers()).items;
  target = users.find((item) => item.nickname === "비기너개발자");
  keeper = users.find((item) => item.id !== target.id && item.appCount > 0);
  meta = await appsService.getMeta();
  for (const key of [
    "admin_apps_read",
    "admin_user_delete",
    "admin_users_read",
  ])
    meta.capabilities[key] = { enabled: true, reasons: [] };
  vi.stubGlobal("__DATA_MODE__", "api");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Restored() {
  const [resume, setResume] = useState({
    adminDelete: { targetId: target.id },
  });
  const consume = useCallback(() => setResume(null), []);
  return (
    <AdminView
      scopeKey="delete-monitor"
      meta={meta}
      resumeState={resume}
      onConsumeResume={consume}
    />
  );
}

// The restored target stays unconsumed while its first detail read is held, so
// the deletion panel resumes again after the tab round trip.
async function mount() {
  const readTarget = adminService.getUser;
  const hold = vi
    .spyOn(adminService, "getUser")
    .mockImplementationOnce(never)
    .mockImplementation(readTarget);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin"]}>
        <Restored />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(hold).toHaveBeenCalledTimes(1));
  const user = userEvent.setup();
  const tab = (name) => user.click(screen.getByRole("tab", { name }));
  const confirm = async () =>
    user.click(
      await screen.findByRole("button", { name: "삭제 확인", exact: true }),
    );
  return { user, tab, confirm };
}

const deletionRegion = () => screen.getByRole("region", { name: /계정.*삭제/ });
const cachedNames = () =>
  client
    .getQueryCache()
    .findAll({ queryKey: ["api", "admin", "apps", "delete-monitor"] })
    .flatMap((query) => query.state.data?.pages ?? [])
    .flatMap((page) => page.items.map((app) => app.name));

it("does not re-show the deleted owner's app from the loaded monitor while the refresh is delayed", async () => {
  const list = vi
    .spyOn(adminService, "listApps")
    .mockResolvedValueOnce(listing())
    .mockImplementation(never);
  const { tab, confirm } = await mount();
  await tab("Health Monitor");
  await screen.findByText(STALE);
  await tab("사용자 관리");
  await confirm();
  await waitFor(() =>
    expect(deletionRegion()).toHaveTextContent("삭제가 확정됐어요"),
  );
  expect(cachedNames()).not.toContain(STALE);
  await tab("Health Monitor");
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  expect(screen.queryByText(KEPT)).not.toBeInTheDocument();
});

it("does not install a monitor read that was already in flight when the deletion was confirmed", async () => {
  const held = deferred();
  const list = vi
    .spyOn(adminService, "listApps")
    .mockImplementationOnce(() => held.promise)
    .mockImplementation(never);
  const { tab, confirm } = await mount();
  await tab("Health Monitor");
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
  await tab("사용자 관리");
  await confirm();
  await waitFor(() =>
    expect(deletionRegion()).toHaveTextContent("삭제가 확정됐어요"),
  );
  held.resolve(listing());
  await tab("Health Monitor");
  await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  expect(cachedNames()).not.toContain(STALE);
});

it("keeps the deleted owner's app absent when the refresh after deletion fails", async () => {
  const list = vi
    .spyOn(adminService, "listApps")
    .mockResolvedValueOnce(listing())
    .mockRejectedValue(
      new ServiceError("SERVICE_UNAVAILABLE", "unavailable", {
        httpStatus: 503,
      }),
    );
  const { tab, confirm } = await mount();
  await tab("Health Monitor");
  await screen.findByText(STALE);
  await tab("사용자 관리");
  await confirm();
  await waitFor(() =>
    expect(deletionRegion()).toHaveTextContent("삭제가 확정됐어요"),
  );
  await tab("Health Monitor");
  await screen.findByText("앱 목록을 불러오지 못했어요.");
  expect(list.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText(STALE)).not.toBeInTheDocument();
  expect(screen.queryByText(KEPT)).not.toBeInTheDocument();
});

it("also retires the deleted owner's app when the deletion is applied but its confirmation is pending", async () => {
  vi.spyOn(adminService, "deleteUser").mockRejectedValue(
    new ServiceError("DELETION_CONFIRMATION_PENDING", "pending", {
      httpStatus: 503,
      outcome: "unknown",
    }),
  );
  vi.spyOn(adminService, "getUserDeleteOperation").mockRejectedValue(
    new Error("lookup unavailable"),
  );
  vi.spyOn(adminService, "listApps")
    .mockResolvedValueOnce(listing())
    .mockImplementation(never);
  const { tab, confirm } = await mount();
  await tab("Health Monitor");
  await screen.findByText(STALE);
  await tab("사용자 관리");
  await confirm();
  await waitFor(() =>
    expect(deletionRegion()).toHaveTextContent(
      "삭제는 반영됐고 별도 확인을 기다리고 있어요",
    ),
  );
  expect(cachedNames()).not.toContain(STALE);
  expect(cachedNames()).toHaveLength(0);
});
