import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { appsService } from "../src/services/mock/apps";
import { resetMockState } from "../src/services/mock/state";
import { ServiceError } from "../src/services/service-error";

let client;
let router;
let item;
const input = {
  name: "삭제 대상 수업",
  url: "https://example.com/class",
  prompt: "삭제할 본문",
  description: "삭제할 설명",
  subject: "수학",
  grades: ["초3"],
  isPublic: true,
  themeId: "niagara",
  stack: { db: "", backend: "", frontend: "", hosting: "" },
};
async function setup(role = "user") {
  await authService.login({
    loginId: role === "admin" ? "admin" : "교사김코딩",
    password: role === "admin" ? "admin123" : "1234",
  });
  const meta = await appsService.getMeta();
  vi.spyOn(appsService, "getMeta").mockResolvedValue({
    ...meta,
    capabilities: {
      ...meta.capabilities,
      admin_apps_manage: { enabled: false, reasons: ["not_implemented"] },
    },
  });
  const operation = await appsService.issueCreateOperation(input);
  item = await appsService.create(input, operation.key);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: [`/apps/${item.id}`],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: input.name });
}
async function confirm() {
  await userEvent.click(
    await screen.findByRole("button", { name: "삭제", exact: true }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "삭제 확인", exact: true }),
  );
}
beforeEach(() => {
  localStorage.clear();
  resetMockState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  client?.clear();
  router?.dispose();
  vi.restoreAllMocks();
});

it("allows an admin to delete their own app with other-owner management disabled", async () => {
  await setup("admin");
  expect(
    await screen.findByRole("button", { name: "삭제", exact: true }),
  ).toBeInTheDocument();
});

it("cancel submits no operation and duplicate confirmation executes one key", async () => {
  await setup();
  const issue = vi.spyOn(appsService, "issueDeleteOperation");
  const execute = vi.spyOn(appsService, "delete");
  await userEvent.click(
    screen.getByRole("button", { name: "삭제", exact: true }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "취소", exact: true }),
  );
  expect(issue).not.toHaveBeenCalled();
  expect(execute).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole("button", { name: "삭제", exact: true }),
  );
  const button = screen.getByRole("button", { name: "삭제 확인", exact: true });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
});

it("retires confirmed DB-applied content while preserving same-key confirmation", async () => {
  await setup();
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError(
      "DELETION_CONFIRMATION_PENDING",
      "앱 삭제가 반영되었어요.",
      { outcome: "unknown" },
    ),
  );
  const get = vi.spyOn(appsService, "getDeleteOperation").mockResolvedValue({
    key: item.id,
    kind: "app_delete",
    targetId: item.id,
    state: "confirming_deletion",
    dbAppliedAt: "2026-10-05T00:00:00Z",
  });
  await confirm();
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  expect(
    screen.queryByRole("heading", { name: input.name }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "앱 편집" }),
  ).not.toBeInTheDocument();
  expect(
    client
      .getQueriesData({ queryKey: [__DATA_MODE__, "apps", "detail", item.id] })
      .every(([, data]) => data === undefined),
  ).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "삭제 결과 확인" }));
  expect(get).toHaveBeenCalledTimes(1);
});

it("does not execute a late issued key after a new authentication observation", async () => {
  await setup();
  let resolve;
  vi.spyOn(appsService, "issueDeleteOperation").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const execute = vi.spyOn(appsService, "delete");
  await confirm();
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: input.name })).toBeVisible(),
  );
  await act(async () =>
    resolve({
      key: item.id,
      kind: "app_delete",
      targetId: item.id,
      state: "unresolved",
    }),
  );
  expect(execute).not.toHaveBeenCalled();
});

it("requires latest content and a fresh confirmation after version conflict", async () => {
  await setup();
  const issue = vi.spyOn(appsService, "issueDeleteOperation");
  const execute = vi.spyOn(appsService, "delete").mockRejectedValueOnce(
    new ServiceError("VERSION_CONFLICT", "최신 상태 확인", {
      outcome: "rejected",
    }),
  );
  await confirm();
  await screen.findByText("최신 상태 확인");
  await userEvent.click(screen.getByRole("button", { name: "최신 앱 확인" }));
  await screen.findByRole("button", { name: "삭제 확인", exact: true });
  expect(issue).toHaveBeenCalledTimes(1);
  await userEvent.click(
    screen.getByRole("button", { name: "삭제 확인", exact: true }),
  );
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
  expect(issue).toHaveBeenCalledTimes(2);
});

it("preserves the issued key across temporary auth loss and same-member re-login", async () => {
  await setup();
  const issue = vi.spyOn(appsService, "issueDeleteOperation");
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError("SERVICE_UNAVAILABLE", "응답 유실", {
      outcome: "unknown",
    }),
  );
  await confirm();
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  await act(async () => {
    await authService.logout();
    window.dispatchEvent(new Event("focus"));
  });
  await screen.findByRole("button", { name: "로그인", exact: true });
  await act(async () => {
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    window.dispatchEvent(new Event("focus"));
  });
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  await userEvent.click(
    screen.getByRole("button", { name: "같은 삭제 요청 다시 보내기" }),
  );
  expect(issue).toHaveBeenCalledTimes(1);
});

it("keeps a known key recoverable when a late DELETE settles after same-member reauthentication", async () => {
  await setup();
  let resolve;
  const execute = vi.spyOn(appsService, "delete").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const get = vi.spyOn(appsService, "getDeleteOperation");
  await confirm();
  await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  await act(async () => resolve());
  expect(screen.queryByText("앱을 삭제했어요.")).not.toBeInTheDocument();
  await userEvent.click(
    await screen.findByRole("button", { name: "삭제 결과 확인" }),
  );
  expect(get).toHaveBeenCalledTimes(1);
});

it("explicit logout clears uncertain deletion context", async () => {
  await setup();
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError("SERVICE_UNAVAILABLE", "응답 유실", {
      outcome: "unknown",
    }),
  );
  await confirm();
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  await userEvent.click(
    screen.getByRole("button", { name: "로그아웃", exact: true }),
  );
  await screen.findByRole("button", { name: "로그인", exact: true });
  await act(async () => {
    await authService.login({ loginId: "교사김코딩", password: "1234" });
    window.dispatchEvent(new Event("focus"));
  });
  expect(
    screen.queryByRole("button", { name: "삭제 결과 확인" }),
  ).not.toBeInTheDocument();
});

it("different-member transitions discard keys and late execution cannot navigate or toast", async () => {
  await setup();
  let resolve;
  vi.spyOn(appsService, "delete").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await confirm();
  await act(async () => {
    await authService.logout();
    await authService.login({ loginId: "과학덕후박샘", password: "1234" });
    window.dispatchEvent(new Event("focus"));
  });
  await act(async () => resolve());
  expect(screen.queryByText("앱을 삭제했어요.")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "삭제 결과 확인" }),
  ).not.toBeInTheDocument();
});

it("aborts every in-flight detail scope and refuses late cache refill after DB-applied deletion", async () => {
  await setup();
  let resolve;
  let signal;
  const key = [
    __DATA_MODE__,
    "apps",
    "detail",
    item.id,
    "member",
    "old-edit-scope",
  ];
  const pending = client.prefetchQuery({
    queryKey: key,
    queryFn: ({ signal: current }) => {
      signal = current;
      return new Promise((r) => {
        resolve = r;
      });
    },
  });
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError(
      "DELETION_CONFIRMATION_PENDING",
      "앱 삭제가 반영되었어요.",
      { outcome: "unknown" },
    ),
  );
  await confirm();
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  expect(signal.aborted).toBe(true);
  await act(async () => {
    resolve(item);
    await pending;
  });
  expect(client.getQueryData(key)).toBeUndefined();
  expect(
    screen.queryByRole("heading", { name: input.name }),
  ).not.toBeInTheDocument();
});

it("warns before leaving an unresolved deletion and before unloading the tab", async () => {
  await setup();
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError(
      "DELETION_CONFIRMATION_PENDING",
      "앱 삭제가 반영되었어요.",
      { outcome: "unknown" },
    ),
  );
  const warn = vi.spyOn(window, "confirm").mockReturnValue(false);
  await confirm();
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  await userEvent.click(
    screen.getByRole("button", { name: "갤러리로", exact: true }),
  );
  expect(warn).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "삭제 결과 확인" }),
  ).toBeInTheDocument();
});

it("shows terminal absence after gallery, back, and direct edit navigation for a retired id", async () => {
  await setup();
  await confirm();
  await screen.findByText("앱을 삭제했어요.");
  await act(async () => router.navigate(`/apps/${item.id}`));
  await screen.findByText("아카이브 앱을 찾을 수 없어요", { exact: true });
  expect(
    screen.queryByRole("heading", { name: input.name }),
  ).not.toBeInTheDocument();
  await act(async () => router.navigate(`/apps/${item.id}/edit`));
  await screen.findByText("아카이브 앱을 찾을 수 없어요", { exact: true });
  expect(
    screen.queryByRole("form", { name: "앱 수정 양식" }),
  ).not.toBeInTheDocument();
});

it("uses only the original key after response loss and detail404", async () => {
  await setup();
  const apply = appsService.delete.bind(appsService);
  const issue = vi.spyOn(appsService, "issueDeleteOperation");
  vi.spyOn(appsService, "delete").mockImplementation(async (...args) => {
    await apply(...args);
    throw new ServiceError("SERVICE_UNAVAILABLE", "응답 유실", {
      outcome: "unknown",
    });
  });
  await confirm();
  await screen.findByRole("button", { name: "삭제 결과 확인" });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [__DATA_MODE__, "apps", "detail", item.id],
    });
  });
  await screen.findByRole("button", { name: "같은 삭제 요청 다시 보내기" });
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: input.name }),
    ).not.toBeInTheDocument(),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "같은 삭제 요청 다시 보내기" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "삭제 결과 확인" }),
  );
  await screen.findByText("앱을 삭제했어요.");
  expect(issue).toHaveBeenCalledTimes(1);
});

it("does not navigate on an unrelated succeeded lookup", async () => {
  await setup();
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError("SERVICE_UNAVAILABLE", "응답 유실", {
      outcome: "unknown",
    }),
  );
  vi.spyOn(appsService, "getDeleteOperation").mockResolvedValue({
    key: item.id,
    kind: "app_delete",
    targetId: "00000000-0000-4000-8000-000000000999",
    state: "succeeded",
  });
  await confirm();
  await userEvent.click(
    await screen.findByRole("button", { name: "삭제 결과 확인" }),
  );
  await screen.findByText(/삭제 결과를 확인할 수 없어요/);
  expect(screen.queryByText("앱을 삭제했어요.")).not.toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/apps/${item.id}`);
});

it("retires stale content when conflict recovery explicitly reads a now-missing target", async () => {
  await setup();
  vi.spyOn(appsService, "delete").mockRejectedValue(
    new ServiceError("VERSION_CONFLICT", "최신 상태 확인", {
      outcome: "rejected",
    }),
  );
  await confirm();
  await screen.findByRole("button", { name: "최신 앱 확인" });
  vi.spyOn(appsService, "get").mockRejectedValue(
    new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요."),
  );
  await userEvent.click(screen.getByRole("button", { name: "최신 앱 확인" }));
  await screen.findByText(/최신 앱을 확인하지 못했어요/);
  expect(
    screen.queryByRole("heading", { name: input.name }),
  ).not.toBeInTheDocument();
});
