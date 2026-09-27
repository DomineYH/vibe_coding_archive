import { expect, test } from "@playwright/test";

const appId = "00000000-0000-4000-8000-000000000001";

function healthPanel(page) {
  return page.locator("aside section").filter({
    has: page.getByRole("heading", { name: "연결 상태", exact: true }),
  });
}

async function openScenario(page, scenario, { mockTime } = {}) {
  await page.goto("/__dev/mock-reset");
  await expect(
    page.getByRole("heading", { name: "mock 저장 관리", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "갤러리 시나리오", exact: true })
    .selectOption(scenario);
  if (mockTime) {
    const clock = page.getByLabel("개발용 mock 시각", { exact: true });
    await expect(clock).toBeVisible();
    await clock.fill(mockTime);
    await page.getByRole("button", { name: "시각 저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText(
      "mock 시각을 저장했어요",
    );
  }
  await page.goto(`/apps/${appId}`);
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게", exact: true }),
  ).toBeVisible();
  const panel = healthPanel(page);
  await expect(
    panel.getByRole("heading", { name: "연결 상태", exact: true }),
  ).toBeVisible();
  return panel;
}

async function resetMock(page) {
  await page.goto("/__dev/mock-reset");
  await expect(
    page.getByRole("heading", { name: "mock 저장 관리", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "기본 fixture로 명시적 초기화", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
}

async function loginAdmin(page) {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "로그인 아이디", exact: true })
    .fill("admin");
  await form.getByLabel("비밀번호", { exact: true }).fill("admin123");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

test("runs each synthetic result and labels its state", async ({ page }) => {
  const cases = [
    ["health_result_healthy", "정상"],
    ["health_result_http_error", "HTTP 오류"],
    ["health_result_timeout", "응답 시간 초과"],
    ["health_result_network_error", "네트워크 오류"],
    ["health_result_blocked", "검사 제한"],
    ["health_result_redirect_error", "리다이렉트 오류"],
  ];

  for (const [index, [scenario, label]] of cases.entries()) {
    if (index > 0) await resetMock(page);
    const panel = await openScenario(page, scenario);
    await panel
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    await expect(
      panel.locator("dl").first().getByRole("definition").first(),
    ).toHaveText(label);
    await expect(
      panel.getByRole("status").filter({ hasText: "검사 작업이 완료됐어요" }),
    ).toBeVisible();
    await expect(panel).toContainText(
      "합성 시연 결과입니다. 외부 사이트로 요청을 보내지 않았습니다.",
    );
  }
});

test("preserves the last result on job failure and requires explicit progress retry", async ({
  page,
}) => {
  for (const [index, [scenario, message]] of [
    ["health_job_failed", "검사 작업에 실패했어요"],
    ["health_job_cancelled", "검사 작업이 취소됐어요"],
  ].entries()) {
    if (index > 0) await resetMock(page);
    const panel = await openScenario(page, scenario);
    await panel
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(message);
    await expect(
      panel.locator("dl").first().getByRole("definition").first(),
    ).toHaveText("정상");
  }

  await resetMock(page);
  const panel = await openScenario(page, "health_job_query_failure");
  await panel
    .getByRole("button", { name: "연결 다시 확인", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "자동 조회를 멈췄습니다",
  );
  const retry = panel.getByRole("button", {
    name: "진행 다시 조회",
    exact: true,
  });
  await expect(retry).toBeVisible();
  await retry.click();
  await expect(panel.getByRole("alert")).toContainText(
    "자동 조회를 멈췄습니다",
  );
});

test("shows queued and running work as separate active job states", async ({
  page,
}) => {
  for (const [index, [scenario, status]] of [
    ["health_job_queued", "검사 작업 대기 중"],
    ["health_job_running", "연결 검사 진행 중"],
  ].entries()) {
    if (index > 0) await resetMock(page);
    const panel = await openScenario(page, scenario);
    await panel
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    await expect(
      panel.getByRole("status").filter({ hasText: status }),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "검사 진행 중", exact: true }),
    ).toBeDisabled();
  }
});

test("shows HTTP measurements only to a current administrator", async ({
  page,
}) => {
  await loginAdmin(page);
  await page.goto(`/apps/${appId}`);
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게", exact: true }),
  ).toBeVisible();
  const panel = healthPanel(page);
  await panel
    .getByRole("button", { name: "연결 다시 확인", exact: true })
    .click();
  await expect(
    panel.getByRole("status").filter({ hasText: "검사 작업이 완료됐어요" }),
  ).toBeVisible();
  const measurements = panel.locator("dl").nth(1).getByRole("definition");
  await expect(measurements.nth(0)).toHaveText("204");
  await expect(measurements.nth(1)).toHaveText("26 ms");
});

test("marks the exact freshness boundary stale and rejects stale cooldown reuse", async ({
  page,
}) => {
  const panel = await openScenario(page, "health_app_cooldown", {
    mockTime: "2026-09-22T09:27",
  });
  await expect(
    panel.getByLabel("연결 결과: 이전 정상", { exact: true }),
  ).toBeVisible();
  await expect(panel).toContainText("오래된 결과");
  await panel
    .getByRole("button", { name: "연결 다시 확인", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("재검사 대기 중");
});
