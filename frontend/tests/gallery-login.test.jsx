import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { appsService } from "../src/services/mock/apps";
import { healthService } from "../src/services/mock/health";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { resetMockState } from "../src/services/mock/state";
import { readAuthRoute } from "../src/features/auth/auth-route";
import { ServiceError } from "../src/services/service-error";

let client;
beforeEach(() => {
  localStorage.clear();
  resetMockState();
  window.history.replaceState(null, "", "/");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});
async function mount() {
  render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  return await screen.findByRole("link", { name: /분수 피자 가게.*상세 보기/ });
}
async function signIn(index = 1) {
  await authService.login({
    loginId: DEMO_ACCOUNTS[index].loginId,
    password: DEMO_ACCOUNTS[index].password,
  });
}

it.each([
  "anonymous",
  "pending",
  "change_only",
  "mustChangePassword",
  "unresolved",
  "unavailable",
  "error",
  "concealed",
])(
  "intercepts %s without detail or health reads and keeps the exact safe return",
  async (kind) => {
    if (kind !== "anonymous") await signIn();
    const observe = authService.getCurrentAuthState.bind(authService);
    vi.spyOn(authService, "getCurrentAuthState").mockImplementation(
      async () => {
        const state = await observe();
        if (kind === "error")
          throw new ServiceError("SERVICE_UNAVAILABLE", "unavailable");
        return {
          ...state,
          status: ["unresolved", "unavailable"].includes(kind)
            ? kind
            : state.status,
          user: state.user
            ? {
                ...state.user,
                approved: kind !== "pending",
                sessionKind: kind === "change_only" ? "change_only" : "full",
                mustChangePassword: kind === "mustChangePassword",
              }
            : null,
        };
      },
    );
    const detail = vi.spyOn(appsService, "get");
    const health = vi.spyOn(healthService, "getAppHealth");
    const check = vi.spyOn(healthService, "requestCheck");
    const job = vi.spyOn(healthService, "getJob");
    const card = await mount();
    if (kind === "concealed")
      await act(async () => window.dispatchEvent(new Event("blur")));
    else if (kind !== "anonymous")
      await waitFor(() => expect(card).toHaveAccessibleName(/로그인 필요$/));
    fireEvent.click(card);
    expect(window.location.pathname).toBe("/");
    expect(screen.getByText("로그인을 해주세요")).toBeVisible();
    const login = screen.getByRole("link", { name: "로그인", exact: true });
    const url = new URL(login.href);
    expect([...url.searchParams.keys()]).toEqual(["mode", "return_to"]);
    expect(url.searchParams.get("return_to")).toBe(
      "/apps/00000000-0000-4000-8000-000000000001",
    );
    expect(readAuthRoute(url.search).returnTo).toBe(
      "/apps/00000000-0000-4000-8000-000000000001",
    );
    expect(detail).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();
    expect(check).not.toHaveBeenCalled();
    expect(job).not.toHaveBeenCalled();
  },
);

it("keeps unresolved restoration on gallery, clears the notice when full and requires a fresh click", async () => {
  await signIn();
  const observed = await authService.getCurrentAuthState();
  let resolve;
  vi.spyOn(authService, "getCurrentAuthState").mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const card = await mount();
  fireEvent.click(card);
  expect(window.location.pathname).toBe("/");
  expect(screen.getByText("로그인을 해주세요")).toBeVisible();
  await act(async () => resolve(observed));
  await waitFor(() =>
    expect(screen.queryByText("로그인을 해주세요")).toBeNull(),
  );
  expect(window.location.pathname).toBe("/");
  expect(card).toHaveFocus();
  fireEvent.click(card);
  await waitFor(() =>
    expect(window.location.pathname).toBe(
      "/apps/00000000-0000-4000-8000-000000000001",
    ),
  );
});

it.each([0, 1])(
  "preserves full account %s navigation and gallery scroll state",
  async (index) => {
    await signIn(index);
    const card = await mount();
    await screen.findByRole("button", { name: "로그아웃" });
    await waitFor(() =>
      expect(card).toHaveAccessibleName(
        "분수 피자 가게, 교사김코딩, 수학 상세 보기",
      ),
    );
    vi.spyOn(window, "scrollY", "get").mockReturnValue(240);
    fireEvent.click(card);
    await waitFor(() =>
      expect(window.location.pathname).toBe(
        "/apps/00000000-0000-4000-8000-000000000001",
      ),
    );
    expect(window.history.state.usr).toEqual({ fromGallery: true });
    expect(screen.queryByText("로그인을 해주세요")).toBeNull();
    fireEvent.click(
      await screen.findByRole("button", { name: "갤러리로", exact: true }),
    );
    await waitFor(() =>
      expect(window.scrollTo).toHaveBeenCalledWith({ top: 240 }),
    );
  },
);

it("uses fresh downgraded auth and never saves intercepted gallery scroll", async () => {
  await signIn();
  const card = await mount();
  await screen.findByRole("button", { name: "로그아웃" });
  await act(async () => {
    await authService.logout();
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(card).toHaveAccessibleName(/로그인 필요$/));
  const scroll = vi.spyOn(window, "scrollY", "get").mockReturnValue(480);
  fireEvent.click(card);
  expect(window.location.pathname).toBe("/");
  expect(scroll).not.toHaveBeenCalled();
  expect(screen.getByText("로그인을 해주세요")).toBeVisible();
});

it("builds the login return from the mapped card ID even if its DOM href is changed", async () => {
  const card = await mount();
  card.setAttribute("href", "https://example.com/unsafe?return_to=%2Fadmin");
  fireEvent.click(card);
  expect(window.location.pathname).toBe("/");
  const login = screen.getByRole("link", { name: "로그인", exact: true });
  expect(login).toHaveAttribute(
    "href",
    "/auth?mode=login&return_to=%2Fapps%2F00000000-0000-4000-8000-000000000001",
  );
});
