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
import { appsService } from "../src/services/mock/apps";
import { adminService } from "../src/services/mock/admin";
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
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "어플리케이션 이름" }),
      ).toHaveValue(initial),
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

it.each([
  ["/apps/new", false],
  ["/apps/new", true],
  ["/apps/00000000-0000-4000-8000-000000000091/edit", false],
  ["/apps/00000000-0000-4000-8000-000000000091/edit", true],
])(
  "discards draft across A logout A and A B A round trips at %s (other=%s)",
  async (path, other) => {
    await visit(path, 1);
    const initial = (await screen.findByLabelText("어플리케이션 이름")).value;
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
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "어플리케이션 이름" }),
      ).toHaveValue(initial),
    );
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

it("restores member detail with one explicit retry after damaged mock storage is repaired", async () => {
  await authService.login({ loginId: "교사김코딩", password: "1234" });
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

it("discards reauthentication drafts when actor identity history changes", async () => {
  await visit("/auth?mode=reauth&return_to=%2Fadmin", 0);
  const field = await screen.findByLabelText("현재 관리자 비밀번호");
  fireEvent.change(field, { target: { value: "synthetic secret password" } });
  await recheck();
  expect(await screen.findByLabelText("현재 관리자 비밀번호")).toHaveValue(
    "synthetic secret password",
  );
  await recheck(true);
  expect(await screen.findByLabelText("현재 관리자 비밀번호")).toHaveValue("");
});

it.each(["success", "failure"])(
  "ignores a late reauthentication %s after a newer observation",
  async (outcome) => {
    let release;
    const real = authService.reauthenticate.bind(authService);
    vi.spyOn(authService, "reauthenticate").mockImplementation(
      async (input) => {
        const result = await real(input);
        await new Promise((resolve) => {
          release = resolve;
        });
        if (outcome === "failure")
          throw new ServiceError(
            "INVALID_CREDENTIALS",
            "obsolete reauth failure",
          );
        return result;
      },
    );
    await visit("/auth?mode=reauth&return_to=%2Fadmin", 0);
    fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
      target: { value: "admin123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "본인 확인", exact: true }),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await recheck(true);
    const spy = vi.spyOn(authService, "getCurrentAuthState");
    await act(async () => release());
    expect(spy).not.toHaveBeenCalled();
    expect(
      screen.queryByText("obsolete reauth failure"),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "관리자 본인 확인" }),
    ).toBeVisible();
  },
);

it("keeps pending reauthentication return context in this tab memory and refetches before fresh confirmation", async () => {
  const router = await visit("/admin", 0);
  const row = (await screen.findByText("비기너개발자")).closest(
    '[role="listitem"]',
  );
  const create = vi.spyOn(adminService, "createPasswordResetOperation");
  const writes = vi.spyOn(adminService, "setPasswordReset");
  fireEvent.click(
    within(row).getByRole("button", {
      name: "임시 비밀번호 설정",
      exact: true,
    }),
  );
  await screen.findByLabelText("임시 비밀번호", { exact: true });
  expect(router.state.location.pathname).toBe("/admin");
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  state.principal_session.recent_auth_until = null;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  for (const label of ["임시 비밀번호", "임시 비밀번호 확인"]) {
    fireEvent.change(screen.getByLabelText(label, { exact: true }), {
      target: { value: "Synthetic memory-only password 188!" },
    });
  }
  fireEvent.click(
    screen.getByRole("button", { name: "초기화 확인", exact: true }),
  );
  await screen.findByLabelText("현재 관리자 비밀번호");
  expect(create).toHaveBeenCalledTimes(1);
  expect(router.state.location.state).toBeNull();
  expect(
    JSON.stringify([{ ...localStorage }, { ...sessionStorage }]),
  ).not.toContain("adminReset");
  expect(
    JSON.stringify([
      { ...localStorage },
      { ...sessionStorage },
      router.state.location,
    ]),
  ).not.toContain("Synthetic memory-only password 188!");
  const read = vi.spyOn(adminService, "getUser");
  fireEvent.change(screen.getByLabelText("현재 관리자 비밀번호"), {
    target: { value: "admin123" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "본인 확인", exact: true }),
  );
  await screen.findByRole("heading", { name: /임시 비밀번호 초기화 확인/ });
  expect(read).toHaveBeenCalled();
  expect(screen.getByLabelText("임시 비밀번호", { exact: true })).toHaveValue(
    "",
  );
  expect(
    screen.getByLabelText("임시 비밀번호 확인", { exact: true }),
  ).toHaveValue("");
  expect(create).toHaveBeenCalledTimes(1);
  expect(writes).not.toHaveBeenCalled();
  expect(router.state.location.state).toBeNull();
});

it("does not promote an older reauthentication result when a newer same-member rotation has already committed", async () => {
  const real = authService.reauthenticate.bind(authService);
  vi.spyOn(authService, "reauthenticate").mockImplementation(async (input) => {
    const first = await real(input);
    await real(input);
    return first;
  });
  const router = await visit("/auth?mode=reauth&return_to=%2Fadmin", 0);
  fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
    target: { value: "admin123" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "본인 확인", exact: true }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "본인 확인", exact: true }),
    ).toBeEnabled(),
  );
  expect(router.state.location.pathname).toBe("/auth");
  expect(
    screen.queryByRole("list", { name: "회원 목록" }),
  ).not.toBeInTheDocument();
});

it.each([
  ["PUSH", "success"],
  ["REPLACE", "success"],
  ["PUSH", "failed"],
  ["REPLACE", "failed"],
  ["PUSH", "lost"],
  ["REPLACE", "lost"],
])(
  "same-path %s departure during pending reauth %s leaves the new entry usable",
  async (navigation, outcome) => {
    let release;
    let failure;
    const real = authService.reauthenticate.bind(authService);
    const execute = vi
      .spyOn(authService, "reauthenticate")
      .mockImplementation(async (input) => {
        let result;
        try {
          result = await real(input);
        } catch (error) {
          failure = error;
        }
        await new Promise((resolve) => {
          release = resolve;
        });
        if (failure) throw failure;
        if (outcome === "lost")
          throw new ServiceError("SERVICE_UNAVAILABLE", "Response lost", {
            outcome: "unknown",
          });
        return result;
      });
    const router = await visit("/auth?mode=reauth&return_to=%2Fadmin", 0);
    fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
      target: { value: outcome === "failed" ? "wrong-password" : "admin123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "본인 확인", exact: true }),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () =>
      router.navigate("/auth?mode=login", {
        replace: navigation === "REPLACE",
      }),
    );
    await act(async () => release());
    await waitFor(() =>
      expect(
        screen.queryByText("로그인 상태를 확인하고 있어요"),
      ).not.toBeInTheDocument(),
    );
    expect(router.state.location.pathname).toBe("/auth");
    expect(router.state.location.search).toBe("?mode=login");
    expect(screen.getByLabelText("로그인 아이디")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "로그인", exact: true }),
    ).toBeEnabled();
    expect(
      await within(screen.getByRole("banner")).findByText(
        DEMO_ACCOUNTS[0].nickname,
        { exact: true },
      ),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "결과 확인" })).toBeNull();
    expect(screen.queryByText("Response lost")).not.toBeInTheDocument();
    if (outcome === "failed") {
      expect(failure).toMatchObject({
        code: "INVALID_CREDENTIALS",
        httpStatus: 401,
      });
      expect(screen.queryByText(failure.message)).not.toBeInTheDocument();
    }
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it.each(["PUSH", "REPLACE", "POP"])(
  "same-path %s navigation supersedes pending reauth success",
  async (navigation) => {
    let release;
    const real = authService.reauthenticate.bind(authService);
    vi.spyOn(authService, "reauthenticate").mockImplementation(
      async (input) => {
        const result = await real(input);
        await new Promise((resolve) => {
          release = resolve;
        });
        return result;
      },
    );
    const router = await visit("/auth?mode=login", 0);
    await act(async () =>
      router.navigate("/auth?mode=reauth&return_to=%2Fadmin"),
    );
    fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
      target: { value: "admin123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "본인 확인", exact: true }),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () =>
      navigation === "POP"
        ? router.navigate(-1)
        : router.navigate("/auth?mode=login", {
            replace: navigation === "REPLACE",
          }),
    );
    expect(router.state.location.search).toBe("?mode=login");
    await act(async () => release());
    await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
    expect(router.state.location.search).toBe("?mode=login");
  },
);

it.each(["PUSH", "REPLACE", "POP"])(
  "same-path %s navigation supersedes pending reauth result confirmation",
  async (navigation) => {
    const real = authService.reauthenticate.bind(authService);
    const execute = vi
      .spyOn(authService, "reauthenticate")
      .mockImplementation(async (input) => {
        await real(input);
        throw new ServiceError("SERVICE_UNAVAILABLE", "Response lost", {
          outcome: "unknown",
        });
      });
    const router = await visit("/auth?mode=login", 0);
    await act(async () =>
      router.navigate("/auth?mode=reauth&return_to=%2Fadmin"),
    );
    fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
      target: { value: "admin123" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "본인 확인", exact: true }),
    );
    const confirm = await screen.findByRole("button", { name: "결과 확인" });
    const read = authService.getFlowState.bind(authService);
    let release;
    vi.spyOn(authService, "getFlowState").mockImplementation(async (id) => {
      const result = await read(id);
      await new Promise((resolve) => {
        release = resolve;
      });
      return result;
    });
    fireEvent.click(confirm);
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () =>
      navigation === "POP"
        ? router.navigate(-1)
        : router.navigate("/auth?mode=login", {
            replace: navigation === "REPLACE",
          }),
    );
    expect(router.state.location.search).toBe("?mode=login");
    await act(async () => release());
    expect(router.state.location.pathname).toBe("/auth");
    expect(router.state.location.search).toBe("?mode=login");
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  "same-path navigation ignores an in-flight reauth restore (confirmation=%s)",
  async (confirmation) => {
    const real = authService.reauthenticate.bind(authService);
    vi.spyOn(authService, "reauthenticate").mockImplementation(
      async (input) => {
        const result = await real(input);
        if (confirmation)
          throw new ServiceError("SERVICE_UNAVAILABLE", "Response lost", {
            outcome: "unknown",
          });
        return result;
      },
    );
    const router = await visit("/auth?mode=reauth&return_to=%2Fadmin", 0);
    fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
      target: { value: "admin123" },
    });
    const observe = authService.getCurrentAuthState.bind(authService);
    let release;
    const holdRestore = () =>
      vi
        .spyOn(authService, "getCurrentAuthState")
        .mockImplementationOnce(async (options) => {
          const observed = await observe(options);
          await new Promise((resolve) => {
            release = resolve;
          });
          return {
            ...observed,
            user: { ...observed.user, nickname: "obsolete reauth restore" },
          };
        });
    if (!confirmation) holdRestore();
    fireEvent.click(
      screen.getByRole("button", { name: "본인 확인", exact: true }),
    );
    if (confirmation) {
      const confirm = await screen.findByRole("button", { name: "결과 확인" });
      holdRestore();
      fireEvent.click(confirm);
    }
    await waitFor(() => expect(release).toBeTypeOf("function"));
    await act(async () => router.navigate("/auth?mode=login"));
    await act(async () => release());
    expect(router.state.location.pathname).toBe("/auth");
    expect(router.state.location.search).toBe("?mode=login");
    expect(
      screen.queryByText("obsolete reauth restore"),
    ).not.toBeInTheDocument();
    expect(
      await within(screen.getByRole("banner")).findByText(
        DEMO_ACCOUNTS[0].nickname,
        { exact: true },
      ),
    ).toBeVisible();
  },
);

it("same-path navigation suppresses a late result-confirmation error toast", async () => {
  const real = authService.reauthenticate.bind(authService);
  vi.spyOn(authService, "reauthenticate").mockImplementation(async (input) => {
    await real(input);
    throw new ServiceError("SERVICE_UNAVAILABLE", "Response lost", {
      outcome: "unknown",
    });
  });
  const router = await visit("/auth?mode=reauth&return_to=%2Fadmin", 0);
  fireEvent.change(await screen.findByLabelText("현재 관리자 비밀번호"), {
    target: { value: "admin123" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "본인 확인", exact: true }),
  );
  const confirm = await screen.findByRole("button", { name: "결과 확인" });
  let release;
  vi.spyOn(authService, "getFlowState").mockImplementationOnce(async () => {
    await new Promise((resolve) => {
      release = resolve;
    });
    throw new ServiceError(
      "SERVICE_UNAVAILABLE",
      "obsolete confirmation error",
    );
  });
  fireEvent.click(confirm);
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await act(async () => router.navigate("/auth?mode=login"));
  await act(async () => release());
  expect(router.state.location.search).toBe("?mode=login");
  expect(
    screen.queryByText("obsolete confirmation error"),
  ).not.toBeInTheDocument();
});

it.each(["same", "other", "explicit"])(
  "retains only the original user-delete key across same-actor login and clears it on %s departure",
  async (departure) => {
    const router = await visit("/admin", 0);
    await act(async () => authService.reauthenticate({ password: "admin123" }));
    const issue = vi.spyOn(adminService, "createUserDeleteOperation");
    const execute = vi.spyOn(adminService, "deleteUser").mockRejectedValue(
      new ServiceError("NETWORK_ERROR", "Unknown delete reply", {
        outcome: "unknown",
      }),
    );
    const read = vi.spyOn(adminService, "getUserDeleteOperation");
    const row = (
      await screen.findByText("로그인 아이디: 비기너개발자", { exact: true })
    ).closest('[role="listitem"]');
    fireEvent.click(
      within(row).getByRole("button", { name: "삭제", exact: true }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "삭제 확인", exact: true }),
    );
    await screen.findByText(
      "삭제 결과가 아직 확정되지 않았어요. 현재 회원 상태로 성공을 추정하지 않았습니다.",
    );
    const operation = await issue.mock.results[0].value;
    if (departure === "explicit") {
      await act(async () => {
        window.dispatchEvent(new Event("blur"));
        await authService.logout();
        await authService.login({
          loginId: DEMO_ACCOUNTS[0].loginId,
          password: DEMO_ACCOUNTS[0].password,
        });
        window.dispatchEvent(new Event("focus"));
      });
      await screen.findByText(
        "삭제 결과가 아직 확정되지 않았어요. 현재 회원 상태로 성공을 추정하지 않았습니다.",
      );
      await waitFor(() => expect(read).toHaveBeenLastCalledWith(operation.key));
      fireEvent.click(
        screen.getByRole("button", { name: "로그아웃", exact: true }),
      );
      await waitFor(() => expect(router.state.location.pathname).toBe("/"));
    } else {
      await act(async () => {
        window.dispatchEvent(new Event("blur"));
        await authService.logout();
        const account = DEMO_ACCOUNTS[departure === "other" ? 1 : 0];
        await authService.login({
          loginId: account.loginId,
          password: account.password,
        });
        window.dispatchEvent(new Event("focus"));
      });
      if (departure === "other")
        await screen.findByText("관리자 권한이 필요해요");
    }
    if (departure !== "same") {
      await act(async () => {
        await authService.logout();
        await authService.login({
          loginId: DEMO_ACCOUNTS[0].loginId,
          password: DEMO_ACCOUNTS[0].password,
        });
        window.dispatchEvent(new Event("focus"));
        await router.navigate("/admin");
      });
    }
    await screen.findByRole("list", { name: "회원 목록" });
    if (departure === "same") {
      await screen.findByText(
        "삭제 결과가 아직 확정되지 않았어요. 현재 회원 상태로 성공을 추정하지 않았습니다.",
      );
      expect(read).toHaveBeenLastCalledWith(operation.key);
    } else {
      expect(
        screen.queryByRole("region", {
          name: /계정 삭제 확인|계정을 삭제할까요/,
        }),
      ).not.toBeInTheDocument();
    }
    expect(issue).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  },
);

it("corrects the foreground header after proof loss and restores the concealed edit through recovery", async () => {
  const id = "00000000-0000-4000-8000-000000000091";
  const path = `/apps/${id}/edit`;
  const router = await visit(path, 1);
  fireEvent.change(await screen.findByLabelText("어플리케이션 이름"), {
    target: { value: "232 복구할 초안" },
  });
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  state.auth_flow.session_cookie_present = false;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "로그아웃" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("textbox", { name: "어플리케이션 이름" }),
  ).not.toBeInTheDocument();
  const link = await screen.findByRole("link", { name: "로그인 및 인증 복구" });
  expect(link).toHaveAttribute(
    "href",
    `/auth?mode=login&return_to=${encodeURIComponent(path)}`,
  );
  fireEvent.click(link);
  await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
  expect(
    await screen.findByText("인증 결과를 확인할 수 없어요"),
  ).toBeInTheDocument();
  const missing = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  missing.auth_flow.session_cookie_present = true;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(missing));
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "편집으로 돌아가기" }),
  );
  expect(
    await screen.findByRole("textbox", { name: "어플리케이션 이름" }),
  ).toHaveValue("232 복구할 초안");
}, 30000);

it("keeps the original unknown key and input across proof-loss recovery without replay", async () => {
  const id = "00000000-0000-4000-8000-000000000091";
  const router = await visit(`/apps/${id}/edit`, 1);
  const original = await appsService.getMeta();
  expect(original.capabilities.apps_update_own.enabled).toBe(true);
  const issue = vi.spyOn(appsService, "issueUpdateOperation");
  const update = vi
    .spyOn(appsService, "update")
    .mockRejectedValue(
      new ServiceError("NETWORK_ERROR", "응답 유실", { outcome: "unknown" }),
    );
  fireEvent.change(await screen.findByLabelText("어플리케이션 이름"), {
    target: { value: "232 미확정 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  expect(
    await screen.findByRole("button", { name: "저장 결과 확인" }),
  ).toBeInTheDocument();
  const operation = await issue.mock.results[0].value;
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  state.auth_flow.session_cookie_present = false;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  fireEvent.click(screen.getByRole("button", { name: "저장 결과 확인" }));
  fireEvent.click(
    await screen.findByRole("link", { name: "로그인 및 인증 복구" }),
  );
  await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
  const missing = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  missing.auth_flow.session_cookie_present = true;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(missing));
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "편집으로 돌아가기" }),
  );
  expect(
    await screen.findByRole("textbox", { name: "어플리케이션 이름" }),
  ).toHaveValue("232 미확정 초안");
  expect(screen.getByRole("button", { name: "결과 확인 중" })).toBeDisabled();
  expect(update).toHaveBeenCalledTimes(1);
  expect(issue).toHaveBeenCalledTimes(1);
  fireEvent.click(
    screen.getByRole("button", { name: "같은 요청 다시 보내기" }),
  );
  await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
  expect(update.mock.calls[1]).toEqual(update.mock.calls[0]);
  expect(update.mock.calls[1][3]).toBe(operation.key);
}, 30000);

it("ignores a late successful edit after its observation retires and keeps result confirmation explicit", async () => {
  const id = "00000000-0000-4000-8000-000000000091";
  const router = await visit(`/apps/${id}/edit`, 1);
  let complete;
  const update = vi.spyOn(appsService, "update").mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  fireEvent.change(await screen.findByLabelText("어플리케이션 이름"), {
    target: { value: "232 늦은 완료" },
  });
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
  await recheck();
  await act(async () => complete({ id, version: 2 }));
  expect(router.state.location.pathname).toBe(`/apps/${id}/edit`);
  expect(
    await screen.findByRole("textbox", { name: "어플리케이션 이름" }),
  ).toHaveValue("232 늦은 완료");
  expect(
    await screen.findByRole("button", { name: "저장 결과 확인" }),
  ).toBeInTheDocument();
  expect(screen.queryByText("앱을 수정했어요.")).not.toBeInTheDocument();
}, 30000);

it("discards an edit snapshot when identity history cannot be proven, even if it later returns", async () => {
  const path = "/apps/00000000-0000-4000-8000-000000000091/edit";
  await visit(path, 1);
  const original = (
    await screen.findByRole("textbox", { name: "어플리케이션 이름" })
  ).value;
  fireEvent.change(screen.getByLabelText("어플리케이션 이름"), {
    target: { value: "232 이력 없는 초안" },
  });
  const observe = authService.getCurrentAuthState.bind(authService);
  const missing = vi
    .spyOn(authService, "getCurrentAuthState")
    .mockImplementation(async () => {
      const auth = await observe();
      return {
        ...auth,
        flow: { ...auth.flow, lastIdentityChangeRevision: null },
      };
    });
  await recheck();
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "어플리케이션 이름" }),
    ).toHaveValue(original),
  );
  missing.mockRestore();
  await recheck();
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "어플리케이션 이름" }),
    ).toHaveValue(original),
  );
}, 30000);

it("conceals on metadata network failure but discards confirmed write capability loss permanently", async () => {
  await visit("/apps/00000000-0000-4000-8000-000000000091/edit", 1);
  const field = await screen.findByRole("textbox", {
    name: "어플리케이션 이름",
  });
  const original = field.value;
  fireEvent.change(field, { target: { value: "232 권한 검증 초안" } });
  const meta = await appsService.getMeta();
  const metadata = vi
    .spyOn(appsService, "getMeta")
    .mockRejectedValue(
      new ServiceError("NETWORK_ERROR", "232 메타 네트워크 오류"),
    );
  await recheck();
  expect(await screen.findByText("232 메타 네트워크 오류")).toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: "어플리케이션 이름" }),
  ).not.toBeInTheDocument();
  metadata.mockResolvedValue(meta);
  await recheck();
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "어플리케이션 이름" }),
    ).toHaveValue("232 권한 검증 초안"),
  );
  metadata.mockResolvedValue({
    ...meta,
    capabilities: {
      ...meta.capabilities,
      apps_update_own: { enabled: false, reasons: ["maintenance"] },
    },
  });
  await recheck();
  expect(
    await screen.findByText("앱 수정 기능을 사용할 수 없어요"),
  ).toBeInTheDocument();
  metadata.mockResolvedValue(meta);
  await recheck();
  await waitFor(() =>
    expect(
      screen.getByRole("textbox", { name: "어플리케이션 이름" }),
    ).toHaveValue(original),
  );
}, 30000);

it("keeps an unrelated navigation warning visible while a proof-loss edit is concealed", async () => {
  const path = "/apps/00000000-0000-4000-8000-000000000091/edit";
  const router = await visit(path, 1);
  fireEvent.change(
    await screen.findByRole("textbox", { name: "어플리케이션 이름" }),
    { target: { value: "232 이동 경고 초안" } },
  );
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  state.auth_flow.session_cookie_present = false;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  const recovery = await screen.findByRole("link", {
    name: "로그인 및 인증 복구",
  });
  fireEvent.click(screen.getByRole("link", { name: "갤러리", exact: true }));
  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toBeVisible();
  expect(router.state.location.pathname).toBe(path);
  expect(
    screen.queryByRole("textbox", { name: "어플리케이션 이름" }),
  ).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "계속 작성" }));
  fireEvent.click(recovery);
  await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
}, 30000);

it("ignores an edit-return completion after the recovery entry has changed", async () => {
  const path = "/apps/00000000-0000-4000-8000-000000000091/edit";
  const router = await visit(path, 1);
  fireEvent.change(
    await screen.findByRole(
      "textbox",
      { name: "어플리케이션 이름" },
      { timeout: 10000 },
    ),
    { target: { value: "232 이전 복구 이동" } },
  );
  const state = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  state.auth_flow.session_cookie_present = false;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  fireEvent.click(
    await screen.findByRole(
      "link",
      { name: "로그인 및 인증 복구" },
      { timeout: 10000 },
    ),
  );
  const missing = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  missing.auth_flow.session_cookie_present = true;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(missing));
  await recheck();
  const back = await screen.findByRole(
    "button",
    { name: "편집으로 돌아가기" },
    { timeout: 10000 },
  );
  const meta = await appsService.getMeta();
  let release;
  vi.spyOn(appsService, "getMeta").mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  fireEvent.click(back);
  await act(async () => router.navigate("/auth?mode=login"));
  await act(async () => {
    release(meta);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(router.state.location.pathname).toBe("/auth");
  expect(router.state.location.search).toBe("?mode=login");
}, 30000);

it("discards edit memory before a cached different target can mount its form", async () => {
  const id = "00000000-0000-4000-8000-000000000091";
  const otherId = "00000000-0000-4000-8000-000000000001";
  const router = await visit(`/apps/${id}/edit`, 1);
  const name = await screen.findByRole(
    "textbox",
    { name: "어플리케이션 이름" },
    { timeout: 10000 },
  );
  const original = name.value;
  fireEvent.change(name, {
    target: { value: "232 다른 대상에 넘기면 안 되는 초안" },
  });
  const query = client
    .getQueryCache()
    .getAll()
    .find(
      (item) =>
        item.queryKey[2] === "detail" &&
        item.queryKey[3] === id &&
        item.state.data,
    );
  const other = {
    ...query.state.data,
    id: otherId,
    name: "232 다른 대상 앱",
    version: 7,
  };
  const get = appsService.get.bind(appsService);
  vi.spyOn(appsService, "get").mockImplementation((target, options) =>
    target === otherId ? Promise.resolve(other) : get(target, options),
  );
  await act(async () =>
    client.setQueryData(
      query.queryKey.map((part, index) => (index === 3 ? otherId : part)),
      other,
    ),
  );
  await act(async () => router.navigate(`/apps/${otherId}/edit`));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    within(dialog).getByRole("button", { name: "작성 취소하고 이동" }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/apps/${otherId}/edit`),
  );
  await waitFor(
    () =>
      expect(
        screen.getByRole("textbox", { name: "어플리케이션 이름" }),
      ).toHaveValue(other.name),
    { timeout: 10000 },
  );
  await act(async () => router.navigate(`/apps/${id}/edit`));
  await waitFor(
    () =>
      expect(
        screen.getByRole("textbox", { name: "어플리케이션 이름" }),
      ).toHaveValue(original),
    { timeout: 10000 },
  );
}, 30000);

it.each(["?unexpected=1", "#other-entry"])(
  "discards edit input after leaving the exact recovery corridor through %s",
  async (suffix) => {
    const path = "/apps/00000000-0000-4000-8000-000000000091/edit";
    const router = await visit(path, 1);
    const field = await screen.findByRole(
      "textbox",
      { name: "어플리케이션 이름" },
      { timeout: 10000 },
    );
    const original = field.value;
    fireEvent.change(field, {
      target: { value: "232 허용된 편집 주소 밖의 초안" },
    });
    await act(async () => router.navigate(path + suffix));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "작성 취소하고 이동" }),
    );
    await waitFor(() =>
      expect(
        router.state.location.pathname +
          router.state.location.search +
          router.state.location.hash,
      ).toBe(path + suffix),
    );
    await waitFor(
      () =>
        expect(
          screen.getByRole("textbox", { name: "어플리케이션 이름" }),
        ).toHaveValue(original),
      { timeout: 10000 },
    );
  },
  30000,
);
