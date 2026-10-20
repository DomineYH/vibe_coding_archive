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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/app/app";
import { appsService } from "../src/services/mock/apps";
import { authService } from "../src/services/mock/auth";
import { DEMO_ACCOUNTS } from "../src/services/mock/accounts";
import { resetMockState } from "../src/services/mock/state";
import { ServiceError } from "../src/services/service-error";

let client;
let router;
let user;
const editAppId = "00000000-0000-4000-8000-000000000001";
const textFields = [
  ["어플리케이션 이름", "내 수업 도구"],
  ["배포 URL", "https://example.org/class"],
  ["핵심 프롬프트", "수업 도구를 만들어줘."],
  ["상세 설명", "함께 풀이하는 도구입니다."],
  ["DB", "Postgres"],
  ["백엔드 엔진", "Python"],
  ["프론트엔드 프레임워크", "React"],
  ["호스팅 서비스", "Vercel"],
];
const modes = {
  create: {
    path: "/apps/new",
    formName: "새 앱 등록 양식",
    button: "아카이브에 등록",
    issue: "issueCreateOperation",
    save: "create",
  },
  edit: {
    path: `/apps/${editAppId}/edit`,
    formName: "앱 수정 양식",
    button: "변경사항 저장",
    issue: "issueUpdateOperation",
    save: "update",
  },
};

beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  user = userEvent.setup({ delay: null });
  const meta = await appsService.getMeta();
  vi.spyOn(appsService, "getMeta").mockResolvedValue(meta);
});

afterEach(() => {
  cleanup();
  router?.dispose();
  client.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

function textbox(form, label) {
  return within(
    form.getByText(label, { selector: "label", exact: true }).control
      .parentElement,
  ).getByRole("textbox", { name: label, exact: true });
}

async function openForm(mode, { fill = true } = {}) {
  const { path, formName, button } = modes[mode];
  await authService.login(DEMO_ACCOUNTS[1]);
  router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: [path],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const element = await screen.findByRole("form", { name: formName });
  const form = within(element);
  if (fill) {
    for (const [label, value] of textFields) {
      fireEvent.change(textbox(form, label), { target: { value } });
    }
    if (mode === "create") {
      await user.click(
        within(form.getByRole("group", { name: "교과 과목" })).getByRole(
          "button",
          { name: "수학" },
        ),
      );
      await user.click(
        within(form.getByRole("group", { name: "적용 가능 학년" })).getByRole(
          "button",
          { name: "초3" },
        ),
      );
    } else await user.click(form.getByRole("switch", { name: "전체 공개" }));
  }
  return { element, form, button: form.getByRole("button", { name: button }) };
}

function spies(mode) {
  const { issue, save } = modes[mode];
  const original = {
    issue: appsService[issue].bind(appsService),
    save: appsService[save].bind(appsService),
  };
  return {
    original,
    issue: vi.spyOn(appsService, issue),
    save: vi.spyOn(appsService, save),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const submitEvent = (element) => fireEvent.submit(element);
async function microtasks(times = 30) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

async function expectOpened(mode, save) {
  await waitFor(() =>
    expect(router.state.location.pathname).toMatch(
      mode === "create" ? /^\/apps\/(?!new)[^/]+$/ : /^\/apps\/[^/]+$/,
    ),
  );
  expect(save).toHaveBeenCalledTimes(1);
}

describe.each(["create", "edit"])("%s double submit", (mode) => {
  it.each([2, 3])(
    "issues one key and saves once for %i submits before re-render (immediate services)",
    async (count) => {
      const { issue, save } = spies(mode);
      const { element } = await openForm(mode);
      await act(async () => {
        for (let i = 0; i < count; i += 1) submitEvent(element);
      });
      await expectOpened(mode, save);
      expect(issue).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["issue", "save"])(
    "issues one key and saves once when %s is still pending",
    async (pendingStage) => {
      const { issue, save, original } = spies(mode);
      const gate = deferred();
      issue.mockImplementation(async (...args) => {
        const result = await original.issue(...args);
        if (pendingStage === "issue") await gate.promise;
        return result;
      });
      save.mockImplementation(async (...args) => {
        if (pendingStage === "save") await gate.promise;
        return original.save(...args);
      });
      const { element } = await openForm(mode);
      await act(async () => {
        submitEvent(element);
        submitEvent(element);
        submitEvent(element);
      });
      await act(async () => {
        gate.resolve();
        await microtasks();
      });
      await expectOpened(mode, save);
      expect(issue).toHaveBeenCalledTimes(1);
    },
  );

  it("does not issue a second key or save when submitted again after success but before hand-off", async () => {
    const { issue, save } = spies(mode);
    const { element } = await openForm(mode);
    await act(async () => {
      submitEvent(element);
      for (let i = 0; i < 100 && save.mock.calls.length === 0; i += 1) {
        await Promise.resolve();
      }
      await save.mock.results[0]?.value;
      await microtasks();
      submitEvent(element);
      await microtasks();
    });
    await expectOpened(mode, save);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("create retry after a confirmed outcome", () => {
  const confirmed = () =>
    new ServiceError("VALIDATION_ERROR", "서버 검증 안내", {
      httpStatus: 422,
      outcome: "not_applicable",
      fields: { name: "이름 서버 안내" },
    });

  it("allows submitting again after a client validation error", async () => {
    const { issue, save } = spies("create");
    const { form, button } = await openForm("create");
    fireEvent.change(textbox(form, "어플리케이션 이름"), {
      target: { value: "" },
    });
    await user.click(button);
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(issue).not.toHaveBeenCalled();
    await user.type(textbox(form, "어플리케이션 이름"), "고친 이름");
    await user.click(button);
    await expectOpened("create", save);
    expect(issue).toHaveBeenCalledTimes(1);
  });

  it.each(["issue", "save"])(
    "allows an explicit retry with a fresh key after a confirmed %s failure",
    async (stage) => {
      const { issue, save } = spies("create");
      const stub = stage === "issue" ? issue : save;
      stub.mockRejectedValueOnce(confirmed());
      const { form, button } = await openForm("create");
      await user.click(button);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "표시된 항목을 확인해 주세요.",
      );
      expect(issue).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(form.getByRole("button", { name: "아카이브에 등록" }));
      await waitFor(() =>
        expect(router.state.location.pathname).not.toBe("/apps/new"),
      );
      expect(issue).toHaveBeenCalledTimes(2);
      expect(save).toHaveBeenCalledTimes(stage === "issue" ? 1 : 2);
    },
  );
});
