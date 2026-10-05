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
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminView } from "../src/features/admin/view-admin";
import { adminService } from "../src/services/mock/admin";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
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

const resetNote = "임시 비밀번호 설정 기능은 아직 준비 중이에요.";
const deleteNote = "회원 삭제 기능은 아직 준비 중이에요.";

async function renderApiMembers(reset, deletion, entry = "/admin") {
  const meta = await appsService.getMeta();
  meta.capabilities.admin_password_reset = reset;
  meta.capabilities.admin_user_delete = deletion;
  vi.stubGlobal("__DATA_MODE__", "api");
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <AdminView scopeKey="disabled-reasons" meta={meta} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return (await screen.findAllByText("비기너개발자"))[0].closest(
    '[role="listitem"]',
  );
}

const enabled = { enabled: true, reasons: [] };
const unimplemented = { enabled: false, reasons: ["not_implemented"] };

it.each([
  [unimplemented, unimplemented, true, true],
  [unimplemented, enabled, true, false],
  [enabled, unimplemented, false, true],
  [
    { enabled: false, reasons: ["operational_restriction", "not_implemented"] },
    unimplemented,
    true,
    true,
  ],
])(
  "connects only unavailable member actions to visible preparation notes: %j / %j",
  async (reset, deletion, hasResetNote, hasDeleteNote) => {
    const row = await renderApiMembers(reset, deletion);
    for (const [name, copy, shown] of [
      ["임시 비밀번호 설정", resetNote, hasResetNote],
      ["삭제", deleteNote, hasDeleteNote],
    ]) {
      const button = within(row).getByRole("button", { name, exact: true });
      const note = within(row).queryByText(copy);
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
        expect(button).toBeEnabled();
        expect(button).not.toHaveAttribute("aria-describedby");
      }
    }
    expect(
      within(row)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["임시 비밀번호 설정", "삭제", "승인하기"]);
    expect(within(row).getByRole("button", { name: "승인하기" })).toBeEnabled();
  },
);

it.each([
  [enabled, enabled],
  [{ enabled: false, reasons: ["operational_restriction"] }, unimplemented],
  [{ enabled: false, reasons: ["verification_pending"] }, unimplemented],
])(
  "does not label other reset restrictions as preparation: %j",
  async (reset, deletion) => {
    const row = await renderApiMembers(reset, deletion);
    expect(within(row).queryByText(resetNote)).not.toBeInTheDocument();
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
});

it("uses distinct description ids across member rows and preserves the protected administrator", async () => {
  await renderApiMembers(unimplemented, unimplemented);
  const rows = within(
    screen.getByRole("list", { name: "회원 목록" }),
  ).getAllByRole("listitem");
  const memberRows = rows.filter((row) =>
    within(row).queryByRole("button", { name: "삭제", exact: true }),
  );
  expect(memberRows.length).toBeGreaterThanOrEqual(2);
  const ids = [];
  for (const row of memberRows) {
    for (const [name, copy] of [
      ["임시 비밀번호 설정", resetNote],
      ["삭제", deleteNote],
    ]) {
      const button = within(row).getByRole("button", { name, exact: true });
      const note = within(row).getByText(copy);
      ids.push(note.id);
      expect(
        document.getElementById(button.getAttribute("aria-describedby")),
      ).toBe(note);
    }
  }
  expect(new Set(ids).size).toBe(ids.length);
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
