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
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import {
  DEMO_ACCOUNTS,
  TEMPORARY_DEMO_ACCOUNTS,
} from "../src/services/mock/accounts";
import { resetMockState } from "../src/services/mock/state";

let client;
let router;
let meta;
let metadata;
const ownEdit = "/apps/00000000-0000-4000-8000-000000000001/edit";

beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  meta = await appsService.getMeta();
  metadata = vi
    .spyOn(appsService, "getMeta")
    .mockImplementation(async () => meta);
});

afterEach(() => {
  cleanup();
  router?.dispose();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function visit(path = "/", account = DEMO_ACCOUNTS[1]) {
  if (account) await authService.login(account);
  router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: [path],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  if (account) await screen.findByRole("button", { name: "로그아웃" });
}

function disable(capability, reasons = ["not_implemented"]) {
  meta.capabilities[capability] = { enabled: false, reasons };
}

function expectNoCreate() {
  expect(
    within(screen.getByRole("navigation", { name: "주 메뉴" })).queryByRole(
      "link",
      { name: "앱 등록" },
    ),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "내 앱 등록하기" }),
  ).not.toBeInTheDocument();
}

it.each([DEMO_ACCOUNTS[1], DEMO_ACCOUNTS[0]])(
  "hides create navigation when metadata disables creation for %j",
  async (account) => {
    disable("apps_create");
    await visit("/", account);
    await screen.findByRole("link", { name: /^분수 피자 가게,/ });
    expectNoCreate();
  },
);

it.each([DEMO_ACCOUNTS[1], DEMO_ACCOUNTS[0]])(
  "shows preparation copy on direct create for %j",
  async (account) => {
    disable("apps_create");
    await visit("/apps/new", account);
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
    const main = within(screen.getByRole("main"));
    const title = await main.findByText("앱 등록 기능은 아직 준비 중이에요");
    expect(title).toBeInTheDocument();
    expect(title.closest('[role="status"]')).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(title.closest('[role="alert"]')).toBeNull();
    expect(
      main.getByText("갤러리는 계속 둘러볼 수 있습니다."),
    ).toBeInTheDocument();
    expect(main.getByRole("link", { name: "갤러리로" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(main.queryByText(/잠시 후 다시 확인/)).not.toBeInTheDocument();
    expect(
      main.queryByRole("button", { name: "다시 확인" }),
    ).not.toBeInTheDocument();
  },
);

it("shows preparation copy on own edit", async () => {
  disable("apps_update_own");
  await visit(ownEdit);
  const main = within(screen.getByRole("main"));
  const title = await main.findByText("앱 수정 기능은 아직 준비 중이에요");
  expect(title).toBeInTheDocument();
  expect(main.getByRole("link", { name: "갤러리로" })).toHaveAttribute(
    "href",
    "/",
  );
  expect(title.closest('[role="status"]')).toHaveAttribute(
    "aria-live",
    "polite",
  );
  expect(title.closest('[role="alert"]')).toBeNull();
  expect(main.queryByText(/잠시 후 다시 확인/)).not.toBeInTheDocument();
  expect(
    main.queryByRole("button", { name: "다시 확인" }),
  ).not.toBeInTheDocument();
});

it.each([DEMO_ACCOUNTS[1], DEMO_ACCOUNTS[0]])(
  "shows both creation controls for an enabled approved full account without another metadata request: %j",
  async (account) => {
    await visit("/", account);
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    expect(
      await nav.findByRole("link", { name: "앱 등록" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "내 앱 등록하기" }),
    ).toBeInTheDocument();
    expect(metadata).toHaveBeenCalledTimes(1);
  },
);

it.each(["apps_create", "apps_update_own"])(
  "keeps transient copy for other disabled reasons on %s",
  async (capability) => {
    disable(capability, ["maintenance"]);
    await visit(capability === "apps_create" ? "/apps/new" : ownEdit);
    const description = await screen.findByText("잠시 후 다시 확인해 주세요.");
    expect(description).toBeInTheDocument();
    const creating = capability === "apps_create";
    expect(
      description.closest(creating ? '[role="alert"]' : '[role="status"]'),
    ).toHaveAttribute("aria-live", creating ? "assertive" : "polite");
    expect(
      description.closest(creating ? '[role="status"]' : '[role="alert"]'),
    ).toBeNull();
    expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
    if (capability === "apps_update_own")
      expect(
        within(screen.getByRole("main")).queryByRole("link", {
          name: "갤러리로",
        }),
      ).not.toBeInTheDocument();
  },
);

it.each(["apps_create", "apps_update_own"])(
  "recognizes not_implemented among mixed reasons on %s",
  async (capability) => {
    disable(capability, ["maintenance", "not_implemented"]);
    await visit(capability === "apps_create" ? "/apps/new" : ownEdit);
    const title = await screen.findByText(/아직 준비 중이에요/);
    expect(title).toBeInTheDocument();
    expect(title.closest('[role="status"]')).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(title.closest('[role="alert"]')).toBeNull();
    expect(
      within(screen.getByRole("main")).getByRole("link", { name: "갤러리로" }),
    ).toHaveAttribute("href", "/");
    expect(screen.queryByText(/잠시 후 다시 확인/)).not.toBeInTheDocument();
  },
);

it("checks ownership before unavailable edit copy", async () => {
  disable("apps_update_own");
  await visit(ownEdit, DEMO_ACCOUNTS[4]);
  expect(await screen.findByText("앱을 수정할 수 없어요")).toBeInTheDocument();
  expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
});

it.each([DEMO_ACCOUNTS[1], DEMO_ACCOUNTS[0]])(
  "hides creation while metadata is missing and loading for %j",
  async (account) => {
    let release;
    metadata.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    await visit("/apps/new", account);
    expect(
      await screen.findByText("등록 기능을 확인하고 있어요"),
    ).toBeInTheDocument();
    expectNoCreate();
    await act(async () => release(meta));
    expect(
      await screen.findByRole("form", { name: "새 앱 등록 양식" }),
    ).toBeInTheDocument();
  },
);

it.each([
  ["/", DEMO_ACCOUNTS[1]],
  ["/apps/new", DEMO_ACCOUNTS[1]],
  [ownEdit, DEMO_ACCOUNTS[1]],
  ["/", DEMO_ACCOUNTS[0]],
  ["/apps/new", DEMO_ACCOUNTS[0]],
])(
  "keeps creation with cached enabled metadata during refetch and hides it after failure at %s for %j",
  async (path, account) => {
    await visit(path, account);
    const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
    await nav.findByRole("link", { name: "앱 등록" });
    if (path !== "/")
      await screen.findByRole("form", {
        name: path === "/apps/new" ? "새 앱 등록 양식" : "앱 수정 양식",
      });
    let reject;
    metadata.mockImplementation(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    let refetch;
    await act(async () => {
      refetch = client.refetchQueries({ queryKey: ["mock", "meta"] });
    });
    await waitFor(() =>
      expect(client.getQueryState(["mock", "meta"]).fetchStatus).toBe(
        "fetching",
      ),
    );
    expect(
      nav.getByRole("link", { name: "앱 등록", exact: true }),
    ).toBeInTheDocument();
    if (path === "/")
      expect(
        screen.getByRole("button", { name: "내 앱 등록하기" }),
      ).toBeInTheDocument();
    else {
      expect(
        await screen.findByText(
          path === "/apps/new"
            ? "등록 기능을 확인하고 있어요"
            : "앱 정보를 확인하고 있어요",
        ),
      ).toBeInTheDocument();
      const form = screen.queryByRole("form", {
        name: path === "/apps/new" ? "새 앱 등록 양식" : "앱 수정 양식",
      });
      if (path === "/apps/new") expect(form).not.toBeInTheDocument();
      else expect(form).toBeInTheDocument();
    }
    await act(async () => {
      reject(new Error("메타 조회 실패"));
      await refetch;
    });
    await waitFor(expectNoCreate);
    const error = await screen.findByText("메타 조회 실패");
    expect(error).toBeInTheDocument();
    expect(
      within(error.closest("main")).getByRole("button", {
        name: path === "/" ? "다시 시도" : "다시 확인",
      }),
    ).toBeInTheDocument();
  },
);

it("hides creation after a successful metadata refetch revokes creation", async () => {
  await visit();
  const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
  await nav.findByRole("link", { name: "앱 등록", exact: true });
  await screen.findByRole("button", { name: "내 앱 등록하기" });
  let release;
  metadata.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  let refetch;
  await act(async () => {
    refetch = client.refetchQueries({ queryKey: ["mock", "meta"] });
  });
  await waitFor(() =>
    expect(client.getQueryState(["mock", "meta"]).fetchStatus).toBe("fetching"),
  );
  expect(
    nav.getByRole("link", { name: "앱 등록", exact: true }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "내 앱 등록하기" }),
  ).toBeInTheDocument();
  await act(async () => {
    release({
      ...meta,
      capabilities: {
        ...meta.capabilities,
        apps_create: { enabled: false, reasons: ["maintenance"] },
      },
    });
    await refetch;
  });
  await waitFor(expectNoCreate);
});

it.each(["/apps/new", ownEdit])(
  "prioritizes refetch errors over cached not_implemented copy at %s",
  async (path) => {
    disable("apps_create");
    disable("apps_update_own");
    await visit(path);
    await screen.findByText(/아직 준비 중이에요/);
    metadata.mockRejectedValue(new Error("메타 조회 실패"));
    await act(async () =>
      client.refetchQueries({ queryKey: ["mock", "meta"] }),
    );
    const error = await screen.findByText("메타 조회 실패");
    expect(error).toBeInTheDocument();
    const alert = error.closest('[role="alert"]');
    expect(alert).toHaveAttribute("aria-live", "assertive");
    expect(error.closest('[role="status"]')).toBeNull();
    expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
    expect(
      within(alert).getByRole("button", {
        name: "다시 확인",
      }),
    ).toBeInTheDocument();
  },
);

it.each([DEMO_ACCOUNTS[1], DEMO_ACCOUNTS[0]])(
  "keeps retry available when the initial metadata request fails for %j",
  async (account) => {
    metadata.mockRejectedValue(new Error("메타 조회 실패"));
    await visit("/apps/new", account);
    expect(await screen.findByText("메타 조회 실패")).toBeInTheDocument();
    expectNoCreate();
    metadata.mockResolvedValue(meta);
    await act(async () => {
      within(screen.getByRole("main"))
        .getByRole("button", { name: "다시 확인" })
        .click();
    });
    expect(
      await screen.findByRole("form", { name: "새 앱 등록 양식" }),
    ).toBeInTheDocument();
  },
);

it.each(["/", "/apps/new"])(
  "hides creation for anonymous sessions at %s",
  async (path) => {
    await visit(path, null);
    if (path === "/")
      await screen.findByRole("link", { name: /^분수 피자 가게,/ });
    else
      await waitFor(() => expect(router.state.location.pathname).toBe("/auth"));
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
  },
);

it.each([
  ["/", DEMO_ACCOUNTS[1]],
  ["/apps/new", DEMO_ACCOUNTS[1]],
  ["/", DEMO_ACCOUNTS[0]],
  ["/apps/new", DEMO_ACCOUNTS[0]],
])(
  "conceals creation controls and the form on blur at %s for %j",
  async (path, account) => {
    await visit(path, account);
    const form =
      path === "/apps/new"
        ? await screen.findByRole("form", { name: "새 앱 등록 양식" })
        : null;
    if (!form) await screen.findByRole("button", { name: "내 앱 등록하기" });
    await act(async () => window.dispatchEvent(new Event("blur")));
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
    if (form) {
      expect(form).toBeInTheDocument();
      expect(form.closest("[aria-hidden]")).toHaveAttribute("hidden");
      expect(form.closest("[aria-hidden]")).toHaveAttribute("inert");
    }
  },
);

it.each([false, true])(
  "gates creation for an injected full member with approved=%s",
  async (approved) => {
    await authService.login(DEMO_ACCOUNTS[1]);
    const observed = await authService.getCurrentAuthState();
    expect(observed).toMatchObject({
      status: "ready",
      sessionCookiePresent: true,
      user: {
        role: "user",
        approved: true,
        sessionKind: "full",
        mustChangePassword: false,
      },
    });
    const state = { ...observed, user: { ...observed.user, approved } };
    const spy = vi
      .spyOn(authService, "getCurrentAuthState")
      .mockResolvedValue(state);
    await visit("/", null);
    await screen.findByRole("button", { name: "로그아웃" });
    expect(
      within(screen.getByRole("banner")).getByText(observed.user.nickname, {
        exact: true,
      }),
    ).toBeInTheDocument();
    await screen.findByRole("link", { name: /^분수 피자 가게,/ });
    await waitFor(() =>
      expect(client.getQueryState(["mock", "meta"])).toMatchObject({
        status: "success",
        fetchStatus: "idle",
      }),
    );
    expect(spy).toHaveBeenCalled();
    await expect(spy.mock.results[0].value).resolves.toEqual(state);
    if (!approved) expectNoCreate();
    else {
      expect(
        within(screen.getByRole("navigation", { name: "주 메뉴" })).getByRole(
          "link",
          { name: "앱 등록", exact: true },
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "내 앱 등록하기" }),
      ).toBeInTheDocument();
    }
  },
);

it("hides creation for a real change-only member session", async () => {
  await visit("/", TEMPORARY_DEMO_ACCOUNTS[0]);
  expectNoCreate();
  const observed = await authService.getCurrentAuthState();
  expect(observed.user).toMatchObject({
    sessionKind: "change_only",
    mustChangePassword: true,
  });
});

it("renders the existing form for direct approved full admin creation", async () => {
  await visit("/apps/new", DEMO_ACCOUNTS[0]);
  expect(
    await screen.findByRole("form", { name: "새 앱 등록 양식" }),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("어플리케이션 이름")).toHaveValue("");
});

it.each(
  [
    ["pending", { approved: false }],
    ["change_only", { sessionKind: "change_only", mustChangePassword: false }],
    [
      "password change required",
      { sessionKind: "full", mustChangePassword: true },
    ],
  ].flatMap(([name, override]) =>
    ["/", "/apps/new"].map((path) => [name, override, path]),
  ),
)(
  "hides registration for an injected admin with %s (%j) at %s",
  async (_name, override, path) => {
    await authService.login(DEMO_ACCOUNTS[0]);
    const observed = await authService.getCurrentAuthState();
    expect(observed.user).toMatchObject({
      role: "admin",
      approved: true,
      sessionKind: "full",
      mustChangePassword: false,
    });
    const state = { ...observed, user: { ...observed.user, ...override } };
    const spy = vi
      .spyOn(authService, "getCurrentAuthState")
      .mockResolvedValue(state);
    await visit(path, null);
    await screen.findByRole("button", { name: "로그아웃" });
    await waitFor(() =>
      expect(client.getQueryState(["mock", "meta"])).toMatchObject({
        status: "success",
        fetchStatus: "idle",
      }),
    );
    expect(spy).toHaveBeenCalled();
    if (path === "/apps/new") {
      if (override.approved === false)
        await screen.findByText("승인된 회원만 앱을 등록할 수 있어요");
      else
        await waitFor(() =>
          expect(router.state.location.search).toContain(
            "mode=password-change",
          ),
        );
    }
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
  },
);

it("admin private saves cancel old member details and in-flight public lists", async () => {
  await visit(ownEdit, DEMO_ACCOUNTS[0]);
  const form = await screen.findByRole("form", { name: "앱 수정 양식" });
  const stale = await appsService.get("00000000-0000-4000-8000-000000000001");
  const keys = [
    [__DATA_MODE__, "apps", "detail", stale.id, "member", "old-owner-scope"],
    [__DATA_MODE__, "apps", "list", "held-public-page"],
  ];
  const held = keys.map((queryKey) => {
    client.setQueryData(queryKey, stale);
    let release;
    let signal;
    const pending = client.prefetchQuery({
      queryKey,
      queryFn: ({ signal: current }) => {
        signal = current;
        return new Promise((resolve) => {
          release = resolve;
        });
      },
    });
    return { pending, release, signal };
  });
  const name = within(form).getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  fireEvent.change(name, { target: { value: "관리자 비공개 편집 결과" } });
  fireEvent.click(within(form).getByRole("switch", { name: "전체 공개" }));
  fireEvent.click(within(form).getByRole("button", { name: "변경사항 저장" }));
  await screen.findByRole(
    "heading",
    { name: "관리자 비공개 편집 결과" },
    { timeout: 5000 },
  );
  for (const entry of held) expect(entry.signal.aborted).toBe(true);
  await act(async () => {
    for (const entry of held) entry.release(stale);
    await Promise.all(held.map((entry) => entry.pending));
  });
  for (const key of keys) expect(client.getQueryData(key)).toBeUndefined();
});

it.each(["navigation", "rotation", "other", "hidden"])(
  "retires public caches after a private admin save during %s without stale navigation",
  async (transition) => {
    await visit(ownEdit, DEMO_ACCOUNTS[0]);
    const form = await screen.findByRole("form", { name: "앱 수정 양식" });
    const original = await appsService.get(
      "00000000-0000-4000-8000-000000000001",
    );
    const page = await appsService.list({ limit: 24, offset: 0 });
    const saved = {
      ...original,
      isPublic: false,
      version: 2,
      name: "이전 관리자 저장 완료",
    };
    // API writes do not emit the mock storage event that also clears caches.
    vi.spyOn(appsService, "issueUpdateOperation").mockResolvedValue({
      key: "00000000-0000-4000-8000-000000000201",
      kind: "app_update",
      targetId: original.id,
      state: "unresolved",
    });
    vi.spyOn(appsService, "update").mockResolvedValue(saved);
    vi.spyOn(appsService, "get").mockResolvedValue(saved);
    const publicKey = [__DATA_MODE__, "apps", "detail", original.id, "public"];
    const listKey = [__DATA_MODE__, "apps", "list", "", null, null, 24];
    client.setQueryData(publicKey, original);
    client.setQueryData(listKey, { pages: [page], pageParams: [0] });
    fireEvent.click(within(form).getByRole("switch", { name: "전체 공개" }));
    let release;
    const cancel = client.cancelQueries.bind(client);
    vi.spyOn(client, "cancelQueries").mockImplementation(async (filters) => {
      await cancel(filters);
      if (!release && filters.queryKey?.[2] === "detail")
        await new Promise((resolve) => {
          release = resolve;
        });
    });
    fireEvent.change(
      within(form).getByRole("textbox", { name: "어플리케이션 이름" }),
      { target: { value: "이전 관리자 저장 완료" } },
    );
    fireEvent.click(
      within(form).getByRole("button", { name: "변경사항 저장" }),
    );
    await waitFor(() => expect(release).toBeTypeOf("function"));
    if (transition === "navigation") {
      await act(async () => router.navigate(ownEdit, { replace: true }));
    } else if (transition === "hidden") {
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      await act(async () =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
    } else {
      await act(async () => {
        window.dispatchEvent(new Event("blur"));
        if (transition === "other") {
          await authService.logout();
          await authService.login(DEMO_ACCOUNTS[1]);
        }
        window.dispatchEvent(new Event("focus"));
      });
      await screen.findByRole("button", { name: "로그아웃" });
    }
    const locationKey = router.state.location.key;
    await act(async () => release());
    expect(router.state.location.key).toBe(locationKey);
    expect(router.state.location.pathname).toBe(ownEdit);
    expect(screen.queryByText("앱을 수정했어요.")).not.toBeInTheDocument();
    expect(client.getQueryData(publicKey)).toBeUndefined();
    expect(client.getQueryData(listKey)).toBeUndefined();
  },
);

it("clears an active public detail after a private save without stale navigation", async () => {
  await visit(ownEdit, DEMO_ACCOUNTS[0]);
  const form = await screen.findByRole("form", { name: "앱 수정 양식" });
  const original = await appsService.get(
    "00000000-0000-4000-8000-000000000001",
  );
  const saved = {
    ...original,
    isPublic: false,
    version: 2,
    name: "확정된 비공개 결과",
  };
  // API writes do not emit the mock storage event that also clears caches.
  vi.spyOn(appsService, "issueUpdateOperation").mockResolvedValue({
    key: "00000000-0000-4000-8000-000000000201",
    kind: "app_update",
    targetId: original.id,
    state: "unresolved",
  });
  vi.spyOn(appsService, "update").mockResolvedValue(saved);
  const { ServiceError } = await import("../src/services/service-error");
  let rejectPublicRead;
  vi.spyOn(appsService, "get").mockImplementation(async (_id, options) => {
    if (options?.readContext) return saved;
    return new Promise((_resolve, reject) => {
      rejectPublicRead = () =>
        reject(
          new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
            httpStatus: 404,
          }),
        );
    });
  });
  const publicKey = [__DATA_MODE__, "apps", "detail", original.id, "public"];
  client.setQueryData(publicKey, original);
  let release;
  const cancel = client.cancelQueries.bind(client);
  vi.spyOn(client, "cancelQueries").mockImplementation(async (filters) => {
    await cancel(filters);
    if (!release && filters.queryKey?.[2] === "detail")
      await new Promise((resolve) => {
        release = resolve;
      });
  });
  fireEvent.click(within(form).getByRole("switch", { name: "전체 공개" }));
  fireEvent.click(within(form).getByRole("button", { name: "변경사항 저장" }));
  await waitFor(() => expect(release).toBeTypeOf("function"));
  await act(async () => router.navigate(`/apps/${original.id}`));
  await waitFor(() => expect(rejectPublicRead).toBeTypeOf("function"));
  await screen.findByRole("button", { name: "로그아웃" });
  expect(
    screen.getByRole("heading", { name: original.name, exact: true }),
  ).toBeInTheDocument();
  const locationKey = router.state.location.key;
  await act(async () => release());
  // Retirement must hide the old public body before a pending read settles.
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: original.name, exact: true }),
    ).not.toBeInTheDocument(),
  );
  expect(client.getQueryData(publicKey)).toBeUndefined();
  expect(router.state.location.key).toBe(locationKey);
  expect(screen.queryByText("앱을 수정했어요.")).not.toBeInTheDocument();
  await act(async () => rejectPublicRead());
  await screen.findByRole("heading", { name: saved.name, exact: true });
});

it.each(["/", "/apps/new"])(
  "hides creation for a real change-only admin at %s",
  async (path) => {
    await visit(path, TEMPORARY_DEMO_ACCOUNTS[1]);
    const observed = await authService.getCurrentAuthState();
    expect(observed.user).toMatchObject({
      role: "admin",
      sessionKind: "change_only",
      mustChangePassword: true,
    });
    if (path === "/apps/new")
      await waitFor(() =>
        expect(router.state.location.search).toContain("mode=password-change"),
      );
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
  },
);

it.each(["/", "/apps/new"])(
  "hides creation during checking and failed auth proof with a stale admin identity at %s",
  async (path) => {
    await visit(path, DEMO_ACCOUNTS[0]);
    await waitFor(() =>
      expect(client.getQueryState(["mock", "meta"])).toMatchObject({
        status: "success",
        fetchStatus: "idle",
      }),
    );
    let reject;
    const proof = vi
      .spyOn(authService, "getCurrentAuthState")
      .mockImplementation(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
    await act(async () => window.dispatchEvent(new Event("blur")));
    await act(async () => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(proof).toHaveBeenCalled());
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
    await act(async () => reject(new Error("관리자 인증 조회 실패")));
    if (path === "/apps/new") await screen.findByText("관리자 인증 조회 실패");
    else {
      const banner = within(screen.getByRole("banner"));
      await waitFor(() =>
        expect(banner.queryByRole("status")).not.toBeInTheDocument(),
      );
      expect(
        banner.getByRole("button", { name: "다시 확인" }),
      ).toBeInTheDocument();
      expect(
        banner.queryByRole("button", { name: "로그아웃" }),
      ).not.toBeInTheDocument();
    }
    expectNoCreate();
    expect(
      screen.queryByRole("form", { name: "새 앱 등록 양식" }),
    ).not.toBeInTheDocument();
  },
);

it("shows the updated private owner detail after saving an app with cached public detail", async () => {
  await visit("/apps/00000000-0000-4000-8000-000000000001");
  await screen.findByRole("heading", { name: "분수 피자 가게", exact: true });
  await act(async () => router.navigate(ownEdit));
  await screen.findByRole("heading", { name: "앱 정보 편집", exact: true });
  const original = await appsService.get(
    "00000000-0000-4000-8000-000000000001",
  );
  client.setQueryData(
    [__DATA_MODE__, "apps", "detail", original.id, "public"],
    original,
  );
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });
  const latePublic = client
    .fetchQuery({
      queryKey: [__DATA_MODE__, "apps", "detail", original.id, "public"],
      queryFn: async () => {
        await held;
        return original;
      },
    })
    .catch(() => undefined);
  const saved = {
    ...original,
    name: "비공개로 편집한 피자",
    isPublic: false,
    version: 2,
  };
  vi.spyOn(appsService, "issueUpdateOperation").mockResolvedValue({
    key: "00000000-0000-4000-8000-000000000201",
    kind: "app_update",
    targetId: original.id,
    state: "unresolved",
  });
  vi.spyOn(appsService, "update").mockImplementation(async () => {
    vi.spyOn(appsService, "get").mockResolvedValue(saved);
    return saved;
  });
  const form = screen.getByRole("form", { name: "앱 수정 양식", exact: true });
  fireEvent.change(
    within(form).getByRole("textbox", {
      name: "어플리케이션 이름",
      exact: true,
    }),
    { target: { value: "비공개로 편집한 피자" } },
  );
  fireEvent.click(
    within(form).getByRole("switch", { name: "전체 공개", exact: true }),
  );
  fireEvent.click(
    within(form).getByRole("button", { name: "변경사항 저장", exact: true }),
  );
  expect(
    await screen.findByRole("heading", {
      name: "비공개로 편집한 피자",
      exact: true,
    }),
  ).toBeInTheDocument();
  await act(async () => {
    release();
    await latePublic;
  });
  expect(
    client.getQueryData([
      __DATA_MODE__,
      "apps",
      "detail",
      "00000000-0000-4000-8000-000000000001",
      "public",
    ]),
  ).toBeUndefined();
});

it.each(
  ["checkResult", "loadLatest"].flatMap((action) =>
    [1, 0].map((account) => [action, account]),
  ),
)(
  "uses the captured actor observation when %s reads latest private detail for account %s",
  async (action, account) => {
    const { ServiceError } = await import("../src/services/service-error");
    const id = "00000000-0000-4000-8000-000000000001";
    const original = await appsService.get(id);
    const latest = {
      ...original,
      isPublic: false,
      name: "최신 비공개 앱",
      version: 2,
    };
    const reader = vi
      .spyOn(appsService, "get")
      .mockResolvedValue({ ...original, isPublic: false });
    vi.spyOn(appsService, "issueUpdateOperation").mockResolvedValue({
      key: "00000000-0000-4000-8000-000000000201",
      kind: "app_update",
      targetId: id,
      state: "unresolved",
    });
    vi.spyOn(appsService, "update").mockRejectedValue(
      new ServiceError(
        action === "checkResult" ? "NETWORK_ERROR" : "VERSION_CONFLICT",
        "편집 결과 확인",
        { outcome: action === "checkResult" ? "unknown" : "rejected" },
      ),
    );
    vi.spyOn(appsService, "getUpdateOperation").mockResolvedValue({
      kind: "app_update",
      targetId: id,
      state: "succeeded",
      resultVersion: 2,
    });
    await visit(ownEdit, DEMO_ACCOUNTS[account]);
    const actor = (await authService.getCurrentAuthState()).user;
    await screen.findByRole("heading", { name: "앱 정보 편집", exact: true });
    const form = screen.getByRole("form", {
      name: "앱 수정 양식",
      exact: true,
    });
    fireEvent.change(
      within(form).getByRole("textbox", {
        name: "어플리케이션 이름",
        exact: true,
      }),
      { target: { value: "저장할 초안" } },
    );
    fireEvent.click(
      within(form).getByRole("button", { name: "변경사항 저장", exact: true }),
    );
    const button = await screen.findByRole("button", {
      name: action === "checkResult" ? "저장 결과 확인" : "최신 내용 불러오기",
      exact: true,
    });
    reader.mockClear();
    reader.mockResolvedValue(latest);
    fireEvent.click(button);
    if (action === "checkResult")
      await screen.findByRole("heading", { name: latest.name, exact: true });
    else
      await waitFor(() =>
        expect(
          within(form).getByRole("textbox", {
            name: "어플리케이션 이름",
            exact: true,
          }),
        ).toHaveValue(latest.name),
      );
    const call = reader.mock.calls[0];
    expect(call?.[0]).toBe(id);
    expect(call?.[1]?.readContext).toMatchObject({
      state: { user: { id: actor.id } },
    });
    expect(call?.[1]?.readContext?.state.flow.sessionGeneration).toBeTruthy();
  },
);
