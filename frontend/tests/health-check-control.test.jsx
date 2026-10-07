import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it } from "vitest";
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
