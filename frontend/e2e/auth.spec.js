import { expect, test } from "@playwright/test";

const memberApp = "/apps/00000000-0000-4000-8000-000000000091";

async function login(page, loginId = "교사김코딩", password = "1234") {
  const form = page.locator("form");
  await expect(form).toBeVisible();
  const loginIdInput = form.getByLabel("로그인 아이디", { exact: true });
  const passwordInput = form.getByLabel("비밀번호", { exact: true });
  await expect(loginIdInput).toBeVisible();
  await expect(passwordInput).toBeVisible();
  await loginIdInput.fill(loginId);
  await passwordInput.fill(password);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
}

async function fillRegistration(
  page,
  {
    loginId = "new-teacher-1",
    password = "correct horse battery staple",
    passwordConfirm = password,
    nickname = "새 교사",
    email = "",
    phone = "",
  } = {},
) {
  const form = page.locator("form");
  await expect(form).toBeVisible();
  await form.getByLabel(/^로그인 아이디/).fill(loginId);
  await form.getByLabel(/^비밀번호 \(필수\)$/).fill(password);
  await form.getByLabel(/^비밀번호 확인/).fill(passwordConfirm);
  await form.getByLabel(/^별명/).fill(nickname);
  await form.getByLabel(/^이메일/).fill(email);
  await form.getByLabel(/^연락처/).fill(phone);
}

test("an approved member stays signed in after refresh and can log out", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  await login(page);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(
    page.getByRole("banner").getByText("교사김코딩", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeEnabled();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("private detail is hidden until auth restore, then available to its owner and admin", async ({
  page,
}) => {
  await page.goto(memberApp);
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  const privateFailure = await page.getByRole("alert").innerText();
  await page.goto("/apps/00000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  expect(await page.getByRole("alert").innerText()).toBe(privateFailure);

  await page.goto(
    `/auth?mode=login&return_to=${encodeURIComponent(memberApp)}`,
  );
  await login(page);
  await expect(page).toHaveURL(memberApp);
  await expect(
    page.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("banner").getByText("교사김코딩", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.goto("/auth?mode=login");
  await login(page, "admin", "admin123");
  await page.goto(memberApp);
  await expect(
    page.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toBeVisible();
});

test("return_to rejects external and repeatedly encoded paths", async ({
  page,
}) => {
  for (const returnTo of [
    "https://example.com",
    "%2F%2Fevil.example",
    "%252F%252Fevil.example",
    "/auth?mode=login",
  ]) {
    await page.goto(
      `/auth?mode=login&return_to=${encodeURIComponent(returnTo)}`,
    );
    await expect(page.getByRole("alert")).toContainText(
      "로그인 주소를 확인해 주세요",
    );
  }
});

test("bad credentials and communication failures do not log out or sign in", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  await login(page, "교사김코딩", "wrong");
  await expect(page.getByRole("alert")).toContainText(
    "로그인 아이디 또는 비밀번호를 확인해 주세요",
  );
  await expect(
    page.getByRole("button", { name: "로그인" }).last(),
  ).toBeEnabled();

  await page.goto("/");
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_network_error" }),
    );
  });
  await page.goto("/auth?mode=login");
  await login(page, "admin", "admin123");
  await expect(page.getByRole("alert")).toContainText(
    "로그인하지 못했어요. 연결을 확인해 주세요.",
  );
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);

  await page.goto("/");
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "original" }),
    );
  });
  await page.goto("/auth?mode=login");
  await login(page, "비기너개발자", "1234");
  await expect(page.getByRole("alert")).toContainText(
    "승인 대기 중인 계정입니다",
  );
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("login validation identifies fields and auth transition conceals the form", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(loginForm).toBeVisible();
  const submit = loginForm.getByRole("button", {
    name: "로그인",
    exact: true,
  });
  await submit.click();
  const loginId = loginForm.getByLabel("로그인 아이디", { exact: true });
  const password = loginForm.getByLabel("비밀번호", { exact: true });
  await expect(loginId).toHaveAttribute("aria-invalid", "true");
  await expect(loginId).toHaveAttribute("aria-describedby", "login-id-error");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-describedby", "password-error");
  await loginId.fill("교사김코딩");
  await password.fill("1234");

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_delayed" }),
    );
  });
  await submit.click();
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "로그인 상태를 확인하고 있어요",
  );
  await expect(loginForm).toHaveCount(0);
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("a logout communication failure keeps the session and private view", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  await login(page);
  await page.goto(memberApp);
  await expect(
    page.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toBeVisible();
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_network_error" }),
    );
  });

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "로그아웃하지 못했어요" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toBeVisible();

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "original" }),
    );
  });
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
});

test("a logout in another tab removes the old protected view", async ({
  page,
  context,
}) => {
  await page.goto("/auth?mode=login");
  await login(page);
  await page.goto(memberApp);
  const otherTab = await context.newPage();
  await otherTab.goto(memberApp);
  await expect(
    otherTab.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toBeVisible();
  await page.bringToFront();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(otherTab.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(
    otherTab.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toHaveCount(0);
});

test("a delayed private read is discarded when authentication changes", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  await login(page);
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "detail_delayed" }),
    );
  });
  await page.evaluate((path) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, memberApp);
  const main = page.getByRole("main");
  await expect(
    main.getByRole("status").filter({
      hasText: "아카이브 앱을 불러오는 중이에요",
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await page.evaluate((path) => {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, memberApp);

  await expect(main.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(
    main.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toHaveCount(0);
});

test("private detail stays hidden until a visible-tab auth check succeeds", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator("form");
  const loginId = loginForm.getByLabel("로그인 아이디", { exact: true });
  const password = loginForm.getByLabel("비밀번호", { exact: true });
  await expect(loginForm).toBeVisible();
  await expect(loginId).toBeVisible();
  await loginId.fill("교사김코딩");
  await password.fill("1234");
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL("/");
  await page.goto(memberApp);
  const privateHeading = page.getByRole("heading", {
    name: "과학 수행평가 루브릭 채점기",
    exact: true,
  });
  await expect(privateHeading).toBeVisible();
  const main = page.getByRole("main");

  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(
    main.getByRole("status").filter({
      hasText: "화면이 잠시 가려졌습니다",
    }),
  ).toBeVisible();
  await expect(privateHeading).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(privateHeading).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    main.getByRole("status").filter({
      hasText: "화면이 잠시 가려졌습니다",
    }),
  ).toBeVisible();
  await expect(privateHeading).toHaveCount(0);
  await expect(main.getByRole("link", { name: "앱 열기" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(privateHeading).toBeVisible();

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_observation_error" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  await expect(
    main.getByRole("alert").filter({
      hasText: "로그인 상태를 확인할 수 없습니다",
    }),
  ).toBeVisible();
  await expect(privateHeading).toHaveCount(0);

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "original" }),
    );
  });
  await main.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(privateHeading).toBeVisible();

  await page.goto("/apps/00000000-0000-4000-8000-000000000001");
  const publicHeading = page.getByRole("heading", {
    name: "분수 피자 가게",
    exact: true,
  });
  await expect(publicHeading).toBeVisible();
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_observation_error" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  await expect(publicHeading).toBeVisible();
});

test("direct public detail remains available when auth observation fails", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_observation_error" }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  await expect(page.getByRole("button", { name: "다시 확인" })).toBeVisible();

  await page.goto("/apps/00000000-0000-4000-8000-000000000001");
  const publicHeading = page.getByRole("heading", {
    name: "분수 피자 가게",
    exact: true,
  });
  await expect(publicHeading).toBeVisible();
  await page.reload();
  await expect(publicHeading).toBeVisible();
});

test("a private route keeps explicit recovery for damaged mock storage", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("eduvibe-archive-mock-v1", "not valid JSON");
  });
  await page.goto(memberApp);
  const main = page.getByRole("main");
  await expect(main.getByRole("alert")).toContainText(
    "로그인 상태를 확인할 수 없습니다",
  );
  await main.getByRole("link", { name: "mock 저장 초기화" }).click();
  await expect(page).toHaveURL("/__dev/mock-reset");
  await expect(
    page.getByRole("button", { name: "기본 fixture로 명시적 초기화" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "기본 fixture로 명시적 초기화" })
    .click();
  await expect(page).toHaveURL("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
});

test("an authenticated member gets 403 for the admin route while admin can open it", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL("/auth?mode=login&return_to=%2Fadmin");
  await login(page);
  await expect(page).toHaveURL("/auth?mode=login&return_to=%2Fadmin");
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");

  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.goto("/auth?mode=login&return_to=%2Fadmin");
  await login(page, "admin", "admin123");
  await page.reload();
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { name: "관리자" })).toBeVisible();
  const adminDashboard = page.getByRole("heading", {
    name: "관리자 대시보드",
    exact: true,
  });
  const adminNavigation = page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "관리자", exact: true });
  await expect(adminDashboard).toBeVisible();
  await expect(adminNavigation).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("main").getByRole("status")).toContainText(
    "화면이 잠시 가려졌습니다",
  );
  await expect(adminDashboard).toHaveCount(0);
  await expect(adminNavigation).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(adminDashboard).toBeVisible();
  await expect(adminNavigation).toBeVisible();
});

test("signup form exposes labeled required and optional fields", async ({
  page,
}) => {
  await page.goto("/auth?mode=signup");
  await expect(
    page.getByRole("heading", { name: "아카이브에 합류하기" }),
  ).toBeVisible();
  for (const label of [
    "로그인 아이디",
    /^비밀번호 \(필수\)$/,
    "비밀번호 확인",
    "별명",
    "이메일",
    "연락처",
  ])
    await expect(page.getByLabel(label)).toBeVisible();
  await expect(page.getByLabel("로그인 아이디")).toHaveAttribute(
    "aria-required",
    "true",
  );
  await expect(page.getByLabel("이메일")).not.toHaveAttribute(
    "aria-required",
    "true",
  );
  await expect(
    page.getByText("이메일·연락처는 선택이며 공개 화면에 표시되지 않습니다."),
  ).toBeVisible();
  await expect(page.locator("#contact-hint")).toHaveText(
    "이메일·연락처는 선택이며 공개 화면에 표시되지 않습니다. 개발용 mock에서는 가짜 비밀번호와 연락처만 사용해 주세요. 실제 수집 기능은 비활성화되어 있습니다.",
  );
  for (const selector of ["#email", "#phone"]) {
    await expect(page.locator(selector)).toHaveAttribute(
      "aria-describedby",
      "contact-hint",
    );
  }
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  const focusOrder = [
    "로그인 아이디",
    /^비밀번호 \(필수\)$/,
    "비밀번호 확인",
    "별명",
    "이메일",
    "연락처",
  ];
  await page.getByLabel(focusOrder[0]).focus();
  for (const label of focusOrder.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(page.getByLabel(label)).toBeFocused();
  }
});

test("signup rejects disabled contacts and resets after returning from pending state", async ({
  page,
}) => {
  await page.goto("/auth?mode=signup");
  await fillRegistration(page, {
    email: "teacher@example.invalid",
    phone: "+00 000-0000-0000",
  });
  await page.getByRole("button", { name: "가입 신청하기" }).click();
  await expect(page.locator("#email-error")).toContainText("비활성화");
  await expect(page.locator("#phone-error")).toContainText("비활성화");
  await expect(page.getByLabel("이메일")).toHaveValue(
    "teacher@example.invalid",
  );
  await expect(page.getByLabel("연락처")).toHaveValue("+00 000-0000-0000");
  await expect(
    page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
  ).toHaveCount(0);

  await page.getByLabel("이메일").fill("   ");
  await page.getByLabel("연락처").fill("");
  await page.getByRole("button", { name: "가입 신청하기" }).click();
  await expect(
    page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("수동으로 승인");
  await expect(page.getByRole("status")).toContainText("2026년 12월 21일");
  await expect(page.getByRole("status")).toContainText(
    "운영 문의 주소는 현재 설정되지 않았습니다.",
  );
  await expect(page.getByRole("button", { name: "로그인" })).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);

  await page.getByRole("link", { name: "로그인 화면으로" }).click();
  await page.getByRole("link", { name: "회원가입" }).click();
  await expect(
    page.getByRole("heading", { name: "아카이브에 합류하기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
  ).toHaveCount(0);
  for (const label of [
    "로그인 아이디",
    /^비밀번호 \(필수\)$/,
    "비밀번호 확인",
    "별명",
    "이메일",
    "연락처",
  ])
    await expect(page.getByLabel(label)).toHaveValue("");
  await page.getByRole("link", { name: "로그인", exact: true }).click();
  await login(page, "new-teacher-1", "correct horse battery staple");
  await expect(page.getByRole("alert")).toContainText(
    "승인 대기 중인 계정입니다",
  );
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  await page.reload();
  await login(page, "new-teacher-1", "correct horse battery staple");
  await expect(page.getByRole("alert")).toContainText(
    "승인 대기 중인 계정입니다",
  );
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("signup identifies confirmation and duplicate ID errors without clearing input", async ({
  page,
}) => {
  await page.goto("/auth?mode=signup");
  await fillRegistration(page, {
    loginId: "ADMIN",
    passwordConfirm: "different test password",
  });
  await page.getByRole("button", { name: "가입 신청하기" }).click();
  const confirmation = page.getByLabel("비밀번호 확인");
  await expect(confirmation).toHaveAttribute("aria-invalid", "true");
  await expect(confirmation).toHaveAttribute(
    "aria-describedby",
    "password-confirm-error",
  );
  await expect(page.locator("#password-confirm-error")).toContainText(
    "일치하지",
  );
  await expect(page.getByLabel("별명")).toHaveValue("새 교사");

  await page.getByLabel("비밀번호 확인").fill("correct horse battery staple");
  await page.getByRole("button", { name: "가입 신청하기" }).click();
  const loginId = page.getByLabel("로그인 아이디");
  await expect(loginId).toHaveAttribute("aria-invalid", "true");
  await expect(loginId).toHaveAttribute("aria-describedby", /login-id-error/);
  await expect(loginId).toHaveValue("ADMIN");
  await expect(page.getByLabel("별명")).toHaveValue("새 교사");
});

test("signup network failure preserves the form", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_network_error" }),
    );
  });
  await page.goto("/auth?mode=signup");
  await fillRegistration(page);
  await page.getByRole("button", { name: "가입 신청하기" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "가입 신청을 보내지 못했어요",
  );
  await expect(page.getByLabel("로그인 아이디")).toHaveValue("new-teacher-1");
  await expect(page.getByLabel("별명")).toHaveValue("새 교사");
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("signup blocks a second pending submit", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_delayed" }),
    );
  });
  await page.goto("/auth?mode=signup");
  await fillRegistration(page);
  const form = page.locator("form");
  await page.getByRole("button", { name: "가입 신청하기" }).click();
  const pending = page.getByRole("button", { name: "가입 신청 중…" });
  await expect(pending).toBeDisabled();
  await form.evaluate((element) =>
    element.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  await expect(
    page.getByRole("button", { name: "가입 신청 중…" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "로그인 화면으로" }).click();
  await login(page, "new-teacher-1", "correct horse battery staple");
  await expect(page.getByRole("alert")).toContainText(
    "승인 대기 중인 계정입니다",
  );
});

test("password-change route requires a change-only session", async ({
  page,
}) => {
  await page.goto("/auth?mode=password-change");
  const gate = page
    .getByRole("status")
    .filter({ hasText: "비밀번호 변경 전용 로그인이 필요해요" });
  await expect(gate).toBeVisible();
  await expect(
    gate.getByRole("link", { name: "로그인 화면으로", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);

  await page.goto("/auth?mode=reauth");
  await expect(page.getByRole("status")).toContainText(
    "이 인증 기능은 아직 제공하지 않아요",
  );
});

test("an expired temporary password gets a specific login message", async ({
  page,
}) => {
  await page.goto("/__dev/mock-reset");
  await page
    .getByLabel("개발용 mock 시각", { exact: true })
    .fill("2026-09-23T09:12");
  await page.getByRole("button", { name: "시각 저장", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "mock 시각을 저장했어요." }),
  ).toBeVisible();

  await page.goto("/auth?mode=login");
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(loginForm).toBeVisible();
  await loginForm.locator("#login-id").fill("임시교사38");
  await loginForm.locator("#login-password").fill("Temporary Demo Password 38");
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(loginForm.getByRole("alert")).toContainText(
    "임시 비밀번호가 만료되었어요. 관리자에게 다시 요청해 주세요.",
  );
});

test("temporary member can browse publicly, then change to a full session", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(loginForm).toBeVisible();
  await loginForm.locator("#login-id").fill("임시교사38");
  await loginForm.locator("#login-password").fill("Temporary Demo Password 38");
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();

  await expect(page).toHaveURL(/mode=password-change/);
  const changeForm = page.locator('[data-screen-label="비밀번호 변경"] form');
  await expect(changeForm).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "비밀번호를 변경해 주세요",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator('a[href="/admin"]')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();

  await page.goto("/apps/00000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "복사하기", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "앱 열기", exact: true }),
  ).toHaveAttribute("rel", "noopener noreferrer");

  await page.goto(memberApp);
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await page.goto("/auth?mode=password-change");
  await expect(changeForm).toBeVisible();

  await changeForm.locator("#new-password").fill("short");
  await changeForm.locator("#new-password-confirm").fill("short");
  await changeForm
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(changeForm.locator("#new-password-error")).toContainText(
    "15~128자",
  );

  await changeForm
    .locator("#new-password")
    .fill("  Cafe\u0301 changed password 38  ");
  await changeForm
    .locator("#new-password-confirm")
    .fill("different confirmation phrase");
  await changeForm
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(changeForm.locator("#new-password-confirm-error")).toBeVisible();

  await changeForm
    .locator("#new-password-confirm")
    .fill("  Café changed password 38  ");
  await changeForm
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.goto("/auth?mode=login");
  const freshLoginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(freshLoginForm).toBeVisible();
  await freshLoginForm.locator("#login-id").fill("임시교사38");
  await freshLoginForm
    .locator("#login-password")
    .fill("Temporary Demo Password 38");
  await freshLoginForm
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(freshLoginForm.getByRole("alert")).toContainText(
    "로그인 아이디 또는 비밀번호를 확인해 주세요",
  );
});

test("temporary administrator is kept out of admin tools until changing password", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(loginForm).toBeVisible();
  await loginForm.locator("#login-id").fill("임시관리자38");
  await loginForm
    .locator("#login-password")
    .fill("Temporary Admin Password 38");
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/mode=password-change/);

  await page.goto("/admin");
  await expect(page).toHaveURL(/mode=password-change/);
  await expect(
    page.getByRole("heading", { name: "관리자 대시보드", exact: true }),
  ).toHaveCount(0);

  const changeForm = page.locator('[data-screen-label="비밀번호 변경"] form');
  await expect(changeForm).toBeVisible();
  await changeForm.locator("#new-password").fill("New admin phrase for 38!");
  await changeForm
    .locator("#new-password-confirm")
    .fill("New admin phrase for 38!");
  await changeForm
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(page).toHaveURL("/admin");
  await expect(
    page.getByRole("heading", { name: "관리자 대시보드", exact: true }),
  ).toBeVisible();
});
