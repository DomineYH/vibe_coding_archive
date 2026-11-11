import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { resetMockState } from "../src/services/mock/state";

const copy =
  "EduVibe 아카이브 — 교사 에이전틱 코딩 공유 플랫폼 · 경북 데이터 인사이트 연구회";
let queryClient;

beforeEach(() => {
  localStorage.clear();
  resetMockState();
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
  vi.unstubAllGlobals();
});

async function footerText() {
  const router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: ["/"],
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return (await screen.findByRole("contentinfo")).textContent;
}

it("shows the research group and the build version", async () => {
  vi.stubGlobal("__APP_COMMIT_DATE__", "2026-01-02");
  vi.stubGlobal("__APP_COMMIT_SHA__", "abc1234");
  const text = await footerText();
  expect(text).toBe(`${copy} · 버전 2026-01-02 (abc1234)`);
  expect(text).not.toContain("Pantone");
});

it("omits the version when the build has no commit", async () => {
  vi.stubGlobal("__APP_COMMIT_DATE__", "");
  vi.stubGlobal("__APP_COMMIT_SHA__", "");
  expect(await footerText()).toBe(copy);
});
