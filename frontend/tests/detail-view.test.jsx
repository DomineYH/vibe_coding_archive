import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDetailView } from "../src/features/detail/view-detail";
import { ServiceError } from "../src/services/service-error";

const clipboardDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);
const execCommandDescriptor = Object.getOwnPropertyDescriptor(
  document,
  "execCommand",
);

const app = {
  id: "00000000-0000-4000-8000-000000000001",
  owner: "작성자 별명",
  name: "분수 피자 가게",
  subject: "수학",
  grades: ["초3"],
  isPublic: true,
  themeId: "sage",
  health: {
    result: { state: "unchecked", checked_at: null, fresh_until: null },
    latestJob: null,
    nextCheckAt: null,
  },
  url: "https://example.test/app",
  prompt: "첫째 줄\n  둘째 줄",
  description: "설명",
  stack: { db: null, backend: null, frontend: "React", hosting: null },
  createdAt: "2026-09-22T00:12:00.000Z",
  updatedAt: "2026-09-22T00:12:00.000Z",
  serverTime: "2026-09-22T00:12:00.000Z",
};
const meta = {
  themes: [
    {
      id: "sage",
      name: "Sage",
      pantone: "15-6414",
      from: "#A2B187",
      to: "#D0D8B8",
      ink: "dark",
    },
  ],
};

afterEach(() => {
  if (clipboardDescriptor)
    Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
  else Reflect.deleteProperty(navigator, "clipboard");
  if (execCommandDescriptor)
    Object.defineProperty(document, "execCommand", execCommandDescriptor);
  else Reflect.deleteProperty(document, "execCommand");
  vi.restoreAllMocks();
});

function renderDetail(appData = app) {
  return render(
    <MemoryRouter>
      <AppDetailView app={appData} meta={meta} />
    </MemoryRouter>,
  );
}

describe("detail edit link label", () => {
  it.each([true, false])(
    "includes the visible label in the accessible name (public: %s)",
    (isPublic) => {
      render(
        <MemoryRouter>
          <AppDetailView app={{ ...app, isPublic }} meta={meta} canEdit />
        </MemoryRouter>,
      );
      const link = screen.getByRole("link", { name: "앱 편집", exact: true });
      expect(link).toHaveTextContent("편집");
      expect(link).toHaveAccessibleName(new RegExp(link.textContent.trim()));
      expect(link).toHaveAttribute("href", `/apps/${app.id}/edit`);
    },
  );
});

describe("public detail pending state", () => {
  it("moves detail-route focus to the stable main region while loading", () => {
    render(<AppDetailView loading retry={() => {}} />);

    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "아카이브 앱을 불러오는 중이에요",
    );
  });

  it("moves retry focus to the detail region while the retry is pending", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const { rerender } = render(
      <AppDetailView
        error={new ServiceError("SERVICE_UNAVAILABLE", "상세 오류")}
        retry={retry}
      />,
    );
    const retryButton = screen.getByRole("button", { name: "다시 시도" });
    retryButton.focus();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledOnce();

    rerender(<AppDetailView loading retry={retry} />);
    expect(screen.getByRole("main")).toHaveFocus();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("prompt copying", () => {
  it("announces a confirmed Clipboard API copy", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    renderDetail();

    await user.click(screen.getByRole("button", { name: "복사하기" }));

    expect(writeText).toHaveBeenCalledWith(app.prompt);
    expect(screen.getByRole("button", { name: "복사됨" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("복사됨");
  });

  it("falls back when Clipboard API rejects and announces only a confirmed copy", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("permission denied"));
    const execCommand = vi.fn(() => true);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    renderDetail();

    await user.click(screen.getByRole("button", { name: "복사하기" }));

    await waitFor(() => expect(execCommand).toHaveBeenCalledWith("copy"));
    expect(writeText).toHaveBeenCalledWith(app.prompt);
    expect(screen.getByRole("button", { name: "복사됨" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("복사됨");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });

  it("explains a failed fallback and restores the prior input selection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: vi.fn(() => false),
    });
    const input = document.createElement("input");
    input.value = "restore this selection";
    document.body.append(input);
    input.focus();
    input.setSelectionRange(3, 9);
    renderDetail();

    fireEvent.click(screen.getByRole("button", { name: "복사하기" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "복사하지 못했어요. 프롬프트를 선택해 직접 복사해 주세요.",
    );
    expect(
      screen.getByRole("button", { name: "복사하기" }),
    ).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([3, 9]);
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
    input.remove();
  });

  it("does not run a late fallback after navigating to another detail", async () => {
    const user = userEvent.setup();
    let rejectClipboard;
    const execCommand = vi.fn(() => true);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () =>
          new Promise((_, reject) => {
            rejectClipboard = reject;
          }),
      },
    });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: execCommand,
    });
    const view = renderDetail();
    await user.click(screen.getByRole("button", { name: "복사하기" }));
    const nextApp = {
      ...app,
      id: "00000000-0000-4000-8000-000000000002",
      name: "다른 상세",
      prompt: "다른 프롬프트",
    };

    view.rerender(
      <MemoryRouter>
        <AppDetailView app={nextApp} meta={meta} />
      </MemoryRouter>,
    );
    await act(async () => rejectClipboard(new Error("late failure")));

    expect(execCommand).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "복사하기" }),
    ).toBeInTheDocument();
  });
});

it("keeps deletion confirmation recovery available without a deleted app body", async () => {
  const check = vi.fn();
  render(
    <AppDetailView
      app={null}
      meta={meta}
      error={new ServiceError("NOT_FOUND", "없는 앱")}
      deleteState={{
        id: app.id,
        phase: "confirming",
        dbApplied: true,
        message: "앱 삭제가 반영되었어요.",
        operation: { key: app.id },
      }}
      onCheckDeleteResult={check}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "삭제 결과 확인" }),
  );
  expect(check).toHaveBeenCalledOnce();
  expect(screen.queryByText(app.prompt)).not.toBeInTheDocument();
});

it("hides deletion retry without an app or operation key", async () => {
  const retry = vi.fn();
  render(
    <AppDetailView
      app={null}
      meta={meta}
      deleteState={{
        id: app.id,
        phase: "rejected",
        rejectionCode: "NOT_FOUND",
        message: "아카이브 앱을 찾을 수 없어요.",
        operation: null,
      }}
      onDelete={retry}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "아카이브 앱을 찾을 수 없어요.",
  );
  expect(
    screen.queryByRole("button", { name: "다시 시도", exact: true }),
  ).not.toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
});
