// #328: the click that gives a never-focused page its first focus must reach the control under it.
import { StrictMode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
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

vi.mock("../src/services/api/auth", () => ({
  prepareApiAuth: vi.fn(),
  recoverApiAuth: vi.fn(),
}));
let client;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  await authService.login({
    loginId: DEMO_ACCOUNTS[1].loginId,
    password: DEMO_ACCOUNTS[1].password,
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const banner = () => within(screen.getByRole("banner"));
const logoutButton = () => banner().findByRole("button", { name: "로그아웃" });
const send = (type, target = window) =>
  act(async () => target.dispatchEvent(new Event(type)));
function visit({ focused, strict = false }) {
  vi.spyOn(document, "hasFocus").mockReturnValue(focused);
  const router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: ["/"],
  });
  const Wrapper = strict ? StrictMode : "div";
  render(
    <Wrapper>
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Wrapper>,
  );
}

it.each(["mock", "api"])(
  "%s: the first focus of a never-focused page keeps the header, so the same click logs out",
  async (mode) => {
    if (mode === "api") {
      vi.stubGlobal("__DATA_MODE__", "api");
      localStorage.setItem(
        "eduvibe-auth-flow-v1",
        JSON.stringify({ flowId: "synthetic-retained-flow" }),
      );
    }
    visit({ focused: false });
    const button = await logoutButton();
    const observe = vi
      .spyOn(authService, "getCurrentAuthState")
      .mockImplementation(() => new Promise(() => {}));
    const logout = vi.spyOn(authService, "logout");
    await send("focus");
    expect(banner().queryByText("로그인 상태 확인 중")).not.toBeInTheDocument();
    expect(banner().getByRole("button", { name: "로그아웃" })).toBe(button);
    expect(observe).not.toHaveBeenCalled();
    observe.mockRestore();
    fireEvent.click(button);
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1));
    expect(
      await banner().findByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
  },
);

it.each([false, true])(
  "only the first focus is exempt: the next focus rechecks (#120), StrictMode=%s",
  async (strict) => {
    visit({ focused: false, strict });
    await logoutButton();
    const observe = vi.spyOn(authService, "getCurrentAuthState");
    await send("focus");
    expect(observe).not.toHaveBeenCalled();
    await send("focus");
    await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
    expect(await logoutButton()).toBeVisible();
  },
);

it("a page that had focus at load still rechecks on focus without a departure (#120)", async () => {
  visit({ focused: true });
  await logoutButton();
  const observe = vi.spyOn(authService, "getCurrentAuthState");
  await send("focus");
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
});

it("a never-focused page still conceals on blur and rechecks on the focus that returns", async () => {
  visit({ focused: false });
  await logoutButton();
  const observe = vi.spyOn(authService, "getCurrentAuthState");
  await send("blur");
  expect(banner().getByRole("status")).toHaveTextContent(
    "화면이 잠시 가려졌습니다",
  );
  expect(
    banner().queryByRole("button", { name: "로그아웃" }),
  ).not.toBeInTheDocument();
  await send("focus");
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
  expect(await logoutButton()).toBeVisible();
});

it.each(["visibilitychange", "pageshow"])(
  "a never-focused page still rechecks on %s",
  async (type) => {
    visit({ focused: false });
    await logoutButton();
    const observe = vi.spyOn(authService, "getCurrentAuthState");
    if (type === "visibilitychange") {
      const visibility = vi
        .spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");
      await send(type, document);
      expect(banner().getByRole("status")).toHaveTextContent(
        "화면이 잠시 가려졌습니다",
      );
      expect(observe).not.toHaveBeenCalled();
      visibility.mockReturnValue("visible");
    }
    await send(type, type === "pageshow" ? window : document);
    await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
    expect(await logoutButton()).toBeVisible();
  },
);

it("a page that loads hidden and unfocused stays concealed through a focus event until it is visible", async () => {
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  const observe = vi.spyOn(authService, "getCurrentAuthState");
  visit({ focused: false });
  await waitFor(() =>
    expect(banner().getByRole("status")).toHaveTextContent(
      "화면이 잠시 가려졌습니다",
    ),
  );
  await send("focus");
  expect(
    banner().queryByRole("button", { name: "로그아웃" }),
  ).not.toBeInTheDocument();
  visibility.mockReturnValue("visible");
  await send("visibilitychange", document);
  expect(await logoutButton()).toBeVisible();
  expect(observe).toHaveBeenCalled();
});

it("a first focus that arrives during a running check uses up the exemption", async () => {
  let release;
  const observe = vi
    .spyOn(authService, "getCurrentAuthState")
    .mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
  visit({ focused: false });
  expect(await banner().findByText("로그인 상태 확인 중")).toBeVisible();
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
  await send("focus");
  expect(observe).toHaveBeenCalledTimes(1);
  observe.mockRestore();
  const fresh = await authService.getCurrentAuthState();
  const again = vi.spyOn(authService, "getCurrentAuthState");
  await act(async () => release(fresh));
  await logoutButton();
  await send("focus");
  await waitFor(() => expect(again).toHaveBeenCalledTimes(1));
});

// #328 repair: a return or auth notification before the first focus uses up the exemption.
async function failOnceAndSettle(observe, calls) {
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(calls));
  expect(
    await banner().findByRole("button", { name: "다시 확인" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(banner().queryByText("로그인 상태 확인 중")).not.toBeInTheDocument(),
  );
}
async function focusObservesOnceMore(observe, calls) {
  await send("focus");
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(calls + 1));
  expect(await logoutButton()).toBeVisible();
  expect(observe).toHaveBeenCalledTimes(calls + 1);
}

it.each([
  ["mock", "eduvibe-archive-mock-v1"],
  ["api", "eduvibe-auth-flow-v1"],
])(
  "%s: an auth notification before the first focus uses up the exemption",
  async (mode, key) => {
    if (mode === "api") {
      vi.stubGlobal("__DATA_MODE__", "api");
      localStorage.setItem(
        key,
        JSON.stringify({ flowId: "synthetic-retained-flow" }),
      );
    }
    visit({ focused: false });
    await logoutButton();
    const observe = vi
      .spyOn(authService, "getCurrentAuthState")
      .mockRejectedValueOnce(new Error("transient"));
    await act(async () =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: localStorage.getItem(key),
        }),
      ),
    );
    await failOnceAndSettle(observe, 1);
    await focusObservesOnceMore(observe, 1);
  },
);

it("a return from hidden before the first focus uses up the exemption", async () => {
  visit({ focused: false });
  await logoutButton();
  const observe = vi
    .spyOn(authService, "getCurrentAuthState")
    .mockRejectedValueOnce(new Error("transient"));
  const visibility = vi
    .spyOn(document, "visibilityState", "get")
    .mockReturnValue("hidden");
  await send("visibilitychange", document);
  visibility.mockReturnValue("visible");
  await send("visibilitychange", document);
  await failOnceAndSettle(observe, 1);
  await focusObservesOnceMore(observe, 1);
});

it("a bfcache pageshow before the first focus uses up the exemption", async () => {
  visit({ focused: false });
  await logoutButton();
  const observe = vi
    .spyOn(authService, "getCurrentAuthState")
    .mockRejectedValueOnce(new Error("transient"));
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: true }),
    ),
  );
  await failOnceAndSettle(observe, 1);
  await focusObservesOnceMore(observe, 1);
});

it("an initial-load pageshow keeps the first-focus exemption", async () => {
  visit({ focused: false });
  await logoutButton();
  const observe = vi.spyOn(authService, "getCurrentAuthState");
  await act(async () =>
    window.dispatchEvent(
      new PageTransitionEvent("pageshow", { persisted: false }),
    ),
  );
  await waitFor(() => expect(observe).toHaveBeenCalledTimes(1));
  const button = await logoutButton();
  await send("focus");
  expect(banner().queryByText("로그인 상태 확인 중")).not.toBeInTheDocument();
  expect(banner().getByRole("button", { name: "로그아웃" })).toBe(button);
  expect(observe).toHaveBeenCalledTimes(1);
});
