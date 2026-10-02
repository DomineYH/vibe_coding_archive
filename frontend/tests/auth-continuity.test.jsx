import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { MOCK_STORAGE_KEY, resetMockState } from "../src/services/mock/state";

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
it("restores a concealed draft after revision-only proof and discards it after identity history changes", async () => {
  await visit("/apps/new", 1);
  const field = await screen.findByLabelText("어플리케이션 이름");
  fireEvent.change(field, { target: { value: "T06 같은 탭 초안" } });
  await recheck();
  expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue(
    "T06 같은 탭 초안",
  );
  await recheck(true);
  expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue("");
});
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
