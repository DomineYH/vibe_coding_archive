import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
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

it("marks admin editing another member's app current and preserves member editing", async () => {
  for (const { loginId, password, current, absent } of [
    {
      loginId: "admin",
      password: "admin123",
      current: "관리자",
      absent: "앱 등록",
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
    expect(nav.queryByRole("link", { name: absent })).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "앱 정보 편집" }),
    ).toBeInTheDocument();
    cleanup();
    router.dispose();
    queryClient.clear();
  }
});
