import { expect, test } from "@playwright/test";

const key = "eduvibe-archive-mock-v1";

async function login(page, loginId = "교사김코딩") {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  await form.getByLabel("비밀번호", { exact: true }).fill("1234");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function openNewApp(page) {
  const open = page.getByRole("button", {
    name: "내 앱 등록하기",
    exact: true,
  });
  await expect(open).toBeVisible();
  await open.click();
  await expect(page).toHaveURL(/\/apps\/new$/);
  await expect(
    page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
  ).toBeVisible();
}

async function fillValidForm(page, name = "새 수업 도구 e2e") {
  const form = page.getByRole("form", { name: "새 앱 등록 양식", exact: true });
  await expect(page).toHaveURL(/\/apps\/new$/);
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://create.example.org/class");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("학생이 풀이를 설명하는 수업 도구를 만들어줘.\n힌트도 보여줘.");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill(
      "수학 수업에서 풀이 과정을 공유합니다.\n\n[활용 매뉴얼]\n1. 함께 풀이합니다.",
    );
  await form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "초3", exact: true })
    .click();
  return form;
}

async function setScenario(page, scenario) {
  await page.evaluate(
    ({ key, scenario }) => {
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...state, scenario }));
    },
    { key, scenario },
  );
}

async function advanceBeyondOperationExpiry(page) {
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({
        ...state,
        mock_now: "2026-09-24T00:12:00.000Z",
        principal_session: {
          ...state.principal_session,
          expires_at: "2026-09-25T00:12:00.000Z",
        },
      }),
    );
  }, key);
}

for (const [loginId, password] of [
  ["교사김코딩", "1234"],
  ["admin", "admin123"],
]) {
  test(`protects direct access to the registration route and returns ${loginId} to the form`, async ({
    page,
  }) => {
    await page.goto("/apps/new");
    await expect(page).toHaveURL("/auth?mode=login&return_to=%2Fapps%2Fnew");
    const form = page.locator('[data-screen-label="로그인"] form');
    await expect(form).toBeVisible();
    await expect(
      page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
    ).toHaveCount(0);
    await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
    await form.getByLabel("비밀번호", { exact: true }).fill(password);
    await form.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(page).toHaveURL("/apps/new");
    await expect(
      page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("어플리케이션 이름", { exact: true }),
    ).toHaveValue("");
    await expect(page.locator('[data-screen-label="로그인"] form')).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "로그아웃", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath("create-login-return.png"),
      animations: "disabled",
    });
  });
}

for (const alreadySignedIn of [false, true]) {
  test(`temporary member returns to registration after password change with existing session=${alreadySignedIn}`, async ({
    page,
  }) => {
    await page.goto(alreadySignedIn ? "/auth?mode=login" : "/apps/new");
    if (!alreadySignedIn)
      await expect(page).toHaveURL("/auth?mode=login&return_to=%2Fapps%2Fnew");
    const loginForm = page.locator('[data-screen-label="로그인"] form');
    await loginForm
      .getByLabel("로그인 아이디", { exact: true })
      .fill("임시교사38");
    await loginForm
      .getByLabel("비밀번호", { exact: true })
      .fill("Temporary Demo Password 38");
    await loginForm
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await expect(
      page.locator('[data-screen-label="비밀번호 변경"] form'),
    ).toBeVisible();
    if (alreadySignedIn) await page.goto("/apps/new");
    await expect(page).toHaveURL(
      "/auth?mode=password-change&return_to=%2Fapps%2Fnew",
    );
    await expect(
      page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
    ).toHaveCount(0);
    const changeForm = page.locator('[data-screen-label="비밀번호 변경"] form');
    await changeForm
      .getByLabel("새 비밀번호 (필수)", { exact: true })
      .fill("New member phrase for 215!");
    await changeForm
      .getByLabel("새 비밀번호 확인 (필수)", { exact: true })
      .fill("New member phrase for 215!");
    await changeForm
      .getByRole("button", { name: "비밀번호 변경", exact: true })
      .click();
    await expect(page).toHaveURL("/apps/new");
    await expect(
      page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("어플리케이션 이름", { exact: true }),
    ).toHaveValue("");
    await expect(changeForm).toHaveCount(0);
  });
}

test("approved member registers, refreshes, and returns to the updated gallery", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page);
  const register = form.getByRole("button", {
    name: "아카이브에 등록",
    exact: true,
  });
  await setScenario(page, "app_create_delayed");
  await register.dblclick();
  const pending = page.getByRole("button", { name: "등록 중…", exact: true });
  await expect(pending).toBeDisabled();
  await expect(
    page.getByRole("heading", { name: "새 수업 도구 e2e", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /^앱을 등록했어요\.$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "새 수업 도구 e2e", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "갤러리로", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", {
      name: "새 수업 도구 e2e, 교사김코딩, 수학 상세 보기",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator("a.card-r")).toHaveCount(17);
});

test("keeps over-limit and invalid URL values for correction", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = page.getByRole("form", { name: "새 앱 등록 양식", exact: true });
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  const url = form.getByRole("textbox", { name: "배포 URL", exact: true });
  await name.fill("🙂".repeat(101));
  await url.fill("https://localhost/app");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("핵심 프롬프트");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("상세 설명");
  await form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "초3", exact: true })
    .click();
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(url).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveValue("🙂".repeat(101));
  await expect(url).toHaveValue("https://localhost/app");
});

test("supports keyboard selection for categories, theme, and visibility", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = page.getByRole("form", { name: "새 앱 등록 양식", exact: true });
  const subject = form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "과학", exact: true });
  await subject.focus();
  await page.keyboard.press("Enter");
  await expect(subject).toHaveAttribute("aria-pressed", "true");

  const grade = form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "중1", exact: true });
  await grade.focus();
  await page.keyboard.press("Space");
  await expect(grade).toHaveAttribute("aria-pressed", "true");

  const theme = form.getByRole("button", {
    name: "테마 Sage 선택",
    exact: true,
  });
  await theme.focus();
  await page.keyboard.press("Enter");
  await expect(theme).toHaveAttribute("aria-pressed", "true");

  const visibility = form.getByRole("switch", {
    name: "전체 공개",
    exact: true,
  });
  await visibility.focus();
  await page.keyboard.press("Space");
  await expect(visibility).toHaveAttribute("aria-checked", "false");
});

test("locks the form on an unknown result and only retries the same request after an explicit choice", async ({
  page,
  context,
}) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page, "unresolved create e2e");
  await setScenario(page, "app_create_unresolved");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  const check = page.getByRole("button", {
    name: "저장 결과 확인",
    exact: true,
  });
  const retry = page.getByRole("button", {
    name: "같은 요청 다시 보내기",
    exact: true,
  });
  await expect(check).toBeVisible();
  await expect(retry).toBeVisible();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), key),
  ).not.toContain("unresolved create e2e");
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  const prompt = form.getByRole("textbox", {
    name: "핵심 프롬프트",
    exact: true,
  });
  await expect(name).toBeEnabled();
  await expect(name).toHaveAttribute("readonly", "");
  await expect(prompt).toBeEnabled();
  await expect(prompt).toHaveAttribute("readonly", "");
  await expect(
    form
      .getByRole("group", { name: "교과 과목", exact: true })
      .getByRole("button", { name: "수학", exact: true }),
  ).toBeDisabled();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await name.click();
  await name.press("Control+A");
  await name.press("Control+C");
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe("unresolved create e2e");
  await check.click();
  await expect(page.getByRole("alert")).toContainText(
    "아직 저장 결과가 정해지지 않았어요",
  );
  await setScenario(page, "original");
  await retry.click();
  await expect(
    page.getByRole("heading", { name: "unresolved create e2e", exact: true }),
  ).toBeVisible();
});

test("waits for a delayed save before taking a blocked navigation to the created detail", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page, "deferred navigation create e2e");
  await setScenario(page, "app_create_delayed");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await page
    .getByRole("link", { name: "EduVibe 아카이브 홈", exact: true })
    .click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("저장이 끝날 때까지 이동할 수 없어요");
  await expect(
    page.getByRole("heading", {
      name: "deferred navigation create e2e",
      exact: true,
    }),
  ).toBeVisible();
});

test("reads a committed result after the create response is lost", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page, "committed unknown create e2e");
  await setScenario(page, "app_create_unknown");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  const check = page.getByRole("button", {
    name: "저장 결과 확인",
    exact: true,
  });
  await expect(check).toBeVisible();
  await check.click();
  await expect(
    page.getByRole("heading", {
      name: "committed unknown create e2e",
      exact: true,
    }),
  ).toBeVisible();
});

test("keeps confirmed create success distinct when the app is later unavailable", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const name = "확정 뒤 조회 불가 앱";
  const form = await fillValidForm(page, name);
  await setScenario(page, "app_create_unknown");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  const check = form.getByRole("button", {
    name: "저장 결과 확인",
    exact: true,
  });
  await expect(check).toBeVisible();

  const appId = await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const target = [...state.apps, ...state.private_apps].find(
      (app) => app.name === "확정 뒤 조회 불가 앱",
    );
    if (!target) return null;
    localStorage.setItem(
      key,
      JSON.stringify({
        ...state,
        apps: state.apps.filter((app) => app.id !== target.id),
        private_apps: state.private_apps.filter((app) => app.id !== target.id),
      }),
    );
    return target.id;
  }, key);
  expect(appId).toBeTruthy();

  await check.click();
  await expect(page).toHaveURL(new RegExp(`/apps/${appId}$`));
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(
    page.getByText("앱을 등록했어요.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      ({ key, name }) => {
        const state = JSON.parse(localStorage.getItem(key));
        return [...state.apps, ...state.private_apps].filter(
          (app) => app.name === name,
        ).length;
      },
      { key, name },
    ),
  ).toBe(0);
});

test("keeps an expired write locked after its result can no longer be checked", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page, "만료된 키 확인 대상");
  await setScenario(page, "app_create_unresolved");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  const check = form.getByRole("button", {
    name: "저장 결과 확인",
    exact: true,
  });
  await expect(check).toBeVisible();
  await advanceBeyondOperationExpiry(page);
  await check.click();

  await expect(page.getByRole("alert")).toContainText(
    "저장 결과 확인 기간이 지나",
  );
  await expect(
    form.getByRole("button", { name: "같은 요청 다시 보내기", exact: true }),
  ).toHaveCount(0);
  await expect(form.locator('button[type="submit"]')).toBeDisabled();
  const unload = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const completed = window.dispatchEvent(event);
    return { completed, prevented: event.defaultPrevented };
  });
  expect(unload).toEqual({ completed: false, prevented: true });
});

test("hides an unresolved draft during repeated auth failures and restores it only after recheck", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page, "인증 확인 중 숨길 초안");
  await setScenario(page, "app_create_unresolved");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "저장 결과 확인", exact: true }),
  ).toBeVisible();

  await setScenario(page, "auth_observation_error");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("focus"));
  });
  const status = page
    .getByRole("main")
    .getByText("로그인 상태를 확인할 수 없어요", { exact: true });
  await expect(status).toBeVisible();
  await expect(form).toBeHidden();
  const retry = page
    .getByRole("main")
    .getByRole("button", { name: "다시 확인", exact: true });
  await retry.click();
  await expect(status).toBeVisible();
  await expect(form).toBeHidden();

  await setScenario(page, "original");
  await retry.click();
  await expect(form).toBeVisible();
  await expect(
    form.getByRole("textbox", {
      name: "어플리케이션 이름",
      exact: true,
    }),
  ).toHaveValue("인증 확인 중 숨길 초안");
  await expect(
    form.getByRole("button", { name: "저장 결과 확인", exact: true }),
  ).toBeVisible();
});

test("discards the in-tab draft after logout even when the same member returns", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  await page
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill("로그아웃 뒤 폐기할 초안");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await login(page);
  await openNewApp(page);
  await expect(
    page
      .getByRole("form", { name: "새 앱 등록 양식", exact: true })
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true }),
  ).toHaveValue("");
});

test("discards old drafts across an A to B to A member switch", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  await page
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill("A 회원의 이전 초안");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await login(page, "과학덕후박샘");
  await openNewApp(page);
  const form = page.getByRole("form", {
    name: "새 앱 등록 양식",
    exact: true,
  });
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await expect(name).toHaveValue("");
  await name.fill("B 회원의 초안");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);

  await login(page);
  await openNewApp(page);
  await expect(
    page
      .getByRole("form", { name: "새 앱 등록 양식", exact: true })
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true }),
  ).toHaveValue("");
});

test("shows a rejected save without clearing the draft", async ({ page }) => {
  await login(page);
  await openNewApp(page);
  const form = await fillValidForm(page, "rejected create e2e");
  await setScenario(page, "app_create_failure");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("앱을 등록하지 못했어요");
  await expect(
    form.getByRole("textbox", {
      name: "어플리케이션 이름",
      exact: true,
    }),
  ).toHaveValue("rejected create e2e");
  await expect(
    form.getByRole("button", { name: "아카이브에 등록", exact: true }),
  ).toBeEnabled();
});

test("defers internal navigation until a dirty draft is kept or discarded", async ({
  page,
}) => {
  await login(page);
  await openNewApp(page);
  const name = page.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("작성 중인 앱");
  const unload = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const completed = window.dispatchEvent(event);
    return { completed, prevented: event.defaultPrevented };
  });
  expect(unload).toEqual({ completed: false, prevented: true });
  await page.getByRole("link", { name: "취소", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "계속 작성", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/new$/);
  await expect(name).toHaveValue("작성 중인 앱");

  await page
    .getByRole("link", { name: "EduVibe 아카이브 홈", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "작성 취소하고 이동", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
});
