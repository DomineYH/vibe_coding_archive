import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HealthCheckControl } from "../src/features/admin/health-check-control";
import { authService } from "../src/services/mock/auth";
import { healthService } from "../src/services/mock/health";
import { resetMockState, setMockScenario } from "../src/services/mock/state";

let client;
const app = { id: "00000000-0000-4000-8000-000000000001", urlVersion: 1 };
beforeEach(async () => {
  localStorage.clear();
  resetMockState();
  await authService.login({ loginId: "admin", password: "admin123" });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  client.clear();
  localStorage.clear();
});
function mount(canRequest) {
  return render(
    <QueryClientProvider client={client}>
      <HealthCheckControl app={app} canRequest={canRequest} scopeKey="admin" />
    </QueryClientProvider>,
  );
}
it("disables admission when the health capability is unavailable", async () => {
  mount(false);
  expect(screen.getByRole("button", { name: "즉시 재검사" })).toBeDisabled();
  expect(
    (await healthService.getAppHealth(app.id)).health.latestJob,
  ).toBeNull();
});
it("runs a row check and reports its completed job inline", async () => {
  setMockScenario("health_result_healthy");
  mount(true);
  await userEvent.click(screen.getByRole("button", { name: "즉시 재검사" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("검사 완료"),
  );
  expect((await healthService.getAppHealth(app.id)).health.result.state).toBe(
    "healthy",
  );
  expect(screen.getByRole("button", { name: "즉시 재검사" })).toBeEnabled();
});

it.each([
  ["blocked", "DESTINATION_BLOCKED"],
  ["network_error", "DNS_FAILURE"],
])(
  "completes and reuses an administrator %s result and invalidates monitor rows",
  async (state, kind) => {
    setMockScenario(`health_result_${state}`);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = mount(true);
    await userEvent.click(screen.getByRole("button", { name: "즉시 재검사" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("검사 완료"),
    );
    expect(
      (await healthService.getAppHealth(app.id)).health.result,
    ).toMatchObject({ state, error_kind: kind, error_stage: "dns" });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: [__DATA_MODE__, "admin", "apps", "admin"],
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "진행 다시 조회" }),
    ).not.toBeInTheDocument();
    view.unmount();
    invalidate.mockClear();
    const request = vi.spyOn(healthService, "requestCheck");
    mount(true);
    await userEvent.click(screen.getByRole("button", { name: "즉시 재검사" }));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: [__DATA_MODE__, "admin", "apps", "admin"],
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("검사 완료");
    expect((await request.mock.results[0].value).disposition).toBe(
      "result_reused",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "진행 다시 조회" }),
    ).not.toBeInTheDocument();
  },
);
