import { expect, test } from "@playwright/test";

const memberApp = "/apps/00000000-0000-4000-8000-000000000091";

async function login(page, loginId = "교사김코딩", password = "1234") {
  await page.getByLabel("로그인 아이디").fill(loginId);
  await page.getByLabel("비밀번호").fill(password);
  await page
    .getByRole("button", { name: "로그인", exact: true })
    .last()
    .click();
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
  await expect(page.getByText("교사김코딩", { exact: true })).toBeVisible();
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

test("login validation identifies fields and blocks a second pending submit", async ({
  page,
}) => {
  await page.goto("/auth?mode=login");
  const submit = page
    .getByRole("button", { name: "로그인", exact: true })
    .last();
  await submit.click();
  const loginId = page.getByLabel("로그인 아이디");
  const password = page.getByLabel("비밀번호");
  await expect(loginId).toHaveAttribute("aria-invalid", "true");
  await expect(loginId).toHaveAttribute("aria-describedby", "login-id-error");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toHaveAttribute("aria-describedby", "password-error");

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "auth_delayed" }),
    );
  });
  await login(page);
  const pendingSubmit = page.getByRole("button", { name: "로그인 중…" });
  await expect(pendingSubmit).toBeDisabled();
  await page.getByLabel("비밀번호").press("Enter");
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

  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(otherTab.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(
    otherTab.getByRole("heading", { name: "과학 수행평가 루브릭 채점기" }),
  ).toHaveCount(0);
});

test("an authenticated member gets 403 for the admin route while admin can open it", async ({
  page,
}) => {
  await page.goto("/admin");
  await expect(page).toHaveURL("/auth?mode=login&return_to=%2Fadmin");
  await login(page);
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");

  await page.getByRole("button", { name: "로그아웃" }).click();
  await page.goto("/auth?mode=login&return_to=%2Fadmin");
  await login(page, "admin", "admin123");
  await page.reload();
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("heading", { name: "관리자" })).toBeVisible();
  await expect(
    page.getByText("관리자 작업은 아직 제공하지 않아요."),
  ).toBeVisible();
});

test("unsupported signup and password changes never report success", async ({
  page,
}) => {
  for (const [mode, title] of [
    ["signup", "신규 가입은 아직 제공하지 않아요"],
    ["password-change", "이 인증 기능은 아직 제공하지 않아요"],
    ["reauth", "이 인증 기능은 아직 제공하지 않아요"],
  ]) {
    await page.goto(`/auth?mode=${mode}`);
    await expect(page.getByRole("status")).toContainText(title);
    await expect(
      page.getByRole("link", { name: "로그인으로 돌아가기" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
  }
});
