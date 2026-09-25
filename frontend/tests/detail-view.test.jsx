import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AppDetailView } from "../src/features/detail/view-detail";
import { ServiceError } from "../src/services/service-error";

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
