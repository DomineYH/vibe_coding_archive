import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  getRoles,
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
const key = "00000000-0000-4000-8000-000000000151";
const operation = {
  key,
  kind: "app_create",
  state: "unresolved",
  targetId: null,
};
const textFields = [
  ["name", "어플리케이션 이름", "내 수업 도구"],
  ["url", "배포 URL", "https://example.org/class"],
  ["prompt", "핵심 프롬프트", "수업 도구를 만들어줘."],
  ["description", "상세 설명", "함께 풀이하는 도구입니다."],
  ["stack.db", "DB", "Postgres"],
  ["stack.backend", "백엔드 엔진", "Python"],
  ["stack.frontend", "프론트엔드 프레임워크", "React"],
  ["stack.hosting", "호스팅 서비스", "Vercel"],
];
const fields = {
  name: "이름 서버 안내",
  url: "URL 서버 안내",
  prompt: "프롬프트 서버 안내",
  description: "설명 서버 안내",
  subject: "과목 서버 안내",
  grades: "학년 서버 안내",
  "stack.db": "DB 서버 안내",
  "stack.backend": "백엔드 서버 안내",
  "stack.frontend": "프론트엔드 서버 안내",
  "stack.hosting": "호스팅 서버 안내",
  themeId: "테마 서버 안내",
  isPublic: "공개 서버 안내",
  form: "전체 양식 서버 안내",
  future_field: "알 수 없는 필드 안내",
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

function getTextbox(form, label) {
  const fieldLabel = form.getByText(label, { selector: "label", exact: true });
  const control = fieldLabel.control;
  expect(fieldLabel.closest("form")).toContainElement(control);
  return within(control.parentElement).getByRole("textbox", {
    name: label,
    exact: true,
  });
}

function getButton(queries, name) {
  const button = queries.getByText(name, { selector: "button", exact: true });
  expect(getRoles(button).button).toContain(button);
  expect(button).toHaveAccessibleName(name);
  expect(button).toBeInTheDocument();
  return button;
}

function getThemeButton(form, name) {
  return within(
    form.getByRole("group", { name: "Pantone 테마 컬러" }),
  ).getByRole("button", { name: `테마 ${name} 선택`, exact: true });
}

async function fillDraft(useUserInput = false) {
  await authService.login(DEMO_ACCOUNTS[1]);
  router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: ["/apps/new"],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const form = within(
    await screen.findByRole("form", { name: "새 앱 등록 양식" }),
  );
  for (const [, label, value] of textFields) {
    if (useUserInput) {
      await user.click(getTextbox(form, label));
      await user.paste(value);
    } else fireEvent.change(getTextbox(form, label), { target: { value } });
  }
  await user.click(
    getButton(within(form.getByRole("group", { name: "교과 과목" })), "수학"),
  );
  await user.click(
    getButton(
      within(form.getByRole("group", { name: "적용 가능 학년" })),
      "초3",
    ),
  );
  await user.click(getThemeButton(form, "Sage"));
  await user.click(form.getByRole("switch", { name: "전체 공개" }));
  return form;
}

function expectDraft(form) {
  for (const [, label, value] of textFields) {
    expect(getTextbox(form, label)).toHaveValue(value);
  }
  expect(
    getButton(within(form.getByRole("group", { name: "교과 과목" })), "수학"),
  ).toHaveAttribute("aria-pressed", "true");
  expect(
    getButton(
      within(form.getByRole("group", { name: "적용 가능 학년" })),
      "초3",
    ),
  ).toHaveAttribute("aria-pressed", "true");
  expect(getThemeButton(form, "Sage")).toHaveAttribute("aria-pressed", "true");
  expect(form.getByRole("switch", { name: "전체 공개" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
}

const editAppId = "00000000-0000-4000-8000-000000000001";

async function fillEditDraft() {
  await authService.login(DEMO_ACCOUNTS[1]);
  router = createMemoryRouter([{ path: "*", element: <App /> }], {
    initialEntries: [`/apps/${editAppId}/edit`],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const form = within(
    await screen.findByRole("form", { name: "앱 수정 양식" }),
  );
  for (const [, label, value] of textFields) {
    const control = getTextbox(form, label);
    fireEvent.change(control, { target: { value } });
  }
  await user.click(form.getByRole("switch", { name: "전체 공개" }));
  return form;
}

function rejectStage(stage, error) {
  const issue = vi.spyOn(appsService, "issueCreateOperation");
  const create = vi.spyOn(appsService, "create");
  if (stage === "issuance") issue.mockRejectedValue(error);
  else {
    issue.mockResolvedValue(operation);
    create.mockRejectedValue(error);
  }
  return { issue, create };
}

function expectFieldError(control, message) {
  expect(control).toHaveAttribute("aria-invalid", "true");
  const id = control.getAttribute("aria-describedby");
  expect(id).toBeTruthy();
  expect(document.getElementById(id)).toBeVisible();
  expect(document.getElementById(id)).toHaveTextContent(message);
}

describe.each(["issuance", "create"])("registration %s failure", (stage) => {
  it("links all server validation messages to controls, exposes form/unknown messages, and keeps the draft", async () => {
    const { issue, create } = rejectStage(
      stage,
      new ServiceError("VALIDATION_ERROR", "서버 검증 안내", {
        httpStatus: 422,
        fields,
      }),
    );
    const form = await fillDraft(stage === "create");
    await user.click(getButton(form, "아카이브에 등록"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("표시된 항목을 확인해 주세요.");
    expect(alert).toHaveTextContent(fields.form);
    expect(alert).toHaveTextContent(fields.future_field);
    for (const [field, label] of textFields) {
      expectFieldError(getTextbox(form, label), fields[field]);
    }
    expectFieldError(
      form.getByRole("group", { name: "교과 과목" }),
      fields.subject,
    );
    expectFieldError(
      form.getByRole("group", { name: "적용 가능 학년" }),
      fields.grades,
    );
    const themes = form.getByRole("group", { name: "Pantone 테마 컬러" });
    const visibility = form.getByRole("switch", { name: "전체 공개" });
    expectFieldError(themes, fields.themeId);
    expectFieldError(visibility, fields.isPublic);
    expectDraft(form);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(stage === "issuance" ? 0 : 1);
    await user.click(getThemeButton(form, "Niagara"));
    expect(themes).toHaveAttribute("aria-invalid", "false");
    expect(themes).not.toHaveAttribute("aria-describedby");
    await user.click(visibility);
    expect(visibility).toHaveAttribute("aria-invalid", "false");
    expect(visibility).not.toHaveAttribute("aria-describedby");
    await user.type(getTextbox(form, "DB"), " updated");
    expect(getTextbox(form, "DB")).toHaveAttribute("aria-invalid", "false");
    expect(getTextbox(form, "백엔드 엔진")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(fields.future_field);
  });

  it.each([
    {
      code: "BAD_REQUEST",
      status: 400,
      copy: "등록 요청을 처리할 수 없어요. 입력 내용을 확인해 주세요. 입력 내용은 유지됩니다.",
    },
    {
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
      copy: "등록할 내용이 너무 커요. 프롬프트나 설명을 줄인 뒤 다시 시도해 주세요. 입력 내용은 유지됩니다.",
    },
    {
      code: "FEATURE_UNAVAILABLE",
      status: 503,
      copy: "현재 앱 등록 기능을 사용할 수 없어요. 입력 내용은 유지됩니다.",
    },
  ])(
    "shows $code guidance and retains the draft even with fields",
    async ({ code, status, copy }) => {
      const uncertain = stage === "create" && status === 503;
      const { issue, create } = rejectStage(
        stage,
        new ServiceError(code, "서버 원문", {
          httpStatus: status,
          outcome: uncertain ? "unknown" : "not_applicable",
          fields: { form: "추가 서버 안내" },
        }),
      );
      const lookup = vi
        .spyOn(appsService, "getCreateOperation")
        .mockResolvedValue(operation);
      const form = await fillDraft();
      await user.click(getButton(form, "아카이브에 등록"));
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(copy);
      expect(alert).toHaveTextContent("추가 서버 안내");
      expectDraft(form);
      expect(issue).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledTimes(stage === "issuance" ? 0 : 1);
      expect(lookup).not.toHaveBeenCalled();
      if (uncertain) {
        expect(alert).toHaveTextContent("저장 결과를 먼저 확인해 주세요.");
        expect(getButton(form, "결과 확인 중")).toBeDisabled();
        expect(getTextbox(form, "어플리케이션 이름")).toHaveAttribute(
          "readonly",
        );
        await user.click(getButton(form, "저장 결과 확인"));
        await waitFor(() =>
          expect(alert).toHaveTextContent("아직 저장 결과가 정해지지 않았어요"),
        );
        expect(lookup).toHaveBeenCalledWith(key);
        const [pendingInput, pendingKey] = create.mock.calls[0];
        await user.click(getButton(form, "같은 요청 다시 보내기"));
        await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
        expect(create.mock.calls[1]).toEqual([pendingInput, pendingKey]);
        expect(pendingKey).toBe(key);
        expect(issue).toHaveBeenCalledTimes(1);
        expectDraft(form);
      } else {
        expect(getButton(form, "아카이브에 등록")).toBeEnabled();
        expect(getTextbox(form, "어플리케이션 이름")).not.toHaveAttribute(
          "readonly",
        );
        expect(
          form.queryByRole("button", { name: "저장 결과 확인" }),
        ).not.toBeInTheDocument();
      }
    },
  );
});

describe.each(["issuance", "update"])("edit %s failure", (stage) => {
  it("links mapped errors to controls, retains the draft, and clears only the edited field without further service calls", async () => {
    const error = new ServiceError("VALIDATION_ERROR", "서버 검증 안내", {
      httpStatus: 422,
      fields,
    });
    const issue = vi.spyOn(appsService, "issueUpdateOperation");
    const update = vi.spyOn(appsService, "update");
    const lookup = vi.spyOn(appsService, "getUpdateOperation");
    if (stage === "issuance") issue.mockRejectedValue(error);
    else {
      issue.mockResolvedValue({
        ...operation,
        kind: "app_update",
        targetId: editAppId,
      });
      update.mockRejectedValue(error);
    }
    const form = await fillEditDraft();
    await user.click(getButton(form, "변경사항 저장"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("표시된 항목을 확인해 주세요.");
    expect(alert).toHaveTextContent(fields.form);
    expect(alert).toHaveTextContent(fields.future_field);
    const controls = [
      ...textFields.map(([field, label]) => [field, getTextbox(form, label)]),
      ["subject", form.getByRole("group", { name: "교과 과목" })],
      ["grades", form.getByRole("group", { name: "적용 가능 학년" })],
      ["themeId", form.getByRole("group", { name: "Pantone 테마 컬러" })],
      ["isPublic", form.getByRole("switch", { name: "전체 공개" })],
    ];
    for (const [field, control] of controls) {
      expectFieldError(control, fields[field]);
    }
    expectDraft(form);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(stage === "issuance" ? 0 : 1);
    expect(lookup).not.toHaveBeenCalled();

    await user.click(getThemeButton(form, "Niagara"));
    for (const [field, control] of controls) {
      if (field === "themeId") {
        expect(control).toHaveAttribute("aria-invalid", "false");
        expect(control).not.toHaveAttribute("aria-describedby");
      } else expectFieldError(control, fields[field]);
    }
    expect(screen.getByRole("alert")).toHaveTextContent(fields.form);
    expect(screen.getByRole("alert")).toHaveTextContent(fields.future_field);

    await user.type(getTextbox(form, "DB"), " updated");
    for (const [field, control] of controls) {
      if (field === "themeId" || field === "stack.db") {
        expect(control).toHaveAttribute("aria-invalid", "false");
        expect(control).not.toHaveAttribute("aria-describedby");
      } else expectFieldError(control, fields[field]);
    }
    expect(screen.getByRole("alert")).toHaveTextContent(fields.form);
    expect(screen.getByRole("alert")).toHaveTextContent(fields.future_field);
    expect(router.state.location.pathname).toBe(`/apps/${editAppId}/edit`);
    expect(issue).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(stage === "issuance" ? 0 : 1);
    expect(lookup).not.toHaveBeenCalled();
  });
});

it("opens the confirmed app after explicitly looking up an uncertain feature-unavailable creation", async () => {
  const { issue, create } = rejectStage(
    "create",
    new ServiceError("FEATURE_UNAVAILABLE", "서버 원문", {
      httpStatus: 503,
      outcome: "unknown",
    }),
  );
  const targetId = "00000000-0000-4000-8000-000000000001";
  const lookup = vi
    .spyOn(appsService, "getCreateOperation")
    .mockResolvedValue({ ...operation, state: "succeeded", targetId });
  const form = await fillDraft();
  await user.click(getButton(form, "아카이브에 등록"));
  await user.click(
    await screen.findByRole("button", { name: "저장 결과 확인" }),
  );
  await waitFor(() =>
    expect(router.state.location.pathname).toBe(`/apps/${targetId}`),
  );
  expect(lookup).toHaveBeenCalledWith(key);
  expect(issue).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(1);
});
