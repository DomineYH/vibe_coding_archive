import { expect, test } from "@playwright/test";

const privateApp = "/apps/00000000-0000-4000-8000-000000000091";

async function startLoginWithScenario(page, scenario) {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await page.evaluate((nextScenario) => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: nextScenario }),
    );
  }, scenario);
  await form.getByLabel("로그인 아이디", { exact: true }).fill("교사김코딩");
  await form.getByLabel("비밀번호", { exact: true }).fill("1234");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "인증 결과를 확인할 수 없어요",
  );
}

test("a lost login response stays public-only until its result is settled", async ({
  page,
}) => {
  await startLoginWithScenario(page, "auth_response_lost");
  await page.goto(privateApp);
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );

  await page.goto("/auth?mode=login");
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "인증 결과를 확인할 수 없어요",
  );
  const recovery = page.getByRole("main");
  const checkResult = recovery.getByRole("button", {
    name: "결과 확인",
    exact: true,
  });
  await checkResult.focus();
  await expect(checkResult).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("banner").getByRole("button", { name: "로그아웃" }),
  ).toBeVisible();

  await page.goto(privateApp);
  await expect(
    page.getByRole("heading", {
      name: "과학 수행평가 루브릭 채점기",
      exact: true,
    }),
  ).toBeVisible();
});

test("a second tab can settle a gated transition before its first tab resumes", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const firstForm = page.locator('[data-screen-label="로그인"] form');
  await expect(firstForm).toBeVisible();
  const secondTab = await page.context().newPage();
  await secondTab.goto("/auth?mode=login");
  await expect(
    secondTab.locator('[data-screen-label="로그인"] form'),
  ).toBeVisible();
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_transition_gate" }),
    );
  });

  await firstForm
    .getByLabel("로그인 아이디", { exact: true })
    .fill("교사김코딩");
  await firstForm.getByLabel("비밀번호", { exact: true }).fill("1234");
  await firstForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(secondTab.getByRole("main").getByRole("status")).toContainText(
    "인증 결과를 확인할 수 없어요",
  );

  await secondTab
    .getByRole("main")
    .getByRole("button", { name: "결과 확인", exact: true })
    .click();
  await expect(page.locator('[data-screen-label="로그인"] form')).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("a missing session cookie can be discarded only by its exact transition", async ({
  page,
}) => {
  await startLoginWithScenario(page, "auth_session_cookie_lost");
  const recovery = page.getByRole("main");
  const discard = recovery.getByRole("button", {
    name: "받지 못한 세션 버리기",
    exact: true,
  });
  await expect(discard).toBeVisible();
  await discard.click();

  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("discarding a missing password-change session preserves the password change", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(loginForm).toBeVisible();
  await loginForm.locator("#login-id").fill("임시교사38");
  await loginForm.locator("#login-password").fill("Temporary Demo Password 38");
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();

  await expect(page).toHaveURL(/mode=password-change/);
  const passwordForm = page.locator('[data-screen-label="비밀번호 변경"] form');
  await expect(passwordForm).toBeVisible();
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_session_cookie_lost" }),
    );
  });
  const password = "Password changed before cookie loss 38";
  await passwordForm.locator("#new-password").fill(password);
  await passwordForm.locator("#new-password-confirm").fill(password);
  await passwordForm
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "인증 결과를 확인할 수 없어요",
  );

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "original" }),
    );
  });
  await page
    .getByRole("main")
    .getByRole("button", {
      name: "받지 못한 세션 버리기",
      exact: true,
    })
    .click();
  await page.goto("/auth?mode=login");
  const updatedLoginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(updatedLoginForm).toBeVisible();
  await updatedLoginForm.locator("#login-id").fill("임시교사38");
  await updatedLoginForm.locator("#login-password").fill(password);
  await updatedLoginForm
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(
    page.getByRole("banner").getByRole("button", { name: "로그아웃" }),
  ).toBeVisible();
});

test("an unavailable result stays unresolved until explicit flow reset", async ({
  page,
}) => {
  await startLoginWithScenario(page, "auth_result_unavailable");
  const recovery = page.getByRole("main");
  await recovery
    .getByRole("button", { name: "결과 확인", exact: true })
    .click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "인증 결과를 확인할 수 없어요",
  );
  await expect(page.locator('[data-screen-label="로그인"] form')).toHaveCount(
    0,
  );

  await page
    .getByRole("main")
    .getByRole("button", {
      name: "인증 흐름 초기화",
      exact: true,
    })
    .click();
  await expect(page.locator('[data-screen-label="로그인"] form')).toBeVisible();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }).last(),
  ).toBeVisible();
});
