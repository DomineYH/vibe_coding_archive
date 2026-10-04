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
import {
  BrowserRouter,
  createMemoryRouter,
  RouterProvider,
} from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { healthService } from "../src/services/mock/health";
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
it.each([
  ["/apps/new", 1],
  ["/apps/new", 0],
  ["/apps/00000000-0000-4000-8000-000000000091/edit", 1],
])(
  "restores a concealed draft after revision-only proof and discards identity history changes at %s for account %s",
  async (path, index) => {
    await visit(path, index);
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

it("keeps member auth ready without proofs when gallery search and filters change only the query", async () => {
  const account = DEMO_ACCOUNTS[1];
  await authService.login({
    loginId: account.loginId,
    password: account.password,
  });
  window.history.replaceState(null, "", "/");
  const proof = vi.spyOn(authService, "getCurrentAuthState");
  render(
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>,
  );
  await screen.findByRole("button", { name: "로그아웃" });
  await screen.findByRole("link", {
    name: "분수 피자 가게, 교사김코딩, 수학 상세 보기",
  });
  proof.mockClear();
  fireEvent.change(screen.getByRole("textbox", { name: "앱·작성자 검색" }), {
    target: { value: "분수" },
  });
  await waitFor(() =>
    expect(new URLSearchParams(window.location.search).get("q")).toBe("분수"),
  );
  expect(proof).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "수학", exact: true }));
  await waitFor(() =>
    expect(new URLSearchParams(window.location.search).get("subject")).toBe(
      "수학",
    ),
  );
  expect(proof).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("combobox", { name: "학년 필터" }), {
    target: { value: "초3" },
  });
  await waitFor(() =>
    expect(new URLSearchParams(window.location.search).get("grade")).toBe(
      "초3",
    ),
  );
  expect(proof).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
  await act(async () => window.history.back());
  await waitFor(() => expect(proof).toHaveBeenCalledTimes(1));
  await screen.findByRole("button", { name: "로그아웃" });
  expect(screen.getByRole("combobox", { name: "학년 필터" })).toHaveValue("");
  proof.mockClear();
  await act(async () => window.history.forward());
  await waitFor(() => expect(proof).toHaveBeenCalledTimes(1));
  await screen.findByRole("button", { name: "로그아웃" });
  expect(screen.getByRole("combobox", { name: "학년 필터" })).toHaveValue(
    "초3",
  );
  proof.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "전체", exact: true }));
  await waitFor(() =>
    expect(new URLSearchParams(window.location.search).has("subject")).toBe(
      false,
    ),
  );
  expect(proof).not.toHaveBeenCalled();
});

it("keeps AdminView active without auth proofs when switching tabs on the same pathname", async () => {
  await visit("/admin", 0);
  const menu = await screen.findByRole("tablist", { name: "관리자 메뉴" });
  await screen.findByRole("button", { name: "로그아웃" });
  const view = menu.closest("[aria-hidden]");
  const proof = vi.spyOn(authService, "getCurrentAuthState");
  const changes = [];
  const observer = new MutationObserver((records) => changes.push(...records));
  observer.observe(view, {
    attributes: true,
    attributeFilter: ["hidden", "inert", "aria-hidden"],
  });
  try {
    fireEvent.click(screen.getByRole("tab", { name: "Health Monitor" }));
    expect(view).not.toHaveAttribute("hidden");
    expect(view).not.toHaveAttribute("inert");
    expect(view).toHaveAttribute("aria-hidden", "false");
    expect(proof).not.toHaveBeenCalled();
    await screen.findByRole("tabpanel", { name: "Health Monitor" });
    fireEvent.click(screen.getByRole("tab", { name: "사용자 관리" }));
    await screen.findByRole("tabpanel", { name: "사용자 관리" });
    expect(proof).not.toHaveBeenCalled();
    expect(changes).toHaveLength(0);
  } finally {
    observer.disconnect();
  }
});

it("keeps loaded admin members accessible during another tab's health scenario and batch writes", async () => {
  const initial = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  localStorage.setItem(
    MOCK_STORAGE_KEY,
    JSON.stringify({ ...initial, scenario: "app_update_delayed" }),
  );
  await visit("/admin", 0);
  const members = await screen.findByRole("list", { name: "회원 목록" });
  const nickname = DEMO_ACCOUNTS[1].nickname;
  expect(within(members).getByText(nickname)).toBeInTheDocument();
  const proof = vi.spyOn(authService, "getCurrentAuthState");
  const writes = [];
  const store = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(
    function (key, value) {
      const oldValue = this.getItem(key);
      store.call(this, key, value);
      if (this === localStorage && key === MOCK_STORAGE_KEY)
        writes.push(
          new StorageEvent("storage", { key, oldValue, newValue: value }),
        );
    },
  );
  const view = members.closest("[aria-hidden]");
  const changes = [];
  const observer = new MutationObserver((records) => changes.push(...records));
  observer.observe(view, {
    attributes: true,
    attributeFilter: ["hidden", "inert", "aria-hidden"],
  });
  try {
    await act(async () => {
      const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
      localStorage.setItem(
        MOCK_STORAGE_KEY,
        JSON.stringify({ ...state, scenario: "health_batch_slow" }),
      );
      await healthService.requestBatch();
    });
    proof.mockClear();
    await act(async () => {
      for (const event of writes) window.dispatchEvent(event);
    });
    expect(proof).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("list", { name: "회원 목록" })).getByText(
        nickname,
      ),
    ).toBeInTheDocument();
    expect(changes).toHaveLength(0);
  } finally {
    observer.disconnect();
  }
});

it.each(["auth revision", "app ownership", "auth scenario", "damaged storage"])(
  "still conceals admin members when a health storage write also changes %s",
  async (change) => {
    await visit("/admin", 0);
    const members = await screen.findByRole("list", { name: "회원 목록" });
    const view = members.closest("[aria-hidden]");
    const oldValue = localStorage.getItem(MOCK_STORAGE_KEY);
    const state = JSON.parse(oldValue);
    state.health_id_sequence += 1;
    if (change === "auth revision")
      state.auth_flow.revision = String(Number(state.auth_flow.revision) + 1);
    if (change === "app ownership")
      state.private_apps[0].owner = {
        id: DEMO_ACCOUNTS[0].id,
        nickname: DEMO_ACCOUNTS[0].nickname,
      };
    if (change === "auth scenario") state.scenario = "auth_observation_error";
    const newValue = change === "damaged storage" ? "{" : JSON.stringify(state);
    const observe = authService.getCurrentAuthState.bind(authService);
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const proof = vi
      .spyOn(authService, "getCurrentAuthState")
      .mockImplementation(async (options) => {
        await held;
        return observe(options);
      });
    try {
      await act(async () => {
        localStorage.setItem(MOCK_STORAGE_KEY, newValue);
        window.dispatchEvent(
          new StorageEvent("storage", {
            key: MOCK_STORAGE_KEY,
            oldValue,
            newValue,
          }),
        );
      });
      await waitFor(() => expect(proof).toHaveBeenCalledTimes(1));
      expect(screen.queryByRole("list", { name: "회원 목록" })).toBeNull();
      expect(view).toHaveAttribute("hidden");
      expect(view).toHaveAttribute("inert");
      expect(view).toHaveAttribute("aria-hidden", "true");
    } finally {
      await act(async () => release());
    }
  },
);

it("restores public detail with one explicit retry after damaged mock storage is repaired", async () => {
  const saved = localStorage.getItem(MOCK_STORAGE_KEY);
  localStorage.setItem(
    MOCK_STORAGE_KEY,
    JSON.stringify({ ...JSON.parse(saved), apps: [{}] }),
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider
        router={createMemoryRouter([{ path: "*", element: <App /> }], {
          initialEntries: ["/apps/00000000-0000-4000-8000-000000000001"],
        })}
      />
    </QueryClientProvider>,
  );
  const main = within(screen.getByRole("main"));
  const retry = await main.findByRole("button", {
    name: "다시 확인",
    exact: true,
  });
  localStorage.setItem(MOCK_STORAGE_KEY, saved);
  fireEvent.click(retry);
  expect(
    await main.findByRole("heading", { name: "분수 피자 가게" }),
  ).toBeInTheDocument();
});

it.each([
  [1, 0],
  [0, 1],
])(
  "isolates registration drafts when account %s switches to account %s",
  async (from, to) => {
    await visit("/apps/new", from);
    const draft = `#150 actor ${from} draft`;
    fireEvent.change(await screen.findByLabelText("어플리케이션 이름"), {
      target: { value: draft },
    });
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      await authService.logout();
      await authService.login(DEMO_ACCOUNTS[to]);
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByLabelText("어플리케이션 이름")).toHaveValue("");
    expect(screen.queryByDisplayValue(draft)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("banner")).getByText(DEMO_ACCOUNTS[to].nickname, {
        exact: true,
      }),
    ).toBeInTheDocument();
  },
);
