import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminView } from "../src/features/admin/view-admin";
import { adminService } from "../src/services/mock/admin";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { captureAuthObservation } from "../src/services/auth-state";
import { ServiceError } from "../src/services/service-error";
import { resetMockState, setMockScenario } from "../src/services/mock/state";

const notConfiguredNote =
  "백업 저장 위치와 수신자 설정이 확인되지 않아 백업을 실행할 수 없어요. 기존 목록은 확인할 수 있어요.";

let client;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount(entry = "/admin?tab=backups") {
  await authService.login({ loginId: "admin", password: "admin123" });
  const readContext = captureAuthObservation(
    await authService.getCurrentAuthState(),
    () => true,
  );
  const meta = await appsService.getMeta();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AdminView scopeKey="backups" meta={meta} readContext={readContext} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  if (entry !== "/admin?tab=backups") return {};
  const panel = await screen.findByRole("tabpanel", { name: "백업" });
  const button = within(panel).getByRole("button", { name: "백업 실행" });
  return { panel, button };
}

it("opens the backup tab with an enabled run button and the seeded list", async () => {
  const { panel, button } = await mount();
  const tab = screen.getByRole("tab", { name: "백업" });
  expect(tab).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("main")).toHaveAccessibleName(
    "관리자 대시보드 — 백업",
  );
  await waitFor(() => expect(button).toBeEnabled());
  expect(button).toHaveAccessibleDescription(
    "새 백업은 이 버튼을 눌렀을 때 시작합니다.",
  );
  const list = within(panel).getByRole("list", { name: "백업 목록" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  expect(list).toHaveTextContent("로컬 완료 · 원격 미확인");
});

it("runs a backup, polls until local completion and refreshes the list", async () => {
  const { panel, button } = await mount();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() =>
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "백업을 실행하고 있어요",
    ),
  );
  expect(button).toBeDisabled();
  await waitFor(
    () =>
      expect(within(panel).getByRole("status")).toHaveTextContent(
        "최근 백업: 로컬 완료 · 원격 미확인",
      ),
    { timeout: 5000 },
  );
  expect(
    within(within(panel).getByRole("list", { name: "백업 목록" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(2);
  expect(button).toBeEnabled();
  expect(panel.textContent).not.toMatch(/성공/);
}, 15000);

it("explains an unconfigured backup root on the disabled button", async () => {
  setMockScenario("backup_unconfigured");
  const { panel, button } = await mount();
  await waitFor(() =>
    expect(button).toHaveAccessibleDescription(notConfiguredNote),
  );
  expect(button).toBeDisabled();
  expect(panel).toHaveTextContent("백업 기록이 없어요.");
});

it("reports a failed run without adding an item", async () => {
  setMockScenario("backup_failed");
  const { panel, button } = await mount();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(
    () =>
      expect(within(panel).getByRole("status")).toHaveTextContent(
        "최근 백업이 실패했어요",
      ),
    { timeout: 5000 },
  );
  expect(
    within(within(panel).getByRole("list", { name: "백업 목록" })).getAllByRole(
      "listitem",
    ),
  ).toHaveLength(1);
}, 15000);

it("shows a conflict when another backup is already running", async () => {
  vi.spyOn(adminService, "createBackup").mockRejectedValueOnce(
    new ServiceError("BACKUP_IN_PROGRESS", "busy", { httpStatus: 409 }),
  );
  const { panel, button } = await mount();
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  expect(await within(panel).findByRole("alert")).toHaveTextContent(
    "이미 백업이 실행 중이에요",
  );
});

it("keeps the run button locked until the post-409 refresh settles", async () => {
  const empty = { configured: true, current: null, items: [], invalidCount: 0 };
  let finishRead;
  vi.spyOn(adminService, "listBackups")
    .mockResolvedValueOnce(empty)
    .mockReturnValueOnce(new Promise((resolve) => (finishRead = resolve)))
    .mockResolvedValue(empty);
  const create = vi
    .spyOn(adminService, "createBackup")
    .mockRejectedValue(
      new ServiceError("BACKUP_IN_PROGRESS", "busy", { httpStatus: 409 }),
    );
  const { panel, button } = await mount();
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  expect(await within(panel).findByRole("alert")).toHaveTextContent(
    "이미 백업이 실행 중이에요",
  );
  expect(button).toBeDisabled();
  fireEvent.click(button);
  expect(create).toHaveBeenCalledTimes(1);
  finishRead({
    ...empty,
    current: {
      runId: "00000000-0000-4000-8000-000000000001",
      state: "running",
      startedAt: "2026-11-02T00:00:00Z",
    },
  });
  await waitFor(() =>
    expect(within(panel).getByRole("status")).toHaveTextContent(
      "백업을 실행하고 있어요",
    ),
  );
  expect(button).toBeDisabled();
  expect(create).toHaveBeenCalledTimes(1);
});

it("locks the run button while the status read is failing until a retry succeeds", async () => {
  const empty = { configured: true, current: null, items: [], invalidCount: 0 };
  vi.spyOn(adminService, "listBackups")
    .mockResolvedValueOnce(empty)
    .mockRejectedValueOnce(new ServiceError("NETWORK_ERROR", "offline"))
    .mockResolvedValue(empty);
  const create = vi.spyOn(adminService, "createBackup").mockResolvedValue({
    runId: "00000000-0000-4000-8000-000000000001",
    state: "running",
    startedAt: "2026-11-02T00:00:00Z",
  });
  const { panel, button } = await mount();
  await waitFor(() => expect(button).toBeEnabled());
  fireEvent.click(button);
  await within(panel).findByText("백업 목록을 불러오지 못했어요.");
  expect(button).toBeDisabled();
  fireEvent.click(button);
  fireEvent.click(within(panel).getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(button).toBeEnabled());
  expect(create).toHaveBeenCalledTimes(1);
});

it("cycles Arrow keys through users, health and backups", async () => {
  await mount("/admin?tab=health");
  const health = await screen.findByRole("tab", { name: "Health Monitor" });
  await waitFor(() => expect(health).toBeEnabled());
  health.focus();
  fireEvent.keyDown(health, { key: "ArrowRight" });
  await waitFor(() =>
    expect(screen.getByRole("main")).toHaveAccessibleName(
      "관리자 대시보드 — 백업",
    ),
  );
  const backups = screen.getByRole("tab", { name: "백업" });
  expect(backups).toHaveFocus();
  fireEvent.keyDown(backups, { key: "ArrowRight" });
  await waitFor(() =>
    expect(screen.getByRole("main")).toHaveAccessibleName(
      "관리자 대시보드 — 사용자 관리",
    ),
  );
  expect(screen.getByRole("tab", { name: "사용자 관리" })).toHaveFocus();
});

it("skips the disabled Health Monitor tab in the Arrow key cycle", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const getMeta = appsService.getMeta.bind(appsService);
  vi.spyOn(appsService, "getMeta").mockImplementation(async () => {
    const meta = await getMeta();
    meta.capabilities.admin_apps_read = {
      enabled: false,
      reasons: ["operational_restriction"],
    };
    return meta;
  });
  await mount("/admin");
  const users = await screen.findByRole("tab", { name: "사용자 관리" });
  const health = screen.getByRole("tab", { name: "Health Monitor" });
  const backups = screen.getByRole("tab", { name: "백업" });
  expect(health).toBeDisabled();
  const expectSelected = async (tab, name) => {
    await waitFor(() =>
      expect(screen.getByRole("main")).toHaveAccessibleName(
        `관리자 대시보드 — ${name}`,
      ),
    );
    expect(tab).toHaveAttribute("aria-selected", "true");
    expect(tab).toHaveFocus();
    expect(health).toHaveAttribute("aria-selected", "false");
    expect(
      screen.getAllByRole("tab").filter((item) => item.tabIndex === 0),
    ).toEqual([tab]);
  };
  users.focus();
  fireEvent.keyDown(users, { key: "ArrowRight" });
  await expectSelected(backups, "백업");
  fireEvent.keyDown(backups, { key: "ArrowLeft" });
  await expectSelected(users, "사용자 관리");
  fireEvent.keyDown(users, { key: "ArrowLeft" });
  await expectSelected(backups, "백업");
  fireEvent.keyDown(backups, { key: "ArrowRight" });
  await expectSelected(users, "사용자 관리");
});

it("never claims success in the backup UI source", () => {
  const source = readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../src/features/admin/backup-controls.jsx",
    ),
    "utf8",
  );
  expect(source).not.toMatch(/성공|완료됐/);
});
