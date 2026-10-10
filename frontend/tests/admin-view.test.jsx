import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  act,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminView } from "../src/features/admin/view-admin";
import { adminService } from "../src/services/mock/admin";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import {
  getMockSnapshot,
  MOCK_STORAGE_KEY,
  resetMockState,
  setMockClock,
  setMockScenario,
} from "../src/services/mock/state";

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

const resetNote = "임시 비밀번호 설정 기능은 아직 준비 중이에요.";
const resetOperationalNote =
  "비밀번호 초기화 운영 준비가 확인되지 않아 임시 비밀번호를 설정할 수 없어요.";
const deleteNote = "회원 삭제 기능은 아직 준비 중이에요.";

async function renderApiMembers(reset, deletion, entry = "/admin") {
  const meta = await appsService.getMeta();
  meta.capabilities.admin_password_reset = reset;
  meta.capabilities.admin_user_delete = deletion;
  vi.stubGlobal("__DATA_MODE__", "api");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AdminView
          scopeKey="disabled-reasons"
          meta={meta}
          resumeState={typeof entry === "object" ? entry.state : null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return (await screen.findAllByText("비기너개발자"))[0].closest(
    '[role="listitem"]',
  );
}

const enabled = { enabled: true, reasons: [] };
const unimplemented = { enabled: false, reasons: ["not_implemented"] };

it.each(["not_implemented", "operational_restriction"])(
  "keeps mock actions enabled without restriction notes for %s metadata",
  async (reason) => {
    vi.stubGlobal("__DATA_MODE__", "mock");
    const meta = await appsService.getMeta();
    expect(meta.capabilities.admin_password_reset).toEqual(unimplemented);
    expect(meta.capabilities.admin_user_delete).toEqual(unimplemented);
    meta.capabilities.admin_password_reset = {
      enabled: false,
      reasons: [reason],
    };
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminView scopeKey="mock-disabled-reasons" meta={meta} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = (await screen.findByText("비기너개발자")).closest(
      '[role="listitem"]',
    );
    for (const name of ["임시 비밀번호 설정", "삭제"]) {
      const button = within(row).getByRole("button", { name, exact: true });
      expect(button).toBeEnabled();
      expect(button).not.toHaveAttribute("aria-describedby");
    }
    expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
    expect(screen.queryByText(resetOperationalNote)).not.toBeInTheDocument();
  },
);

it.each([
  [unimplemented, unimplemented, false, false],
  [unimplemented, enabled, false, false],
  [enabled, unimplemented, false, false],
  [
    { enabled: false, reasons: ["operational_restriction", "not_implemented"] },
    unimplemented,
    true,
    false,
  ],
])(
  "connects only operationally restricted reset actions to a visible notice: %j / %j",
  async (reset, deletion, hasResetNote, hasDeleteNote) => {
    const row = await renderApiMembers(reset, deletion);
    for (const [name, copy, shown] of [
      ["임시 비밀번호 설정", resetOperationalNote, hasResetNote],
      ["삭제", deleteNote, hasDeleteNote],
    ]) {
      const button = within(row).getByRole("button", { name, exact: true });
      const note = screen.queryByText(copy);
      if (shown) {
        expect(note).toBeVisible();
        expect(button).toBeDisabled();
        expect(note.id).not.toBe("");
        expect(button).toHaveAttribute("aria-describedby", note.id);
        expect(button).toHaveAccessibleDescription(copy);
        expect(
          note.closest('[role="alert"], [aria-live="assertive"]'),
        ).toBeNull();
      } else {
        expect(note).not.toBeInTheDocument();
        expect(button.disabled).toBe(
          name === "임시 비밀번호 설정" ? !reset.enabled : !deletion.enabled,
        );
        expect(button).not.toHaveAttribute("aria-describedby");
      }
    }
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["임시 비밀번호 설정", "삭제", "승인하기"]);
    expect(within(row).getByRole("button", { name: "승인하기" })).toBeEnabled();
    expect(screen.queryByText(resetNote)).not.toBeInTheDocument();
  },
);

it.each([
  [enabled, enabled],
  [unimplemented, unimplemented],
  [{ enabled: false, reasons: ["verification_pending"] }, unimplemented],
  [{ enabled: true, reasons: ["operational_restriction"] }, enabled],
])(
  "does not label other reset restrictions as preparation: %j",
  async (reset, deletion) => {
    const row = await renderApiMembers(reset, deletion);
    expect(within(row).queryByText(resetNote)).not.toBeInTheDocument();
    expect(screen.queryByText(resetOperationalNote)).not.toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "임시 비밀번호 설정" }),
    ).not.toHaveAttribute("aria-describedby");
    if (reset.enabled) {
      expect(within(row).queryByText(deleteNote)).not.toBeInTheDocument();
      for (const name of ["임시 비밀번호 설정", "삭제"]) {
        expect(
          within(row).getByRole("button", { name, exact: true }),
        ).toBeEnabled();
      }
    } else {
      expect(
        within(row).getByRole("button", { name: "임시 비밀번호 설정" }),
      ).toBeDisabled();
    }
  },
);

it("shares one visible reset restriction across members, protects admins and removes its references when enabled", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  const issue = vi.spyOn(adminService, "createPasswordResetOperation");
  const execute = vi.spyOn(adminService, "setPasswordReset");
  const readTarget = vi.spyOn(adminService, "getUser");
  const meta = await appsService.getMeta();
  meta.capabilities.admin_password_reset = {
    enabled: false,
    reasons: ["operational_restriction"],
  };
  const tree = (metadata) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminView scopeKey="reset-restriction" meta={metadata} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(meta));
  await screen.findByText("비기너개발자");
  const note = screen.getByText(resetOperationalNote);
  expect(note).toBeVisible();
  const buttons = screen.getAllByRole("button", { name: "임시 비밀번호 설정" });
  expect(buttons.length).toBeGreaterThanOrEqual(2);
  for (const button of buttons) {
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(resetOperationalNote);
    expect(button).toHaveAttribute("aria-describedby", note.id);
    await userEvent.click(button);
  }
  expect(view.container.querySelectorAll(`#${note.id}`)).toHaveLength(1);
  const protectedRow = screen
    .getByText("보호된 계정")
    .closest('[role="listitem"]');
  expect(within(protectedRow).queryByRole("button")).not.toBeInTheDocument();
  expect(issue).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(readTarget).not.toHaveBeenCalled();

  view.rerender(
    tree({
      ...meta,
      capabilities: { ...meta.capabilities, admin_password_reset: enabled },
    }),
  );
  expect(screen.queryByText(resetOperationalNote)).not.toBeInTheDocument();
  for (const button of buttons) {
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
  }
});

it.each(["operational_restriction", "verification_pending"])(
  "does not label deletion reason %s as preparation",
  async (reason) => {
    const row = await renderApiMembers(enabled, {
      enabled: false,
      reasons: [reason],
    });
    expect(within(row).queryByText(deleteNote)).not.toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: "삭제", exact: true }),
    ).toBeDisabled();
    expect(
      within(row).getByRole("button", { name: "삭제", exact: true }),
    ).not.toHaveAttribute("aria-describedby");
  },
);

it("keeps unresolved metadata free of preparation notes", async () => {
  vi.stubGlobal("__DATA_MODE__", "api");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminView scopeKey="unresolved-meta" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const row = (await screen.findByText("비기너개발자")).closest(
    '[role="listitem"]',
  );
  for (const name of ["임시 비밀번호 설정", "삭제"]) {
    const button = within(row).getByRole("button", { name, exact: true });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-describedby");
  }
  expect(within(row).queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
  expect(screen.queryByText(resetOperationalNote)).not.toBeInTheDocument();
});

it("keeps unavailable deletion disabled without preparation text and protects administrators", async () => {
  await renderApiMembers(unimplemented, unimplemented);
  const rows = within(
    screen.getByRole("list", { name: "회원 목록" }),
  ).getAllByRole("listitem");
  const memberRows = rows.filter((row) =>
    within(row).queryByRole("button", { name: "삭제", exact: true }),
  );
  expect(memberRows.length).toBeGreaterThanOrEqual(2);
  for (const row of rows) {
    const button = within(row).queryByRole("button", {
      name: "삭제",
      exact: true,
    });
    if (button) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute("aria-describedby");
      expect(within(row).queryByText(deleteNote)).not.toBeInTheDocument();
    }
  }
  const protectedRow = screen
    .getByText("보호된 계정")
    .closest('[role="listitem"]');
  expect(within(protectedRow).queryByRole("button")).not.toBeInTheDocument();
  expect(
    within(protectedRow).queryByText(/아직 준비 중이에요/),
  ).not.toBeInTheDocument();
});

it("does not show preparation notes while an approval request alone locks actions", async () => {
  const user = userEvent.setup();
  let release;
  const original = adminService.setApproval;
  vi.spyOn(adminService, "setApproval").mockImplementation(
    (...args) =>
      new Promise((resolve) => {
        release = async () => resolve(await original(...args));
      }),
  );
  const row = await renderApiMembers(enabled, enabled);
  await user.click(
    within(row).getByRole("button", { name: "승인하기", exact: true }),
  );
  const panel = await screen.findByRole("region", { name: /회원 승인 확인/ });
  await user.click(
    within(panel).getByRole("button", { name: "승인하기 확인", exact: true }),
  );
  await waitFor(() => expect(release).toBeTypeOf("function"));
  for (const name of ["임시 비밀번호 설정", "삭제"]) {
    const button = within(row).getByRole("button", { name, exact: true });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-describedby");
  }
  expect(within(row).queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
  expect(screen.queryByText(resetOperationalNote)).not.toBeInTheDocument();
  await act(async () => release());
  await waitFor(() =>
    expect(
      within(row).getByRole("button", { name: "삭제", exact: true }),
    ).toBeEnabled(),
  );
});

it("does not show preparation notes while an unresolved password reset alone locks actions", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (user) => user.nickname === "비기너개발자",
  );
  const operation = await adminService.createPasswordResetOperation({
    targetId: target.id,
    expectedAccountVersion: target.accountVersion,
    newPassword: "A temporary test password 163!",
  });
  const row = await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: {
      adminReset: {
        targetId: target.id,
        operationKey: operation.key,
        expectedAccountVersion: target.accountVersion,
      },
    },
  });
  for (const name of ["임시 비밀번호 설정", "삭제"]) {
    const button = within(row).getByRole("button", { name, exact: true });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-describedby");
  }
  expect(within(row).queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
  expect(screen.queryByText(resetOperationalNote)).not.toBeInTheDocument();
});

it.each(["original", "admin_write_unknown"])(
  "shows applied approval and revocation results with mock scenario %s",
  async (scenario) => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin"]}>
          <AdminView scopeKey="approval-regression" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = (await screen.findByText("비기너개발자")).closest(
      '[role="listitem"]',
    );
    setMockScenario(scenario);

    for (const [action, value, version, guidance] of [
      ["승인하기", "승인", 2, "승인 후 회원은 로그인할 수 있습니다"],
      ["승인 해제", "미승인", 3, "승인을 해제하면"],
    ]) {
      await user.click(
        within(row).getByRole("button", { name: action, exact: true }),
      );
      const panel = await screen.findByRole("region", {
        name: /회원 승인 확인/,
      });
      expect(panel).toHaveTextContent(
        `승인 값: ${value}·대상 버전: ${version - 1}`,
      );
      expect(panel).toHaveTextContent(guidance);
      await user.click(
        within(panel).getByRole("button", {
          name: `${action} 확인`,
          exact: true,
        }),
      );
      if (scenario === "admin_write_unknown") {
        await waitFor(() =>
          expect(within(panel).getByRole("status")).toHaveTextContent(
            "처리 결과가 아직 확정되지 않았어요",
          ),
        );
        expect(panel).toHaveTextContent(
          `승인 값: ${value}·대상 버전: ${version - 1}`,
        );
        expect(panel).toHaveTextContent(guidance);
        await user.click(
          within(panel).getByRole("button", { name: "결과 확인", exact: true }),
        );
      }
      await waitFor(() =>
        expect(within(panel).getByRole("status")).toHaveTextContent(
          "요청한 승인 상태가 확정됐어요",
        ),
      );
      await waitFor(() => expect(row).toHaveTextContent(`버전 ${version}`));
      expect(panel).toHaveTextContent(
        `승인 값: ${value}·반영 버전: ${version}`,
      );
      expect(panel).not.toHaveTextContent("승인을 해제하면");
      expect(panel).not.toHaveTextContent(
        "승인 후 회원은 로그인할 수 있습니다",
      );
      await user.click(
        within(panel).getByRole("button", { name: "닫기", exact: true }),
      );
      expect(
        screen.queryByRole("region", { name: /회원 승인 확인/ }),
      ).not.toBeInTheDocument();
    }
  },
);

it("does not execute a late issued reset after the protected view becomes inactive", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (user) => user.nickname === "비기너개발자",
  );
  let release;
  const issue = vi
    .spyOn(adminService, "createPasswordResetOperation")
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
  const execute = vi.spyOn(adminService, "setPasswordReset");
  const resumeState = { adminReset: { targetId: target.id } };
  const tree = (active) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminView
          scopeKey="late-reset"
          active={active}
          resumeState={resumeState}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("임시 비밀번호", { exact: true }),
    "Synthetic temporary password 167!",
  );
  await user.type(
    screen.getByLabelText("임시 비밀번호 확인"),
    "Synthetic temporary password 167!",
  );
  await user.click(
    screen.getByRole("button", { name: "초기화 확인", exact: true }),
  );
  await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
  view.rerender(tree(false));
  await act(async () => release({ key: "late-key", state: "unresolved" }));
  expect(execute).not.toHaveBeenCalled();
  expect(
    screen.queryByLabelText("임시 비밀번호", { exact: true }),
  ).not.toBeInTheDocument();
});

async function recoverySelection() {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (user) => user.nickname === "비기너개발자",
  );
  const operation = await adminService.createPasswordResetOperation({
    targetId: target.id,
    expectedAccountVersion: target.accountVersion,
    newPassword: "Synthetic temporary password 167!",
  });
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: {
      adminReset: {
        targetId: target.id,
        operationKey: operation.key,
        expectedAccountVersion: target.accountVersion,
      },
    },
  });
  await screen.findByLabelText("임시 비밀번호", { exact: true });
  return { target, operation };
}

it.each([false, true])(
  "discards retry inputs and validation on cancel before confirmation and a fresh decision (invalid: %s)",
  async (invalid) => {
    const { operation } = await recoverySelection();
    let confirmCancel;
    vi.spyOn(adminService, "cancelPasswordResetOperation").mockImplementation(
      () =>
        new Promise((resolve) => {
          confirmCancel = resolve;
        }),
    );
    const user = userEvent.setup();
    await user.type(
      screen.getByLabelText("임시 비밀번호", { exact: true }),
      "Synthetic temporary password 167!",
    );
    await user.type(
      screen.getByLabelText("임시 비밀번호 확인"),
      invalid ? "Different confirmation" : "Synthetic temporary password 167!",
    );
    if (invalid) {
      await user.click(
        screen.getByRole("button", { name: "같은 초기화 요청 다시 제출" }),
      );
      expect(screen.getByLabelText("임시 비밀번호 확인")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
    }
    await user.click(
      screen.getByRole("button", { name: "초기화 요청 취소", exact: true }),
    );
    for (const label of ["임시 비밀번호", "임시 비밀번호 확인"]) {
      const input = screen.getByLabelText(label, { exact: true });
      expect(input.value.length).toBe(0);
      expect(input).not.toHaveAttribute("aria-invalid");
    }
    await act(async () =>
      confirmCancel({
        ...operation,
        state: "rejected",
        rejectionCode: "OPERATION_CANCELLED",
      }),
    );
    await screen.findByText("초기화 요청 취소가 확정됐어요.");
    expect(
      screen.queryByLabelText("임시 비밀번호", { exact: true }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "현재 회원 확인 후 새 초기화 판단" }),
    );
    await screen.findByLabelText("임시 비밀번호", { exact: true });
    for (const label of ["임시 비밀번호", "임시 비밀번호 확인"]) {
      const input = screen.getByLabelText(label, { exact: true });
      expect(input.value.length).toBe(0);
      expect(input).not.toHaveAttribute("aria-invalid");
    }
  },
);

it("expired result refresh preserves the key and does not offer a new reset", async () => {
  await recoverySelection();
  const { ServiceError } = await import("../src/services/service-error");
  vi.spyOn(adminService, "getPasswordResetOperation").mockRejectedValue(
    new ServiceError("OPERATION_EXPIRED", "expired"),
  );
  const create = vi.spyOn(adminService, "createPasswordResetOperation");
  const execute = vi.spyOn(adminService, "setPasswordReset");
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "결과 확인", exact: true }),
  );
  await user.click(
    await screen.findByRole("button", { name: "현재 회원 상태 다시 확인" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByLabelText("임시 비밀번호", { exact: true }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByText("작업 키가 만료되어 과거 결과를 확인할 수 없어요."),
  ).toBeVisible();
  expect(create).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
});

it("a cancel that observes prior success refreshes lists even if target lookup fails", async () => {
  const { operation } = await recoverySelection();
  const { ServiceError } = await import("../src/services/service-error");
  vi.spyOn(adminService, "cancelPasswordResetOperation").mockResolvedValue({
    ...operation,
    state: "succeeded",
    appliedAccountVersion: 2,
    finalizedAt: "2026-10-01T00:00:00Z",
    temporaryPasswordExpiresAt: "2026-10-02T00:00:00Z",
  });
  vi.spyOn(adminService, "getUser").mockRejectedValue(
    new ServiceError("USER_NOT_FOUND", "deleted"),
  );
  const list = vi.spyOn(adminService, "listUsers");
  await userEvent
    .setup()
    .click(
      screen.getByRole("button", { name: "초기화 요청 취소", exact: true }),
    );
  await screen.findByText(
    "임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.",
  );
  expect(list).toHaveBeenCalled();
  expect(
    screen.queryByText("초기화 요청 취소가 확정됐어요."),
  ).not.toBeInTheDocument();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain("Synthetic temporary password 167!");
});

it.each(["OPERATION_NOT_FOUND", "SERVICE_UNAVAILABLE"])(
  "an unavailable result %s blocks secret entry and execution until a successful lookup",
  async (code) => {
    const { operation } = await recoverySelection();
    const { ServiceError } = await import("../src/services/service-error");
    vi.spyOn(adminService, "getPasswordResetOperation")
      .mockRejectedValueOnce(new ServiceError(code, "unknown"))
      .mockResolvedValue(operation);
    const execute = vi.spyOn(adminService, "setPasswordReset");
    const create = vi.spyOn(adminService, "createPasswordResetOperation");
    const user = userEvent.setup();
    for (const label of ["임시 비밀번호", "임시 비밀번호 확인"])
      await user.type(
        screen.getByLabelText(label, { exact: true }),
        "Synthetic temporary password 167!",
      );
    await user.click(
      screen.getByRole("button", { name: "결과 확인", exact: true }),
    );
    await waitFor(() =>
      expect(
        screen.queryByLabelText("임시 비밀번호", { exact: true }),
      ).not.toBeInTheDocument(),
    );
    expect(execute).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "결과 확인", exact: true }),
    );
    await screen.findByLabelText("임시 비밀번호", { exact: true });
    for (const label of ["임시 비밀번호", "임시 비밀번호 확인"])
      expect(screen.getByLabelText(label, { exact: true }).value.length).toBe(
        0,
      );
  },
);

it("does not execute a late issuance after navigation conceals the mounted member view", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (user) => user.nickname === "비기너개발자",
  );
  let release;
  vi.spyOn(adminService, "createPasswordResetOperation").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const execute = vi.spyOn(adminService, "setPasswordReset");
  const resumeState = { adminReset: { targetId: target.id } };
  function MountedView() {
    const navigate = useNavigate();
    return (
      <>
        <button onClick={() => navigate("/admin?tab=invalid")}>
          Conceal member view
        </button>
        <AdminView scopeKey="hidden-route" resumeState={resumeState} />
      </>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MountedView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(
    await screen.findByLabelText("임시 비밀번호", { exact: true }),
    "Synthetic temporary password 167!",
  );
  await user.type(
    screen.getByLabelText("임시 비밀번호 확인"),
    "Synthetic temporary password 167!",
  );
  await user.click(
    screen.getByRole("button", { name: "초기화 확인", exact: true }),
  );
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await user.click(screen.getByRole("button", { name: "Conceal member view" }));
  await act(async () => release({ key: "late-key", state: "unresolved" }));
  expect(execute).not.toHaveBeenCalled();
  expect(
    screen.queryByLabelText("임시 비밀번호", { exact: true }),
  ).not.toBeInTheDocument();
});

it("does not execute a late issued deletion after the view becomes inactive", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.nickname === "비기너개발자",
  );
  let release;
  const issue = vi
    .spyOn(adminService, "createUserDeleteOperation")
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
  const execute = vi.spyOn(adminService, "deleteUser");
  const resumeState = { adminDelete: { targetId: target.id } };
  const tree = (active) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminView
          scopeKey="late-delete"
          active={active}
          resumeState={resumeState}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(tree(true));
  await userEvent
    .setup()
    .click(
      await screen.findByRole("button", { name: "삭제 확인", exact: true }),
    );
  await waitFor(() => expect(issue).toHaveBeenCalledTimes(1));
  view.rerender(tree(false));
  await act(async () =>
    release({ key: "late-key", targetId: target.id, state: "unresolved" }),
  );
  expect(execute).not.toHaveBeenCalled();
});

it("shows deletion recovery only after the submitted attempt settles", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.nickname === "비기너개발자",
  );
  const issue = vi.spyOn(adminService, "createUserDeleteOperation");
  let rejectExecution;
  vi.spyOn(adminService, "deleteUser").mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        rejectExecution = reject;
      }),
  );
  const read = vi.spyOn(adminService, "getUserDeleteOperation");
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: { adminDelete: { targetId: target.id } },
  });
  await userEvent
    .setup()
    .click(
      await screen.findByRole("button", { name: "삭제 확인", exact: true }),
    );
  await waitFor(() => expect(rejectExecution).toBeTypeOf("function"));
  const panel = screen.getByRole("region", { name: /계정.*삭제/ });
  expect(panel).toHaveAttribute("aria-busy", "true");
  expect(panel).not.toHaveTextContent("삭제 결과가 아직 확정되지 않았어요");
  expect(
    within(panel).queryByRole("button", { name: "결과 확인", exact: true }),
  ).not.toBeInTheDocument();
  await act(async () => rejectExecution(new Error("response lost")));
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
  expect(panel).toHaveTextContent("삭제 결과가 아직 확정되지 않았어요");
  expect(
    within(panel).getByRole("button", { name: "결과 확인", exact: true }),
  ).toBeEnabled();
  expect(issue).toHaveBeenCalledTimes(1);
  const operation = await issue.mock.results[0].value;
  expect(read).toHaveBeenCalledWith(operation.key);
});

it("keeps definitive deletion success visible after row removal without requiring GET", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.nickname === "비기너개발자",
  );
  const read = vi
    .spyOn(adminService, "getUserDeleteOperation")
    .mockRejectedValue(new Error("lookup unavailable"));
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: { adminDelete: { targetId: target.id } },
  });
  await userEvent
    .setup()
    .click(
      await screen.findByRole("button", { name: "삭제 확인", exact: true }),
    );
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: /계정.*삭제/ }),
    ).toHaveTextContent("삭제가 확정됐어요"),
  );
  const panel = screen.getByRole("region", { name: /계정.*삭제/ });
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
  expect(panel).not.toHaveTextContent("현재 대상을 불러오지 못했어요");
  expect(screen.queryByText(target.nickname)).not.toBeInTheDocument();
  expect(read).not.toHaveBeenCalled();
  const close = within(panel).getByRole("button", {
    name: "닫기",
    exact: true,
  });
  expect(close).toBeEnabled();
  await userEvent.setup().click(close);
  expect(panel).not.toBeInTheDocument();
});

it("shows operation-confirmed deletion success when the target is missing", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.role === "user" && item.nickname !== "비기너개발자",
  );
  const operation = await adminService.createUserDeleteOperation({
    targetId: target.id,
    expectedAppCount: target.appCount,
  });
  await adminService.deleteUser(target.id, target.appCount, operation.key);
  const read = vi.spyOn(adminService, "getUserDeleteOperation");
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: {
      adminDelete: {
        targetId: target.id,
        operationKey: operation.key,
        expectedAppCount: target.appCount,
      },
    },
  });
  const panel = await screen.findByRole("region", { name: /계정.*삭제/ });
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
  expect(panel).toHaveTextContent(
    `회원 계정과 소유 앱 ${target.appCount}개 삭제가 확정됐어요.`,
  );
  expect(panel).not.toHaveTextContent("현재 대상을 불러오지 못했어요");
  expect(screen.queryByText(target.nickname)).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledWith(operation.key);
  const close = within(panel).getByRole("button", {
    name: "닫기",
    exact: true,
  });
  expect(close).toBeEnabled();
  await userEvent.setup().click(close);
  expect(panel).not.toBeInTheDocument();
});

it.each([false, true])(
  "keeps missing-target warnings without confirmed deletion (failed lookup: %s)",
  async (failedLookup) => {
    const { ServiceError } = await import("../src/services/service-error");
    await authService.reauthenticate({ password: "admin123" });
    const target = (await adminService.listUsers()).items.find(
      (item) => item.nickname === "비기너개발자",
    );
    const operation = failedLookup
      ? await adminService.createUserDeleteOperation({
          targetId: target.id,
          expectedAppCount: target.appCount,
        })
      : null;
    vi.spyOn(adminService, "getUser").mockRejectedValue(
      new ServiceError("USER_NOT_FOUND", "회원을 찾을 수 없어요."),
    );
    const read = vi
      .spyOn(adminService, "getUserDeleteOperation")
      .mockRejectedValue(new Error("lookup unavailable"));
    await renderApiMembers(enabled, enabled, {
      pathname: "/admin",
      state: {
        adminDelete: {
          targetId: target.id,
          operationKey: operation?.key,
          expectedAppCount: target.appCount,
        },
      },
    });
    const panel = await screen.findByRole("region", { name: /계정.*삭제/ });
    await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
    expect(panel).toHaveTextContent("현재 대상을 불러오지 못했어요");
    expect(panel).not.toHaveTextContent("삭제가 확정됐어요");
    if (failedLookup) {
      expect(panel).toHaveTextContent("삭제 결과가 아직 확정되지 않았어요");
      const result = within(panel).getByRole("button", {
        name: "결과 확인",
        exact: true,
      });
      expect(result).toBeEnabled();
      await userEvent.setup().click(result);
      expect(read).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenLastCalledWith(operation.key);
      expect(panel).toHaveTextContent("현재 대상을 불러오지 못했어요");
      expect(panel).not.toHaveTextContent("삭제가 확정됐어요");
    } else {
      expect(read).not.toHaveBeenCalled();
      expect(
        within(panel).getByRole("button", {
          name: "현재 회원 정보 다시 확인",
          exact: true,
        }),
      ).toBeEnabled();
    }
  },
);

it("keeps an expired original deletion key when refreshing the target", async () => {
  const { ServiceError } = await import("../src/services/service-error");
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.nickname === "비기너개발자",
  );
  const operation = await adminService.createUserDeleteOperation({
    targetId: target.id,
    expectedAppCount: target.appCount,
  });
  const read = vi
    .spyOn(adminService, "getUserDeleteOperation")
    .mockRejectedValue(
      new ServiceError("OPERATION_EXPIRED", "expired", { httpStatus: 410 }),
    );
  const issue = vi.spyOn(adminService, "createUserDeleteOperation");
  const execute = vi.spyOn(adminService, "deleteUser");
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: {
      adminDelete: {
        targetId: target.id,
        operationKey: operation.key,
        expectedAppCount: target.appCount,
      },
    },
  });
  await screen.findByText(/작업 키가 만료되어/);
  await userEvent.setup().click(
    screen.getByRole("button", {
      name: "현재 회원 정보 다시 확인",
      exact: true,
    }),
  );
  expect(
    screen.queryByRole("button", { name: "삭제 확인", exact: true }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "같은 삭제 요청 다시 제출" }),
  ).not.toBeInTheDocument();
  expect(issue).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  expect(read).toHaveBeenCalledWith(operation.key);
});

it("retires a pending deletion even when result lookup fails", async () => {
  const { ServiceError } = await import("../src/services/service-error");
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.nickname === "비기너개발자",
  );
  vi.spyOn(adminService, "deleteUser").mockRejectedValue(
    new ServiceError("DELETION_CONFIRMATION_PENDING", "pending", {
      httpStatus: 503,
      outcome: "unknown",
    }),
  );
  vi.spyOn(adminService, "getUserDeleteOperation").mockRejectedValue(
    new Error("lookup unavailable"),
  );
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: { adminDelete: { targetId: target.id } },
  });
  await userEvent
    .setup()
    .click(
      await screen.findByRole("button", { name: "삭제 확인", exact: true }),
    );
  await waitFor(() =>
    expect(
      screen.getByRole("region", { name: /계정.*삭제/ }),
    ).toHaveTextContent("삭제는 반영됐고 별도 확인을 기다리고 있어요"),
  );
  expect(
    screen.queryByRole("button", { name: "같은 삭제 요청 다시 제출" }),
  ).not.toBeInTheDocument();
});

it("does not enable same-key execution while deletion lookup is unknown", async () => {
  await authService.reauthenticate({ password: "admin123" });
  const target = (await adminService.listUsers()).items.find(
    (item) => item.nickname === "비기너개발자",
  );
  const operation = await adminService.createUserDeleteOperation({
    targetId: target.id,
    expectedAppCount: target.appCount,
  });
  vi.spyOn(adminService, "getUserDeleteOperation").mockRejectedValue(
    new Error("unknown"),
  );
  const execute = vi.spyOn(adminService, "deleteUser");
  await renderApiMembers(enabled, enabled, {
    pathname: "/admin",
    state: {
      adminDelete: {
        targetId: target.id,
        operationKey: operation.key,
        expectedAppCount: target.appCount,
      },
    },
  });
  await screen.findByText(/삭제 결과가 아직 확정되지 않았어요/);
  expect(
    screen.queryByRole("button", { name: "같은 삭제 요청 다시 제출" }),
  ).not.toBeInTheDocument();
  expect(execute).not.toHaveBeenCalled();
});

function PanelLocation() {
  const location = useLocation();
  return (
    <output data-testid="panel-location">{JSON.stringify(location)}</output>
  );
}

function panelTree(props = {}) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin"]}>
        <PanelLocation />
        <AdminView scopeKey="direct-panels" {...props} />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function clickMemberAction(kind, nickname = "비기너개발자") {
  const row = (await screen.findByText(nickname)).closest('[role="listitem"]');
  await userEvent.setup().click(
    within(row).getByRole("button", {
      name: kind === "reset" ? "임시 비밀번호 설정" : "삭제",
      exact: true,
    }),
  );
  const panel = await screen.findByRole("region", {
    name: kind === "reset" ? /임시 비밀번호 초기화 확인/ : /계정.*삭제/,
  });
  await waitFor(() => expect(panel).toHaveAttribute("aria-busy", "false"));
  return panel;
}

async function confirmMemberAction(kind) {
  const user = userEvent.setup();
  if (kind === "reset") {
    await user.type(
      screen.getByLabelText("임시 비밀번호", { exact: true }),
      "Synthetic secret for issue 188!",
    );
    await user.type(
      screen.getByLabelText("임시 비밀번호 확인"),
      "Synthetic secret for issue 188!",
    );
  }
  await user.click(
    screen.getByRole("button", {
      name: kind === "reset" ? "초기화 확인" : "삭제 확인",
      exact: true,
    }),
  );
}

it.each(["reset", "delete"])(
  "opens %s directly with valid recent auth without issuing or saving resume",
  async (kind) => {
    await authService.reauthenticate({ password: "admin123" });
    const target = (await adminService.listUsers()).items.find(
      (item) => item.nickname === "비기너개발자",
    );
    const read = vi.spyOn(adminService, "getUser");
    const issue = vi.spyOn(
      adminService,
      kind === "reset"
        ? "createPasswordResetOperation"
        : "createUserDeleteOperation",
    );
    const execute = vi.spyOn(
      adminService,
      kind === "reset" ? "setPasswordReset" : "deleteUser",
    );
    const save = vi.fn();
    const consume = vi.fn();
    render(panelTree({ onSaveResume: save, onConsumeResume: consume }));
    const panel = await clickMemberAction(kind);
    expect(panel).toHaveTextContent(target.nickname);
    expect(panel).toHaveTextContent(target.loginId);
    if (kind === "delete")
      expect(panel).toHaveTextContent(`앱 ${target.appCount}개`);
    expect(
      JSON.parse(screen.getByTestId("panel-location").textContent).pathname,
    ).toBe("/admin");
    expect(read).toHaveBeenCalledWith(target.id);
    expect(save).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  },
);

it.each([
  ["reset", "absent"],
  ["reset", "expired"],
  ["delete", "absent"],
  ["delete", "expired"],
])(
  "opens %s with %s recent auth and redirects only on issuance REAUTH_REQUIRED",
  async (kind, auth) => {
    const target = (await adminService.listUsers()).items.find(
      (item) => item.nickname === "비기너개발자",
    );
    if (auth === "expired") {
      await authService.reauthenticate({ password: "admin123" });
      setMockClock(
        new Date(
          Date.parse(getMockSnapshot().principal_session.recent_auth_until) + 1,
        ).toISOString(),
      );
    } else {
      const state = getMockSnapshot();
      state.principal_session.recent_auth_until = null;
      localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    }
    const issue = vi.spyOn(
      adminService,
      kind === "reset"
        ? "createPasswordResetOperation"
        : "createUserDeleteOperation",
    );
    const execute = vi.spyOn(
      adminService,
      kind === "reset" ? "setPasswordReset" : "deleteUser",
    );
    const save = vi.fn();
    render(panelTree({ onSaveResume: save }));
    await clickMemberAction(kind);
    expect(save).not.toHaveBeenCalled();
    expect(issue).not.toHaveBeenCalled();
    await confirmMemberAction(kind);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(issue).toHaveBeenCalledTimes(1);
    await expect(issue.mock.results[0].value).rejects.toMatchObject({
      code: "REAUTH_REQUIRED",
      httpStatus: 403,
    });
    expect(execute).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith({
      tab: "users",
      [kind === "reset" ? "adminReset" : "adminDelete"]: {
        targetId: target.id,
      },
    });
    const location = JSON.parse(
      screen.getByTestId("panel-location").textContent,
    );
    expect(location.pathname + location.search).toBe(
      "/auth?mode=reauth&return_to=%2Fadmin",
    );
    expect(
      JSON.stringify([
        save.mock.calls,
        location,
        { ...localStorage },
        { ...sessionStorage },
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
      ]),
    ).not.toContain("Synthetic secret for issue 188!");
  },
);

it.each(["reset", "delete"])(
  "preserves the issued %s key on execution REAUTH_REQUIRED and resumes lookup without replay",
  async (kind) => {
    const { ServiceError } = await import("../src/services/service-error");
    await authService.reauthenticate({ password: "admin123" });
    const target = (await adminService.listUsers()).items.find(
      (item) => item.nickname === "비기너개발자",
    );
    const issue = vi.spyOn(
      adminService,
      kind === "reset"
        ? "createPasswordResetOperation"
        : "createUserDeleteOperation",
    );
    const execute = vi
      .spyOn(adminService, kind === "reset" ? "setPasswordReset" : "deleteUser")
      .mockRejectedValue(
        new ServiceError("REAUTH_REQUIRED", "Reauthenticate", {
          httpStatus: 403,
        }),
      );
    const save = vi.fn();
    render(panelTree({ onSaveResume: save }));
    await clickMemberAction(kind);
    await confirmMemberAction(kind);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const operation = await issue.mock.results[0].value;
    const resume = {
      tab: "users",
      [kind === "reset" ? "adminReset" : "adminDelete"]: {
        targetId: target.id,
        operationKey: operation.key,
        [kind === "reset" ? "expectedAccountVersion" : "expectedAppCount"]:
          kind === "reset" ? target.accountVersion : target.appCount,
      },
    };
    expect(save).toHaveBeenCalledWith(resume);
    expect(
      JSON.parse(screen.getByTestId("panel-location").textContent).search,
    ).toBe("?mode=reauth&return_to=%2Fadmin");
    expect(
      screen.queryByLabelText("임시 비밀번호", { exact: true }),
    ).not.toBeInTheDocument();
    cleanup();
    const readOperation = vi.spyOn(
      adminService,
      kind === "reset" ? "getPasswordResetOperation" : "getUserDeleteOperation",
    );
    const readTarget = vi.spyOn(adminService, "getUser");
    const consume = vi.fn();
    render(panelTree({ resumeState: resume, onConsumeResume: consume }));
    await waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    expect(readOperation).toHaveBeenCalledWith(operation.key);
    expect(readOperation.mock.invocationCallOrder[0]).toBeLessThan(
      readTarget.mock.invocationCallOrder[0],
    );
    expect(issue).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    if (kind === "reset") {
      expect(
        screen.getByLabelText("임시 비밀번호", { exact: true }),
      ).toHaveValue("");
      expect(screen.getByLabelText("임시 비밀번호 확인")).toHaveValue("");
    }
    expect(
      JSON.stringify([
        resume,
        { ...localStorage },
        { ...sessionStorage },
        client
          .getQueryCache()
          .getAll()
          .map((query) => query.state.data),
        JSON.parse(screen.getByTestId("panel-location").textContent),
      ]),
    ).not.toContain("Synthetic secret for issue 188!");
  },
);

it("opens only the current panel during reset to delete to reset with late target responses", async () => {
  const targets = (await adminService.listUsers()).items;
  const first = targets.find((item) => item.nickname === "비기너개발자");
  const second = targets.find((item) => item.nickname === "코딩꿈나무");
  const releases = [];
  vi.spyOn(adminService, "getUser").mockImplementation(
    () => new Promise((resolve) => releases.push(resolve)),
  );
  const remember = vi.fn();
  render(panelTree({ onRememberDelete: remember }));
  const user = userEvent.setup();
  const click = async (target, action) =>
    user.click(
      within(
        screen.getByText(target.nickname).closest('[role="listitem"]'),
      ).getByRole("button", { name: action, exact: true }),
    );
  await screen.findByText(first.nickname);
  await click(first, "임시 비밀번호 설정");
  await waitFor(() => expect(releases).toHaveLength(1));
  await click(second, "삭제");
  await waitFor(() => expect(releases).toHaveLength(2));
  expect(
    screen.queryByRole("region", { name: /임시 비밀번호 초기화 확인/ }),
  ).not.toBeInTheDocument();
  await click(second, "임시 비밀번호 설정");
  await waitFor(() => expect(releases).toHaveLength(3));
  expect(
    screen.queryByRole("region", { name: /계정.*삭제/ }),
  ).not.toBeInTheDocument();
  await act(async () => releases[2](second));
  await act(async () => {
    releases[0](first);
    releases[1](second);
  });
  const panel = screen.getByRole("region", {
    name: /임시 비밀번호 초기화 확인/,
  });
  expect(panel).toHaveTextContent(second.nickname);
  expect(panel).not.toHaveTextContent(first.nickname);
  expect(
    screen.queryByRole("region", { name: /계정.*삭제/ }),
  ).not.toBeInTheDocument();
  expect(remember).toHaveBeenCalledWith(null);
});
