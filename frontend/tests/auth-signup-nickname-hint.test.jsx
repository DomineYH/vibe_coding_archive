import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthView } from "../src/features/auth/view-auth";
import { ServiceError } from "../src/services/service-error";

const hint = "2~20자";
const errorMessage = "별명은 제어문자 없이 보이는 문자로 2~20자 입력해 주세요.";

function renderSignup(props = {}) {
  render(
    <MemoryRouter>
      <AuthView mode="signup" authStatus="ready" authUser={null} {...props} />
    </MemoryRouter>,
  );
  return screen.getByLabelText("별명 (필수)");
}

describe("signup nickname length hint", () => {
  it("shows the hint and describes the empty nickname input with it", () => {
    const input = renderSignup();

    expect(screen.getByText(hint)).toBeVisible();
    expect(screen.getByText(hint)).toHaveAttribute("id", "nickname-hint");
    expect(input).toHaveAttribute("aria-describedby", "nickname-hint");
    expect(input).toHaveAccessibleDescription(hint);
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the hint while a valid nickname is typed", async () => {
    const user = userEvent.setup();
    const input = renderSignup();
    await user.type(input, "코딩선생");

    expect(screen.getByText(hint)).toBeVisible();
    expect(input).toHaveAccessibleDescription(hint);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(errorMessage)).not.toBeInTheDocument();
  });

  it("describes the nickname input with both hint and server field error", async () => {
    const user = userEvent.setup();
    const password = "synthetic password phrase";
    const input = renderSignup({
      onRegister: vi.fn().mockRejectedValue(
        new ServiceError("VALIDATION_ERROR", "입력값을 확인해 주세요.", {
          httpStatus: 422,
          outcome: "rejected",
          fields: { nickname: errorMessage },
        }),
      ),
    });
    await user.type(screen.getByLabelText("로그인 아이디 (필수)"), "teacher");
    await user.type(screen.getByLabelText("비밀번호 (필수)"), password);
    await user.type(screen.getByLabelText("비밀번호 확인 (필수)"), password);
    await user.type(input, "교\u200b사");
    await user.click(screen.getByRole("button", { name: "가입 신청하기" }));

    expect(await screen.findByText(errorMessage)).toHaveAttribute(
      "id",
      "nickname-error",
    );
    expect(screen.getByText(hint)).toBeVisible();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute(
      "aria-describedby",
      "nickname-hint nickname-error",
    );
    expect(input).toHaveAccessibleDescription(`${hint} ${errorMessage}`);
  });
});
