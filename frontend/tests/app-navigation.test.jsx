import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { resetMockState } from "../src/services/mock/state";

let queryClient;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

it.each([
  ["00000000-0000-4000-8000-000000000001", 1, "앱 정보 편집"],
  ["00000000-0000-4000-8000-000000000091", 1, "앱 정보 편집"],
  ["00000000-0000-4000-8000-000000000001", 3, "앱을 수정할 수 없어요"],
])(
  "returns an anonymous edit visit for %s to the existing permission screen for account %s",
  async (id, accountIndex, title) => {
    resetMockState();
    const destination = `/apps/${id}/edit`;
    const router = createMemoryRouter([{ path: "*", element: <App /> }], {
      initialEntries: [destination],
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    try {
      const loginId = await screen.findByLabelText("로그인 아이디");
      expect(router.state.location.pathname).toBe("/auth");
      expect(
        new URLSearchParams(router.state.location.search).get("return_to"),
      ).toBe(destination);
      const account = DEMO_ACCOUNTS[accountIndex];
      fireEvent.change(loginId, { target: { value: account.loginId } });
      fireEvent.change(screen.getByLabelText("비밀번호"), {
        target: { value: account.password },
      });
      fireEvent.click(
        within(screen.getByRole("main")).getByRole("button", {
          name: "로그인",
          exact: true,
        }),
      );
      await waitFor(
        () => expect(router.state.location.pathname).toBe(destination),
        {
          timeout: 5000,
        },
      );
      expect(await screen.findByText(title)).toBeInTheDocument();
      if (accountIndex === 3)
        expect(
          screen.queryByLabelText("어플리케이션 이름"),
        ).not.toBeInTheDocument();
    } finally {
      router.dispose();
    }
  },
);

it("marks admin editing another member's app current and preserves member editing", async () => {
  for (const { loginId, password, current, absent } of [
    {
      loginId: "admin",
      password: "admin123",
      current: "관리자",
      absent: null,
    },
    {
      loginId: "교사김코딩",
      password: "1234",
      current: "앱 등록",
      absent: "관리자",
    },
  ]) {
    resetMockState();
    await authService.login({ loginId, password });
    const router = createMemoryRouter([{ path: "*", element: <App /> }], {
      initialEntries: ["/apps/00000000-0000-4000-8000-000000000091/edit"],
    });
    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    const tab = await nav.findByRole("link", { name: current });
    expect(tab).toHaveAttribute("aria-current", "page");
    expect(tab).toHaveClass("bg-neutral-900/[0.06]", "text-neutral-900");
    expect(nav.getByRole("link", { name: "갤러리" })).not.toHaveAttribute(
      "aria-current",
    );
    if (absent)
      expect(nav.queryByRole("link", { name: absent })).not.toBeInTheDocument();
    else
      expect(
        await nav.findByRole("link", { name: "앱 등록" }),
      ).not.toHaveAttribute("aria-current");
    expect(
      await screen.findByRole("heading", { name: "앱 정보 편집" }),
    ).toBeInTheDocument();
    cleanup();
    router.dispose();
    queryClient.clear();
  }
});
