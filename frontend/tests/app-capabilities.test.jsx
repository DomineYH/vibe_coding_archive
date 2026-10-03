import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
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

it("hides create navigation when metadata disables creation", async () => {
  disable("apps_create");
  await visit();
  await screen.findByRole("link", { name: /^분수 피자 가게,/ });
  expectNoCreate();
});

it("shows preparation copy on direct create", async () => {
  disable("apps_create");
  await visit("/apps/new");
  const main = within(screen.getByRole("main"));
  expect(
    await main.findByText("앱 등록 기능은 아직 준비 중이에요"),
  ).toBeInTheDocument();
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
});

it("shows preparation copy on own edit", async () => {
  disable("apps_update_own");
  await visit(ownEdit);
  const main = within(screen.getByRole("main"));
  expect(
    await main.findByText("앱 수정 기능은 아직 준비 중이에요"),
  ).toBeInTheDocument();
  expect(main.queryByText(/잠시 후 다시 확인/)).not.toBeInTheDocument();
  expect(
    main.queryByRole("button", { name: "다시 확인" }),
  ).not.toBeInTheDocument();
});

it("shows both creation controls for an enabled member without another metadata request", async () => {
  await visit();
  const nav = within(screen.getByRole("navigation", { name: "주 메뉴" }));
  expect(await nav.findByRole("link", { name: "앱 등록" })).toBeInTheDocument();
  expect(
    await screen.findByRole("button", { name: "내 앱 등록하기" }),
  ).toBeInTheDocument();
  expect(metadata).toHaveBeenCalledTimes(1);
});

it.each(["apps_create", "apps_update_own"])(
  "keeps transient copy for other disabled reasons on %s",
  async (capability) => {
    disable(capability, ["maintenance"]);
    await visit(capability === "apps_create" ? "/apps/new" : ownEdit);
    expect(
      await screen.findByText("잠시 후 다시 확인해 주세요."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
  },
);

it.each(["apps_create", "apps_update_own"])(
  "recognizes not_implemented among mixed reasons on %s",
  async (capability) => {
    disable(capability, ["maintenance", "not_implemented"]);
    await visit(capability === "apps_create" ? "/apps/new" : ownEdit);
    expect(await screen.findByText(/아직 준비 중이에요/)).toBeInTheDocument();
    expect(screen.queryByText(/잠시 후 다시 확인/)).not.toBeInTheDocument();
  },
);

it("checks ownership before unavailable edit copy", async () => {
  disable("apps_update_own");
  await visit(ownEdit, DEMO_ACCOUNTS[4]);
  expect(await screen.findByText("앱을 수정할 수 없어요")).toBeInTheDocument();
  expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
});

it("hides creation while metadata is missing and loading", async () => {
  let release;
  metadata.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  await visit("/apps/new");
  expect(
    await screen.findByText("등록 기능을 확인하고 있어요"),
  ).toBeInTheDocument();
  expectNoCreate();
  await act(async () => release(meta));
  expect(
    await screen.findByRole("form", { name: "새 앱 등록 양식" }),
  ).toBeInTheDocument();
});

it.each(["/", "/apps/new", ownEdit])(
  "keeps creation with cached enabled metadata during refetch and hides it after failure at %s",
  async (path) => {
    await visit(path);
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
    expect(await screen.findByText("메타 조회 실패")).toBeInTheDocument();
    expect(screen.queryByText(/아직 준비 중이에요/)).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("main")).getByRole("button", {
        name: "다시 확인",
      }),
    ).toBeInTheDocument();
  },
);

it("keeps retry available when the initial metadata request fails", async () => {
  metadata.mockRejectedValue(new Error("메타 조회 실패"));
  await visit("/apps/new");
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
});

it.each([null, DEMO_ACCOUNTS[0]])(
  "hides creation for anonymous and admin sessions: %j",
  async (account) => {
    await visit("/", account);
    await screen.findByRole("link", { name: /^분수 피자 가게,/ });
    expectNoCreate();
  },
);

it("conceals both creation controls while authentication is being rechecked", async () => {
  await visit();
  await screen.findByRole("button", { name: "내 앱 등록하기" });
  await act(async () => window.dispatchEvent(new Event("blur")));
  expectNoCreate();
});

it("hides creation for a pending member rejected by real mock login", async () => {
  await expect(authService.login(DEMO_ACCOUNTS[2])).rejects.toMatchObject({
    code: "ACCOUNT_NOT_APPROVED",
  });
  await visit("/", null);
  await screen.findByRole("button", { name: "로그인", exact: true });
  expectNoCreate();
});

it("hides creation for a real change-only member session", async () => {
  await visit("/", TEMPORARY_DEMO_ACCOUNTS[0]);
  expectNoCreate();
  const observed = await authService.getCurrentAuthState();
  expect(observed.user).toMatchObject({
    sessionKind: "change_only",
    mustChangePassword: true,
  });
});
