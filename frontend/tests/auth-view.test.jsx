import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AuthView } from "../src/features/auth/view-auth";

describe("API-mode auth availability", () => {
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
