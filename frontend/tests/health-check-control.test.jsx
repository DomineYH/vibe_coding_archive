import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HealthCheckControl } from "../src/features/admin/health-check-control";
import { authService } from "../src/services/mock/auth";
import { healthService } from "../src/services/mock/health";
import { resetMockState, setMockScenario } from "../src/services/mock/state";

const operationalNote =
  "연결 검사 운영 준비가 확인되지 않아 새 검사를 접수할 수 없어요. 기존 연결 결과는 확인할 수 있어요.";

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
  const tree = (allowed, descriptionId = "health-row-check-note") => (
    <QueryClientProvider client={client}>
      <p id={descriptionId}>
        {descriptionId === "health-operational-note"
          ? operationalNote
          : "검사 접수 후 이 행에서 진행 상태를 확인합니다."}
      </p>
      <HealthCheckControl
        app={app}
        canRequest={allowed}
        scopeKey="admin"
        descriptionId={descriptionId}
      />
    </QueryClientProvider>
  );
  return { ...render(tree(canRequest)), tree };
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

it.each(["health_job_queued", "health_job_running"])(
  "does not label an enabled %s job as an operational restriction",
  async (scenario) => {
    setMockScenario(scenario);
    mount(true);
    await userEvent.click(screen.getByRole("button", { name: "즉시 재검사" }));
    await screen.findByRole("status");
    expect(screen.getByRole("button", { name: "즉시 재검사" })).toBeDisabled();
    expect(screen.queryByText(operationalNote)).not.toBeInTheDocument();
  },
);

it("keeps job read recovery available when capability admission becomes restricted", async () => {
  setMockScenario("health_job_query_failure");
  const request = vi.spyOn(healthService, "requestCheck");
  const view = mount(true);
  await userEvent.click(screen.getByRole("button", { name: "즉시 재검사" }));
  await screen.findByRole("button", { name: "진행 다시 조회" });
  view.rerender(view.tree(false, "health-operational-note"));
  const button = screen.getByRole("button", { name: "즉시 재검사" });
  expect(button).toBeDisabled();
  expect(button).toHaveAccessibleDescription(operationalNote);
  await userEvent.click(button);
  setMockScenario("health_result_healthy");
  await userEvent.click(screen.getByRole("button", { name: "진행 다시 조회" }));
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("검사 완료"),
  );
  expect(request).toHaveBeenCalledTimes(1);
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
