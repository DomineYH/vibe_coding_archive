import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { MOCK_STORAGE_KEY, resetMockState } from "../src/services/mock/state";
import { ServiceError } from "../src/services/service-error";

let client;
beforeEach(() => {
  localStorage.clear();
  resetMockState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function visit(path, index) {
  const account = DEMO_ACCOUNTS[index];
  await authService.login({
    loginId: account.loginId,
    password: account.password,
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter([{ path: "*", element: <App /> }], {
          initialEntries: [path],
        })}
      />
    </QueryClientProvider>,
  );
}
async function recheck(identityChanged = false) {
  await act(async () => window.dispatchEvent(new Event("blur")));
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  state.auth_flow.revision = String(Number(state.auth_flow.revision) + 1);
  if (identityChanged)
    state.auth_flow.last_identity_change_revision = state.auth_flow.revision;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  await act(async () => window.dispatchEvent(new Event("focus")));
}
it("preserves change-only field errors across terminal revision and observation changes, then discards changed identity history", async () => {
  const observe = authService.getCurrentAuthState.bind(authService);
  vi.spyOn(authService, "getCurrentAuthState").mockImplementation(async () => {
    const state = await observe();
    return {
      ...state,
      user: state.user
        ? {
            ...state.user,
            sessionKind: "change_only",
            mustChangePassword: true,
          }
        : null,
    };
  });
  const error = "임시 비밀번호와 다른 비밀번호를 입력해 주세요.";
  vi.spyOn(authService, "changePassword").mockImplementation(async () => {
    const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
    state.auth_flow.revision = String(Number(state.auth_flow.revision) + 1);
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    throw new ServiceError("VALIDATION_ERROR", error, {
      fields: { password: error },
    });
  });
  await visit("/auth?mode=password-change", 0);
  const field = await screen.findByLabelText("새 비밀번호 (필수)", {
    exact: true,
  });
  const attempted = "x".repeat(20);
  fireEvent.change(field, { target: { value: attempted } });
  fireEvent.change(screen.getByLabelText("새 비밀번호 확인 (필수)"), {
    target: { value: attempted },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "비밀번호 변경", exact: true }),
  );
  expect(await screen.findByText(error)).toBeInTheDocument();
  expect(screen.getByLabelText("새 비밀번호 (필수)")).toHaveValue(attempted);
  await recheck();
  expect(await screen.findByText(error)).toBeInTheDocument();
  expect(screen.getByLabelText("새 비밀번호 (필수)")).toHaveFocus();
  await recheck(true);
  expect(await screen.findByLabelText("새 비밀번호 (필수)")).toHaveValue("");
  expect(screen.queryByText(error)).not.toBeInTheDocument();
});
it.each(["/apps/new", "/apps/00000000-0000-4000-8000-000000000091/edit"])(
  "restores a concealed draft after revision-only proof and discards identity history changes at %s",
  async (path) => {
    await visit(path, 1);
    const field = await screen.findByLabelText("어플리케이션 이름");
    const initial = field.value;
    fireEvent.change(field, { target: { value: "T06 같은 탭 초안" } });
    await recheck();
    expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue(
      "T06 같은 탭 초안",
    );
    await recheck(true);
    expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue(
      initial,
    );
  },
);
it("preserves pending approval confirmation across ordinary verification without submitting it", async () => {
  await visit("/admin", 0);
  const pending = await screen.findAllByRole("button", {
    name: "승인하기",
    exact: true,
  });
  fireEvent.click(pending[0]);
  expect(
    await screen.findByRole("region", { name: /회원 승인 확인/ }),
  ).toBeInTheDocument();
  await recheck();
  expect(
    await screen.findByRole("region", { name: /회원 승인 확인/ }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "승인하기 확인", exact: true }),
  ).toBeEnabled();
  await recheck(true);
  expect(
    screen.queryByRole("region", { name: /회원 승인 확인/ }),
  ).not.toBeInTheDocument();
});

it.each([false, true])(
  "discards draft across A logout A and A B A round trips (other=%s)",
  async (other) => {
    await visit("/apps/new", 1);
    fireEvent.change(await screen.findByLabelText("어플리케이션 이름"), {
      target: { value: "T06 폐기할 초안" },
    });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await authService.logout();
      if (other) {
        await authService.login({
          loginId: DEMO_ACCOUNTS[0].loginId,
          password: DEMO_ACCOUNTS[0].password,
        });
        await authService.logout();
      }
      await authService.login({
        loginId: DEMO_ACCOUNTS[1].loginId,
        password: DEMO_ACCOUNTS[1].password,
      });
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue("");
  },
);

it("discards an edit draft after fresh target authority is lost, even if ownership later returns", async () => {
  const id = "00000000-0000-4000-8000-000000000091";
  await visit(`/apps/${id}/edit`, 1);
  const field = await screen.findByLabelText("어플리케이션 이름");
  const original = field.value;
  fireEvent.change(field, { target: { value: "T06 소유권을 잃은 초안" } });
  function transfer(index) {
    const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
    const app = state.private_apps.find((item) => item.id === id);
    app.owner = {
      id: DEMO_ACCOUNTS[index].id,
      nickname: DEMO_ACCOUNTS[index].nickname,
    };
    localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  }
  transfer(0);
  await recheck();
  expect(await screen.findByText("앱을 수정할 수 없어요")).toBeInTheDocument();
  transfer(1);
  await recheck();
  expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue(
    original,
  );
});

it("revalidates pending admin target authority before restoring its confirmation", async () => {
  await visit("/admin", 0);
  fireEvent.click(
    (
      await screen.findAllByRole("button", { name: "승인하기", exact: true })
    )[0],
  );
  expect(
    await screen.findByRole("region", { name: /회원 승인 확인/ }),
  ).toBeInTheDocument();
  const { adminService } = await import("../src/services/mock/admin");
  const { ServiceError } = await import("../src/services/service-error");
  const freshTarget = vi
    .spyOn(adminService, "getUser")
    .mockRejectedValue(new ServiceError("NOT_FOUND", "회원을 찾을 수 없어요."));
  await recheck();
  await waitFor(() => expect(freshTarget).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: /회원 승인 확인/ }),
    ).not.toBeInTheDocument(),
  );
});
