import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthView } from "../src/features/auth/view-auth";
import { ServiceError } from "../src/services/service-error";

describe("API-mode auth availability", () => {
  it("keeps signup contact guidance without mock-only advice", () => {
    vi.stubGlobal("__DATA_MODE__", "api");
    try {
      const { container } = render(
        <MemoryRouter>
          <AuthView mode="signup" authStatus="ready" authUser={null} />
        </MemoryRouter>,
      );
      expect(
        screen.queryByText(/개발용|mock|가짜 비밀번호/),
      ).not.toBeInTheDocument();
      expect(container.querySelector("#contact-hint")).toHaveTextContent(
        "이메일·연락처는 선택이며 공개 화면에 표시되지 않습니다. 실제 수집 기능은 비활성화되어 있습니다.",
      );
      for (const selector of ["#email", "#phone"]) {
        expect(container.querySelector(selector)).toHaveAttribute(
          "aria-describedby",
          "contact-hint",
        );
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains that authentication is unavailable without showing a form", () => {
    render(
      <MemoryRouter>
        <AuthView mode="login" authStatus="unavailable" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "인증 기능은 아직 준비 중이에요",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("login failure messages", () => {
  async function submitWith(error) {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AuthView
          mode="login"
          authStatus="ready"
          authUser={null}
          onLogin={() => Promise.reject(error)}
        />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText("로그인 아이디"), "member-a");
    await user.type(screen.getByLabelText("비밀번호"), "synthetic password");
    await user.click(screen.getByRole("button", { name: "로그인" }));
  }

  it.each([
    [
      new ServiceError("RATE_LIMITED", "x", {
        retryAt: "2026-10-01T00:15:00Z",
      }),
      /로그인 시도가 너무 많아요\. 9시 15분 이후에 다시 시도해 주세요\./,
    ],
    [
      new ServiceError("RATE_LIMITED", "x"),
      /로그인 시도가 너무 많아요\. 잠시 뒤에 다시 시도해 주세요\./,
    ],
    [
      new ServiceError("AUTH_STATE_CHANGED", "x"),
      /계정 상태가 바뀌었어요\. 다시 로그인해 주세요\./,
    ],
    [new ServiceError("AUTH_BUSY", "x"), /서버가 바빠요/],
    [new ServiceError("DB_BUSY", "x"), /서버가 바빠요/],
    [new ServiceError("NETWORK_ERROR", "x"), /로그인하지 못했어요/],
    [
      new ServiceError("FORBIDDEN", "관리자 권한이 필요해요."),
      /관리자 권한이 필요해요/,
    ],
    [
      new ServiceError("FORBIDDEN", "이 작업을 수행할 권한이 없어요."),
      "이 작업을 수행할 권한이 없어요.",
    ],
  ])("tells %s apart from a credential error", async (error, expected) => {
    await submitWith(error);
    expect(await screen.findByText(expected)).toBeInTheDocument();
  });
});

it("announces initial pending retention before a registration request", () => {
  render(
    <MemoryRouter>
      <AuthView mode="signup" authStatus="ready" authUser={null} />
    </MemoryRouter>,
  );
  expect(
    screen.getByText(/최초 승인 없이 가입일부터 90일이 지나면/),
  ).toHaveTextContent("자동 삭제");
});

it("announces the registration retry time from the server rolling limit", async () => {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <AuthView
        mode="signup"
        authStatus="ready"
        authUser={null}
        onRegister={() =>
          Promise.reject(
            new ServiceError("RATE_LIMITED", "x", {
              retryAt: "2026-10-01T00:15:00Z",
            }),
          )
        }
      />
    </MemoryRouter>,
  );
  await user.type(screen.getByLabelText("로그인 아이디 (필수)"), "teacher");
  await user.type(
    screen.getByLabelText("비밀번호 (필수)"),
    "synthetic password",
  );
  await user.type(
    screen.getByLabelText("비밀번호 확인 (필수)"),
    "synthetic password",
  );
  await user.type(screen.getByLabelText("별명 (필수)"), "교사");
  await user.click(screen.getByRole("button", { name: "가입 신청하기" }));
  expect(
    await screen.findByText(
      "가입 시도가 너무 많아요. 9시 15분 이후에 다시 시도해 주세요.",
    ),
  ).toBeInTheDocument();
});
