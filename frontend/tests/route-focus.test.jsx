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
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { appsService } from "../src/services/mock/apps";
import { ServiceError } from "../src/services/service-error";
import App from "../src/app/app";
import { authService } from "../src/services/mock/auth";
import { MOCK_STORAGE_KEY, resetMockState } from "../src/services/mock/state";

let router;
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
  router?.dispose();
  queryClient.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});
function mount(path = "/", strict = false) {
  router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: [path],
  });
  const app = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
  render(strict ? <StrictMode>{app}</StrictMode> : app);
}
async function navigate(path, options) {
  await act(() => router.navigate(path, options));
}

it("227 focuses and names the displayed main after PUSH, REPLACE and POP", async () => {
  mount();
  await screen.findByRole("heading", { level: 1 });
  fireEvent.click(
    within(screen.getByRole("banner")).getByRole("button", {
      name: "로그인",
      exact: true,
    }),
  );
  await screen.findByLabelText("로그인 아이디");
  await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  expect(screen.getByRole("main")).toHaveAccessibleName("다시 만나서 반가워요");
  await navigate("/missing", { replace: true });
  await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  expect(screen.getByRole("main")).toHaveAccessibleName(
    "페이지를 찾을 수 없어요",
  );
  await navigate(-1);
  await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
  expect(screen.getByRole("main")).toHaveAccessibleName(/수업을 바꾼 앱/);
  await navigate(1);
  await expectMain("페이지를 찾을 수 없어요");
});
it("227 preserves initial member detail loading focus", async () => {
  await authService.login({ loginId: "교사김코딩", password: "1234" });
  mount("/apps/00000000-0000-4000-8000-000000000001");
  expect(document.body).toHaveFocus();
  await screen.findByRole("heading", { level: 1 });
  expect(document.body).toHaveFocus();
  expect(screen.getByRole("main")).toHaveAccessibleName(/.+/);
});

const appPath = "/apps/00000000-0000-4000-8000-000000000001";
async function settle() {
  await act(() => new Promise(requestAnimationFrame));
  await act(() => new Promise(requestAnimationFrame));
}
async function expectMain(name) {
  await waitFor(() => {
    expect(screen.getByRole("main")).toHaveAccessibleName(name);
    expect(screen.getByRole("main")).toHaveFocus();
  });
}
async function member(loginId = "교사김코딩", password = "1234") {
  await authService.login({ loginId, password });
}
function deferRead() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it.each(["/", "/auth?mode=login", "/apps/new", appPath])(
  "227 initial arrival and protected redirect keep document focus at %s",
  async (path) => {
    mount(path, true);
    await screen.findByRole("heading", { level: 1 });
    await settle();
    expect(document.body).toHaveFocus();
    expect(screen.getByRole("main")).toHaveAccessibleName(/.+/);
  },
);
it("227 auth variants and invalid recovery move focus but return_to and hash do not", async () => {
  mount("/auth?mode=login");
  await screen.findByLabelText("로그인 아이디");
  await settle();
  const input = screen.getByLabelText("로그인 아이디");
  input.focus();
  await navigate("/auth?mode=login&return_to=%2Fapps%2Fnew#ignored", {
    replace: true,
  });
  await settle();
  expect(input).toHaveFocus();
  fireEvent.click(screen.getByRole("link", { name: "회원가입", exact: true }));
  await expectMain("아카이브에 합류하기");
  await navigate("/auth?mode=password-change");
  await expectMain("비밀번호 변경 전용 로그인이 필요해요");
  await navigate("/auth?mode=reauth");
  await expectMain("이 인증 기능은 아직 제공하지 않아요");
  await navigate("/auth?mode=invalid");
  await expectMain("로그인 주소를 확인해 주세요");
  fireEvent.click(screen.getByRole("link", { name: "로그인 주소 초기화" }));
  await expectMain("다시 만나서 반가워요");
});
it("227 delayed detail hands off to terminal and retains preventScroll", async () => {
  await member();
  const original = appsService.get.bind(appsService);
  const gate = deferRead();
  vi.spyOn(appsService, "get").mockImplementation(async (...args) => {
    await gate.promise;
    return original(...args);
  });
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  mount();
  await screen.findByRole("heading", { level: 1 });
  await settle();
  try {
    await navigate(appPath);
    await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
    expect(screen.getByRole("main")).toHaveAttribute(
      "data-route-pending",
      "true",
    );
    await act(async () => gate.release());
    await expectMain("분수 피자 가게");
    expect(screen.getByRole("main")).not.toHaveAttribute("data-route-pending");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(
      focus.mock.calls.every(([options]) => options?.preventScroll === true),
    ).toBe(true);
  } finally {
    gate.release();
  }
});
it.each(["header", "depart"])(
  "227 late detail does not steal focus after %s",
  async (action) => {
    await member();
    const original = appsService.get.bind(appsService);
    const gate = deferRead();
    vi.spyOn(appsService, "get").mockImplementation(async (...args) => {
      await gate.promise;
      return original(...args);
    });
    mount();
    await screen.findByRole("heading", { level: 1 });
    await settle();
    try {
      await navigate(appPath);
      await waitFor(() => expect(screen.getByRole("main")).toHaveFocus());
      const logout = screen.getByRole("button", { name: "로그아웃" });
      if (action === "header") logout.focus();
      else {
        await navigate("/missing");
        await expectMain("페이지를 찾을 수 없어요");
      }
      await act(async () => gate.release());
      if (action === "header") {
        await screen.findByRole("heading", { name: "분수 피자 가게" });
        await settle();
        expect(logout).toHaveFocus();
      } else {
        await settle();
        await expectMain("페이지를 찾을 수 없어요");
      }
    } finally {
      gate.release();
    }
  },
);
it("227 delayed edit chooses the visible form and honors the unsaved dialog", async () => {
  await member();
  mount();
  await screen.findByRole("heading", { level: 1 });
  await settle();
  await navigate(`${appPath}/edit`);
  await screen.findByLabelText("어플리케이션 이름");
  await expectMain("앱 정보 편집");
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("어플리케이션 이름"), " 수정");
  await user.click(
    within(screen.getByRole("banner")).getByRole("link", {
      name: "갤러리",
      exact: true,
    }),
  );
  const dialog = screen.getByRole("alertdialog");
  const stay = within(dialog).getByRole("button", { name: "계속 작성" });
  stay.focus();
  await settle();
  expect(stay).toHaveFocus();
  expect(router.state.location.pathname).toBe(`${appPath}/edit`);
});
it("227 search composition, filters, refetch and same-path history keep the control focus", async () => {
  mount();
  const search = await screen.findByRole("textbox", { name: "앱·작성자 검색" });
  await settle();
  search.focus();
  fireEvent.compositionStart(search);
  fireEvent.change(search, { target: { value: "분수" } });
  await settle();
  expect(search).toHaveFocus();
  fireEvent.compositionEnd(search);
  await waitFor(() => expect(router.state.location.search).toContain("q="));
  expect(search).toHaveFocus();
  await act(() => queryClient.refetchQueries());
  expect(search).toHaveFocus();
  const math = screen.getByRole("button", { name: "수학", exact: true });
  math.focus();
  fireEvent.click(math);
  await waitFor(() =>
    expect(router.state.location.search).toContain("subject="),
  );
  await settle();
  expect(math).toHaveFocus();
  await navigate(-1);
  await settle();
  expect(math).toHaveFocus();
});
it("227 admin tab clicks and Arrow navigation focus the named dashboard", async () => {
  await member("admin", "admin123");
  mount("/admin");
  await screen.findByRole("heading", { name: "관리자 대시보드" });
  await settle();
  fireEvent.click(screen.getByRole("tab", { name: "Health Monitor" }));
  await expectMain("관리자 대시보드 — Health Monitor");
  const health = screen.getByRole("tab", { name: "Health Monitor" });
  health.focus();
  fireEvent.keyDown(health, { key: "ArrowLeft" });
  await expectMain("관리자 대시보드 — 사용자 관리");
  const users = screen.getByRole("tab", { name: "사용자 관리" });
  users.focus();
  await navigate("/admin?tab=users", { replace: true });
  await settle();
  expect(users).toHaveFocus();
  await navigate("/admin?tab=invalid");
  await expectMain("관리자 탭 주소를 확인해 주세요");
  fireEvent.click(screen.getByRole("button", { name: "조건 초기화" }));
  await expectMain("관리자 대시보드 — 사용자 관리");
  await navigate("/auth?mode=reauth");
  await expectMain("관리자 본인 확인");
});
it("227 error fields and deletion confirmation retain explicit focus", async () => {
  mount();
  await settle();
  fireEvent.click(
    within(screen.getByRole("banner")).getByRole("button", {
      name: "로그인",
      exact: true,
    }),
  );
  await expectMain("다시 만나서 반가워요");
  const user = userEvent.setup();
  fireEvent.click(screen.getByRole("link", { name: "회원가입", exact: true }));
  await expectMain("아카이브에 합류하기");
  fireEvent.submit(
    screen.getByRole("button", { name: "가입 신청하기" }).closest("form"),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("비밀번호 확인 (필수)")).toHaveFocus(),
  );
  fireEvent.click(
    within(screen.getByRole("main")).getByRole("link", {
      name: "로그인",
      exact: true,
    }),
  );
  await expectMain("다시 만나서 반가워요");
  await user.type(screen.getByLabelText("로그인 아이디"), "교사김코딩");
  await user.type(screen.getByLabelText("비밀번호"), "1234");
  await user.click(
    within(screen.getByRole("main")).getByRole("button", {
      name: "로그인",
      exact: true,
    }),
  );
  await expectMain(/수업을 바꾼 앱/);
  await navigate(appPath);
  await expectMain("분수 피자 가게");
  await user.click(screen.getByRole("button", { name: "삭제", exact: true }));
  const group = screen.getByRole("group", { name: /삭제/ });
  expect(group).toContainElement(document.activeElement);
  await act(() => queryClient.refetchQueries());
  await settle();
  expect(group).toContainElement(document.activeElement);
});
it("227 terminal errors, create and reset are named focus destinations", async () => {
  await member();
  mount();
  await settle();
  await navigate("/apps/new");
  await screen.findByLabelText("어플리케이션 이름");
  await expectMain("새 앱 등록");
  vi.spyOn(appsService, "get").mockRejectedValue(
    new ServiceError("NOT_FOUND", "없어요"),
  );
  await navigate("/apps/00000000-0000-4000-8000-000000000099");
  await expectMain("아카이브 앱을 찾을 수 없어요");
  await navigate("/__dev/mock-reset");
  await expectMain("mock 저장 초기화");
});
it("227 rapid transitions and unmount cancel scheduled work", async () => {
  mount("/auth?mode=login", true);
  await screen.findByLabelText("로그인 아이디");
  await settle();
  await navigate("/missing");
  await navigate("/auth?mode=signup");
  await expectMain("아카이브에 합류하기");
  await navigate("/missing");
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  cleanup();
  await settle();
  expect(focus).not.toHaveBeenCalled();
});

it("227 hidden edit main stays inert while the visible recovery destination receives focus", async () => {
  await member();
  const path = "/apps/00000000-0000-4000-8000-000000000091/edit";
  mount(path);
  const name = await screen.findByLabelText("어플리케이션 이름");
  await settle();
  fireEvent.change(name, { target: { value: "227 preserved draft" } });
  const stored = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  stored.auth_flow.session_cookie_present = false;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(stored));
  fireEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));
  const recovery = await screen.findByRole("link", {
    name: "로그인 및 인증 복구",
  });
  expect(name.closest("[inert]")).toHaveAttribute("hidden");
  expect(name.closest("[inert]")).toHaveAttribute("aria-hidden", "true");
  fireEvent.click(recovery);
  await expectMain("인증 결과를 확인할 수 없어요");
  const current = JSON.parse(localStorage.getItem(MOCK_STORAGE_KEY));
  current.auth_flow.session_cookie_present = true;
  localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(current));
  await act(async () => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  const back = await screen.findByRole("button", { name: "편집으로 돌아가기" });
  back.focus();
  await settle();
  expect(back).toHaveFocus();
  fireEvent.click(back);
  await expectMain("앱 정보 편집");
  expect(screen.getByLabelText("어플리케이션 이름")).toHaveValue(
    "227 preserved draft",
  );
});
it("227 user navigation during initial loading is a transition", async () => {
  const gate = deferRead();
  const original = authService.getCurrentAuthState.bind(authService);
  vi.spyOn(authService, "getCurrentAuthState").mockImplementation(async () => {
    await gate.promise;
    return original();
  });
  mount("/apps/new", true);
  try {
    fireEvent.click(screen.getByRole("link", { name: "EduVibe 아카이브 홈" }));
    await expectMain(/수업을 바꾼 앱/);
    await act(async () => gate.release());
    await settle();
    await expectMain(/수업을 바꾼 앱/);
  } finally {
    gate.release();
  }
});

it("227 initial keyboard navigation does not turn an automatic redirect into route focus", async () => {
  const gate = deferRead();
  const original = authService.getCurrentAuthState.bind(authService);
  vi.spyOn(authService, "getCurrentAuthState").mockImplementation(async () => {
    await gate.promise;
    return original();
  });
  mount("/apps/new");
  try {
    await userEvent.setup().tab();
    const logo = screen.getByRole("link", { name: "EduVibe 아카이브 홈" });
    expect(logo).toHaveFocus();
    await act(async () => gate.release());
    await screen.findByLabelText("로그인 아이디");
    await settle();
    expect(logo).toHaveFocus();
  } finally {
    gate.release();
  }
});

it("227 a background document does not receive route focus", async () => {
  mount("/auth?mode=login");
  await screen.findByLabelText("로그인 아이디");
  await settle();
  const logo = screen.getByRole("link", { name: "EduVibe 아카이브 홈" });
  logo.focus();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  await navigate("/missing");
  await settle();
  expect(logo).toHaveFocus();
});
