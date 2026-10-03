import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AdminView } from "../src/features/admin/view-admin";
import { authService } from "../src/services/mock/auth";
import { resetMockState, setMockScenario } from "../src/services/mock/state";

let client;
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  await authService.login({ loginId: "admin", password: "admin123" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  client.clear();
  localStorage.clear();
});

it.each(["original", "admin_write_unknown"])(
  "shows applied approval and revocation results with mock scenario %s",
  async (scenario) => {
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin"]}>
          <AdminView scopeKey="approval-regression" />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const row = (await screen.findByText("비기너개발자")).closest(
      '[role="listitem"]',
    );
    setMockScenario(scenario);

    for (const [action, value, version, guidance] of [
      ["승인하기", "승인", 2, "승인 후 회원은 로그인할 수 있습니다"],
      ["승인 해제", "미승인", 3, "승인을 해제하면"],
    ]) {
      await user.click(
        within(row).getByRole("button", { name: action, exact: true }),
      );
      const panel = await screen.findByRole("region", {
        name: /회원 승인 확인/,
      });
      expect(panel).toHaveTextContent(
        `승인 값: ${value}·대상 버전: ${version - 1}`,
      );
      expect(panel).toHaveTextContent(guidance);
      await user.click(
        within(panel).getByRole("button", {
          name: `${action} 확인`,
          exact: true,
        }),
      );
      if (scenario === "admin_write_unknown") {
        await waitFor(() =>
          expect(within(panel).getByRole("status")).toHaveTextContent(
            "처리 결과가 아직 확정되지 않았어요",
          ),
        );
        expect(panel).toHaveTextContent(
          `승인 값: ${value}·대상 버전: ${version - 1}`,
        );
        expect(panel).toHaveTextContent(guidance);
        await user.click(
          within(panel).getByRole("button", { name: "결과 확인", exact: true }),
        );
      }
      await waitFor(() =>
        expect(within(panel).getByRole("status")).toHaveTextContent(
          "요청한 승인 상태가 확정됐어요",
        ),
      );
      await waitFor(() => expect(row).toHaveTextContent(`버전 ${version}`));
      expect(panel).toHaveTextContent(
        `승인 값: ${value}·반영 버전: ${version}`,
      );
      expect(panel).not.toHaveTextContent("승인을 해제하면");
      expect(panel).not.toHaveTextContent(
        "승인 후 회원은 로그인할 수 있습니다",
      );
      await user.click(
        within(panel).getByRole("button", { name: "닫기", exact: true }),
      );
      expect(
        screen.queryByRole("region", { name: /회원 승인 확인/ }),
      ).not.toBeInTheDocument();
    }
  },
);
