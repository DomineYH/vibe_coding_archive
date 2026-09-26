import { expect, test } from "@playwright/test";

const key = "eduvibe-archive-mock-v1";

async function login(page) {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill("교사김코딩");
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

test("protects direct access to the registration route", async ({ page }) => {
  await page.goto("/apps/new");
  await expect(page).toHaveURL(/\/auth\?mode=login$/);
  await expect(page.locator('[data-screen-label="로그인"] form')).toBeVisible();
  await expect(
    page.getByRole("form", { name: "새 앱 등록 양식", exact: true }),
  ).toHaveCount(0);
});

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
  await expect(
    form.getByRole("textbox", {
      name: "어플리케이션 이름",
      exact: true,
    }),
  ).toBeDisabled();
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
