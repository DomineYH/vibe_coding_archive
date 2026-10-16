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
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { appsService } from "../src/services/mock/apps";
import { adminService } from "../src/services/mock/admin";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { resetMockState } from "../src/services/mock/state";
import { prepareApiAuth } from "../src/services/api/auth";
import { ServiceError } from "../src/services/service-error";

vi.mock("../src/services/api/auth", () => ({
  prepareApiAuth: vi.fn(),
  recoverApiAuth: vi.fn(),
}));
const codes = ["AUTH_STATE_CHANGED", "AUTH_REQUIRED", "RECOVERY_REQUIRED"];
const detail = "/apps/00000000-0000-4000-8000-000000000001";
const gallery = "/?q=math&subject=%EC%88%98%ED%95%99&grade=%EC%B4%883";
const cause = "이전 흐름을 확인한 뒤 명시적으로 복구해 주세요.";
let client;
let observe;
let metadata;
let ready;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  ready = await authService.getCurrentAuthState();
  metadata = await appsService.getMeta();
  vi.stubGlobal("__DATA_MODE__", "api");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  localStorage.setItem(
    "eduvibe-auth-flow-v1",
    JSON.stringify({ flowId: "synthetic-retained-flow" }),
  );
  vi.spyOn(appsService, "getMeta").mockResolvedValue(metadata);
  observe = vi
    .spyOn(authService, "getCurrentAuthState")
    .mockRejectedValue(new ServiceError(codes[0], cause));
  vi.mocked(prepareApiAuth).mockRejectedValue(
    new ServiceError(codes[0], cause),
  );
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(prepareApiAuth).mockReset();
});
function visit(path = "/") {
  const router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: [path],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
const banner = () => within(screen.getByRole("banner"));
async function retryReady() {
  await banner().findByRole("button", { name: "다시 확인", exact: true });
  await waitFor(() =>
    expect(banner().queryByRole("status")).not.toBeInTheDocument(),
  );
  return banner().getByRole("button", { name: "다시 확인", exact: true });
}
async function recover(router, destination) {
  fireEvent.click(
    await banner().findByRole("button", { name: "인증 복구", exact: true }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname + router.state.location.search).toBe(
      `/auth?mode=login&return_to=${encodeURIComponent(destination)}`,
    ),
  );
  expect(
    await screen.findByRole("button", {
      name: "브라우저 인증 초기화",
      exact: true,
    }),
  ).toBeVisible();
  expect(screen.getByRole("main")).toHaveTextContent(cause);
}
it.each(codes)(
  "API %s observation error keeps retry and offers recovery",
  async (code) => {
    observe.mockRejectedValue(new ServiceError(code, cause));
    visit();
    const retry = await retryReady();
    expect(
      banner().getByRole("button", { name: "인증 복구", exact: true }),
    ).toBeVisible();
    expect(
      banner().queryByRole("button", { name: "로그아웃" }),
    ).not.toBeInTheDocument();
    expect(
      banner().queryByText(DEMO_ACCOUNTS[1].nickname),
    ).not.toBeInTheDocument();
    const count = observe.mock.calls.length;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(observe.mock.calls.length).toBeGreaterThan(count),
    );
    expect(
      await banner().findByRole("button", { name: "인증 복구", exact: true }),
    ).toBeVisible();
    expect(await screen.findByPlaceholderText(/검색/)).toBeEnabled();
  },
);
it.each([
  "NETWORK_ERROR",
  "SERVICE_UNAVAILABLE",
  "VALIDATION_ERROR",
  undefined,
])("transient or unrelated %s error offers retry only", async (code) => {
  observe.mockRejectedValue(
    code
      ? new ServiceError(code, cause, {
          httpStatus: code === "SERVICE_UNAVAILABLE" ? 503 : undefined,
        })
      : new Error(cause),
  );
  visit();
  expect(await retryReady()).toBeVisible();
  expect(
    banner().queryByRole("button", { name: "인증 복구" }),
  ).not.toBeInTheDocument();
});
it.each(codes)("mock %s error keeps retry only", async (code) => {
  vi.stubGlobal("__DATA_MODE__", "mock");
  observe.mockRejectedValue(new ServiceError(code, cause));
  visit();
  expect(await retryReady()).toBeVisible();
  expect(
    banner().queryByRole("button", { name: "인증 복구" }),
  ).not.toBeInTheDocument();
});
it.each([gallery, detail])(
  "recovery preserves allowlisted location %s",
  async (path) => {
    await recover(visit(path), path);
  },
);
it.each([
  "/?unknown=1",
  "/?q=a&q=b",
  "/?q=%ZZ",
  "/?subject=invalid",
  `${detail}?q=a`,
  "/unsupported",
])("recovery falls back to root for invalid location %s", async (path) => {
  await recover(visit(path), "/");
});
it.each([
  detail,
  gallery,
  "",
  "https://example.com",
  "%2Fapps%2Fnew",
  "/auth?mode=login",
  "/invalid",
])(
  "auth recovery retains valid return_to without nesting: %s",
  async (target) => {
    const destination = [detail, gallery].includes(target) ? target : "/";
    await recover(
      visit(
        `/auth?mode=login${target ? `&return_to=${encodeURIComponent(target)}` : ""}`,
      ),
      destination,
    );
  },
);
it("recovery ignores the current hash", async () => {
  await recover(visit(`${detail}#private`), detail);
});
it("recovery is keyboard reachable and navigation focuses the existing main", async () => {
  const user = userEvent.setup();
  const router = visit(gallery);
  (await retryReady()).focus();
  await user.tab();
  expect(
    banner().getByRole("button", { name: "인증 복구", exact: true }),
  ).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
  await screen.findByRole("button", { name: "브라우저 인증 초기화" });
  await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
});
it.each([
  "checking",
  "concealed",
  "error+concealed",
  "unavailable",
  "anonymous",
  "member",
  "unresolved",
])("unchanged header state %s", async (state) => {
  if (state === "checking")
    observe.mockImplementation(() => new Promise(() => {}));
  if (["concealed", "anonymous"].includes(state))
    observe.mockResolvedValue(ready);
  if (state === "member") {
    observe.mockRestore();
    await authService.login({
      loginId: DEMO_ACCOUNTS[1].loginId,
      password: DEMO_ACCOUNTS[1].password,
    });
  }
  if (state === "unresolved")
    observe.mockResolvedValue({
      ...ready,
      status: "unresolved",
      unresolvedTransitionId: "pending",
    });
  if (state === "unavailable")
    vi.mocked(appsService.getMeta).mockResolvedValue({
      ...metadata,
      capabilities: {
        ...metadata.capabilities,
        auth_login: { enabled: false, reasons: ["not_implemented"] },
      },
    });
  const router = visit();
  if (state.includes("concealed")) {
    if (state === "error+concealed") await retryReady();
    else await banner().findByRole("button", { name: "로그인", exact: true });
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(banner().getByRole("status")).toHaveTextContent(
      "화면이 잠시 가려졌습니다",
    );
  } else if (state === "checking")
    expect(await banner().findByText("로그인 상태 확인 중")).toBeVisible();
  else if (state === "unavailable")
    expect(await banner().findByText("인증 기능 준비 중")).toBeVisible();
  else if (state === "member") {
    expect(await banner().findByText(DEMO_ACCOUNTS[1].nickname)).toBeVisible();
    expect(banner().getByRole("button", { name: "로그아웃" })).toBeVisible();
  } else {
    fireEvent.click(
      await banner().findByRole("button", {
        name: state === "unresolved" ? "인증 복구" : "로그인",
        exact: true,
      }),
    );
    await waitFor(() =>
      expect(
        router.state.location.pathname + router.state.location.search,
      ).toBe("/auth?mode=login"),
    );
    return;
  }
  expect(
    banner().queryByRole("button", { name: "인증 복구" }),
  ).not.toBeInTheDocument();
});
it.each([detail, `${detail}/edit`, "/apps/new", "/admin"])(
  "auth errors keep protected %s routes blocked",
  async (path) => {
    const detailRead = vi.spyOn(appsService, "get");
    const adminRead = vi.spyOn(adminService, "listUsers");
    visit(path);
    await retryReady();
    expect(banner().getByRole("button", { name: "인증 복구" })).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "어플리케이션 이름" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "회원 목록" }),
    ).not.toBeInTheDocument();
    expect(detailRead).not.toHaveBeenCalled();
    expect(adminRead).not.toHaveBeenCalled();
  },
);
