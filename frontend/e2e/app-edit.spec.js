import { expect, test } from "@playwright/test";

const key = "eduvibe-archive-mock-v1";

async function loginAs(page, loginId, password = "1234") {
  await page.goto("/auth?mode=login");
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await expect(loginForm).toBeVisible();
  await loginForm
    .getByRole("textbox", { name: "로그인 아이디", exact: true })
    .fill(loginId);
  await loginForm.getByLabel("비밀번호", { exact: true }).fill(password);
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function createOwnedApp(page, name) {
  await loginAs(page, "교사김코딩");

  await page.getByRole("link", { name: "앱 등록", exact: true }).click();
  await expect(page).toHaveURL(/\/apps\/new$/);
  const form = page.getByRole("form", { name: "새 앱 등록 양식", exact: true });
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://edit.example.org/class");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("질문에 답하고 풀이 과정을 설명해 주세요.");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("학생이 문제를 풀며 과정을 확인합니다.");
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
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2];
}

async function openEdit(page, id) {
  await page.getByRole("link", { name: "앱 수정", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/apps/${id}/edit$`));
  const form = page.getByRole("form", { name: "앱 수정 양식", exact: true });
  await expect(form).toBeVisible();
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

test("owner edits an app, changes visibility, and the gallery no longer lists it", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "공개 범위 수정 대상");
  const form = await openEdit(page, id);
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill("비공개 수업 도구");
  await form.getByRole("switch", { name: "전체 공개", exact: true }).click();
  await expect(
    form.getByText("외부 사이트 자체의 접근 제한은 아니에요."),
  ).toBeVisible();
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();

  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
  await expect(
    page.getByRole("heading", { name: "비공개 수업 도구", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('[data-screen-label="비공개 앱 상세"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: /^앱을 수정했어요\.$/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "갤러리로", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("link", { name: /비공개 수업 도구/ }),
  ).toHaveCount(0);
});

test("private app content stays hidden from non-owner members", async ({
  browser,
  page,
}) => {
  const id = await createOwnedApp(page, "비공개 권한 확인 대상");
  const form = await openEdit(page, id);
  const visibility = form.getByRole("switch", {
    name: "전체 공개",
    exact: true,
  });
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-checked", "false");
  const save = form.getByRole("button", {
    name: "변경사항 저장",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
  await expect(
    page.getByRole("heading", { name: "비공개 권한 확인 대상", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toHaveCount(0);
  const mockState = await page.evaluate((storageKey) => {
    return localStorage.getItem(storageKey);
  }, key);
  const viewer = await browser.newPage();
  await viewer.goto("/");
  await viewer.evaluate(
    ({ storageKey, state }) => localStorage.setItem(storageKey, state),
    { storageKey: key, state: mockState },
  );
  await viewer.reload();
  await loginAs(viewer, "과학덕후박샘");
  await viewer.goto(`/apps/${id}`);
  await expect(viewer.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(
    viewer.getByRole("heading", { name: "비공개 권한 확인 대상", exact: true }),
  ).toHaveCount(0);
  await viewer.goto(`/apps/${id}/edit`);
  await expect(viewer.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(
    viewer.getByRole("form", { name: "앱 수정 양식", exact: true }),
  ).toHaveCount(0);
  await viewer.close();
});

test("locks a delayed edit and waits before leaving for the confirmed detail", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "지연 수정 저장 대상");
  const form = await openEdit(page, id);
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("지연 후 저장된 수정");
  await setScenario(page, "app_update_delayed");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(name).toBeDisabled();
  await expect(
    form.getByRole("button", { name: "수정 중…", exact: true }),
  ).toBeDisabled();

  await page
    .getByRole("link", { name: "EduVibe 아카이브 홈", exact: true })
    .click();
  await expect(page.getByRole("alertdialog")).toContainText(
    "저장이 끝날 때까지 이동할 수 없어요",
  );
  await expect(page).toHaveURL(new RegExp(`/apps/${id}/edit$`));
  await expect(
    page.getByRole("heading", { name: "지연 후 저장된 수정", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
});

test("version conflict preserves the draft until the author confirms loading latest content", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "충돌 확인 대상");
  const form = await openEdit(page, id);
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("내가 보존할 초안");

  const otherPage = await page.context().newPage();
  await otherPage.goto(`/apps/${id}/edit`);
  const otherForm = otherPage.getByRole("form", {
    name: "앱 수정 양식",
    exact: true,
  });
  await expect(otherForm).toBeVisible();
  await otherForm
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill("먼저 저장한 변경");
  await otherForm
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(
    otherPage.getByRole("heading", { name: "먼저 저장한 변경", exact: true }),
  ).toBeVisible();

  await expect(form).toBeVisible();
  await expect(name).toHaveValue("내가 보존할 초안");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "다른 내용으로 수정되었어요",
  );
  await expect(name).toHaveValue("내가 보존할 초안");

  await setScenario(page, "auth_observation_error");
  await form
    .getByRole("button", { name: "최신 내용 불러오기", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "최신 내용을 불러오지 못했어요",
  );
  await expect(name).toHaveValue("내가 보존할 초안");
  await setScenario(page, "original");
  await form
    .getByRole("button", { name: "최신 내용 불러오기", exact: true })
    .click();
  await expect(name).toHaveValue("먼저 저장한 변경");
});

test("unknown update outcome requires an explicit result check before completion", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "결과 확인 수정 대상");
  const form = await openEdit(page, id);
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("응답 유실 후 확인한 수정");
  await setScenario(page, "app_update_unknown");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  const check = form.getByRole("button", {
    name: "저장 결과 확인",
    exact: true,
  });
  await expect(check).toBeVisible();
  await expect(name).toBeEnabled();
  await expect(name).toHaveAttribute("readonly", "");
  await check.click();
  await expect(
    page.getByRole("heading", {
      name: "응답 유실 후 확인한 수정",
      exact: true,
    }),
  ).toBeVisible();
});

test("hides and restores an unresolved edit draft around failed auth checks", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "인증 복귀 수정 대상");
  const form = await openEdit(page, id);
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("인증 확인 중 숨길 수정 초안");
  await setScenario(page, "app_update_unresolved");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
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
  await expect(name).toHaveValue("인증 확인 중 숨길 수정 초안");
  await expect(
    form.getByRole("button", { name: "저장 결과 확인", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "인증 복귀 수정 대상", exact: true }),
  ).toHaveCount(0);
});

test("unresolved update can only be retried with the original request", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "미확정 수정 대상");
  const form = await openEdit(page, id);
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("같은 요청으로 다시 보낼 수정");
  await setScenario(page, "app_update_unresolved");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  const check = form.getByRole("button", {
    name: "저장 결과 확인",
    exact: true,
  });
  const retry = form.getByRole("button", {
    name: "같은 요청 다시 보내기",
    exact: true,
  });
  await expect(check).toBeVisible();
  await expect(retry).toBeVisible();
  await expect(name).toBeEnabled();
  await expect(name).toHaveAttribute("readonly", "");
  await check.click();
  await expect(page.getByRole("alert")).toContainText(
    "아직 저장 결과가 정해지지 않았어요",
  );
  await setScenario(page, "original");
  await retry.click();
  await expect(
    page.getByRole("heading", {
      name: "같은 요청으로 다시 보낼 수정",
      exact: true,
    }),
  ).toBeVisible();
});

test("confirmed rejection keeps the form values available for correction", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "거절 수정 대상");
  const form = await openEdit(page, id);
  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("저장 거절 뒤 보존한 값");
  await setScenario(page, "app_update_failure");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("앱을 수정하지 못했어요");
  await expect(name).toHaveValue("저장 거절 뒤 보존한 값");
  await expect(
    form.getByRole("button", { name: "변경사항 저장", exact: true }),
  ).toBeEnabled();
});

test("keyboard privacy control and field errors have accessible state", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "키보드 편집 확인 대상");
  const form = await openEdit(page, id);
  const visibility = form.getByRole("switch", {
    name: "전체 공개",
    exact: true,
  });
  await visibility.focus();
  await expect(visibility).toBeFocused();
  await page.keyboard.press("Space");
  await expect(visibility).toHaveAttribute("aria-checked", "false");

  const name = form.getByRole("textbox", {
    name: "어플리케이션 이름",
    exact: true,
  });
  await name.fill("");
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "표시된 항목을 확인해 주세요",
  );
  await expect(name).toHaveAttribute("aria-invalid", "true");
  await expect(name).toHaveAttribute("aria-describedby", "app-name-error");
  await expect(form.locator("#app-name-error")).toBeVisible();
});

test("owner cancels the inline delete prompt without changing the app", async ({
  page,
}) => {
  const name = "삭제 취소 확인 대상";
  const id = await createOwnedApp(page, name);
  const detail = page.locator('[data-screen-label="공개 앱 상세"]');
  const prompt = page.getByRole("group", {
    name: `‘${name}’을 아카이브에서 삭제할까요?`,
    exact: true,
  });

  await detail.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(prompt).toBeVisible();
  await expect(
    prompt.getByRole("button", { name: "취소", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(prompt).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
});

test("a different approved member can view a public app but cannot delete it", async ({
  page,
}) => {
  const id = await createOwnedApp(page, "작성자 전용 삭제 대상");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await loginAs(page, "과학덕후박샘");
  await page.goto(`/apps/${id}`);
  const detail = page.locator('[data-screen-label="공개 앱 상세"]');
  await expect(detail).toBeVisible();
  await expect(
    detail.getByRole("button", { name: "삭제", exact: true }),
  ).toHaveCount(0);
});

test("owner confirms a delayed delete once and returns to a refreshed gallery", async ({
  page,
}) => {
  const name = "삭제 확정 후 갱신 대상";
  const id = await createOwnedApp(page, name);
  await setScenario(page, "app_delete_delayed");
  const detail = page.locator('[data-screen-label="공개 앱 상세"]');
  await detail.getByRole("button", { name: "삭제", exact: true }).click();
  const prompt = page.getByRole("group", {
    name: `‘${name}’을 아카이브에서 삭제할까요?`,
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(prompt.getByRole("status")).toContainText("삭제 요청 처리 중");
  await expect(prompt.getByRole("status")).toBeFocused();
  await expect(
    prompt.getByRole("button", { name: "삭제 중…", exact: true }),
  ).toBeDisabled();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("status").filter({
      hasText: /^앱을 삭제했어요\.$/,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(
    0,
  );
  await expect(page).not.toHaveURL(new RegExp(`/apps/${id}$`));
});

test("unknown delete result stays on detail until the issued key confirms success", async ({
  page,
}) => {
  const name = "응답 유실 삭제 대상";
  const id = await createOwnedApp(page, name);
  await setScenario(page, "app_delete_unknown");
  const detail = page.locator('[data-screen-label="공개 앱 상세"]');
  await detail.getByRole("button", { name: "삭제", exact: true }).click();
  const prompt = page.getByRole("group", {
    name: `‘${name}’을 아카이브에서 삭제할까요?`,
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "삭제 확인", exact: true }).click();

  await expect(prompt.getByRole("alert")).toContainText(
    "삭제 결과를 확인할 수 없어요",
  );
  await expect(
    prompt.getByRole("button", { name: "삭제 결과 확인", exact: true }),
  ).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await prompt
    .getByRole("button", { name: "삭제 결과 확인", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("status").filter({
      hasText: /^앱을 삭제했어요\.$/,
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toHaveCount(
    0,
  );
});

test("keeps an expired deletion unknown and never repeats it with a new key", async ({
  page,
}) => {
  const name = "만료된 삭제 결과 대상";
  const id = await createOwnedApp(page, name);
  await setScenario(page, "app_delete_unknown");
  const detail = page.locator('[data-screen-label="공개 앱 상세"]');
  await detail.getByRole("button", { name: "삭제", exact: true }).click();
  const prompt = page.getByRole("group", {
    name: `‘${name}’을 아카이브에서 삭제할까요?`,
    exact: true,
  });
  await prompt.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(prompt.getByRole("alert")).toBeVisible();
  await advanceBeyondOperationExpiry(page);
  await prompt
    .getByRole("button", { name: "삭제 결과 확인", exact: true })
    .click();

  await expect(prompt.getByRole("alert")).toContainText(
    "삭제 결과 확인 기간이 지나",
  );
  await expect(
    prompt.getByRole("button", {
      name: "같은 삭제 요청 다시 보내기",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));
  const unload = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    const completed = window.dispatchEvent(event);
    return { completed, prevented: event.defaultPrevented };
  });
  expect(unload).toEqual({ completed: false, prevented: true });
});

test("unresolved deletion warns before refresh and keeps its key when the author stays", async ({
  page,
}) => {
  const name = "새로고침 전 결과 확인 대상";
  const id = await createOwnedApp(page, name);
  await setScenario(page, "app_delete_unresolved");
  const detail = page.locator('[data-screen-label="공개 앱 상세"]');
  await detail.getByRole("button", { name: "삭제", exact: true }).click();
  const prompt = page.getByRole("group", {
    name: `‘${name}’을 아카이브에서 삭제할까요?`,
    exact: true,
  });
  await expect(prompt).toBeVisible();
  await prompt.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(prompt.getByRole("alert")).toContainText(
    "삭제 결과를 확인할 수 없어요",
  );

  const dialogPromise = page.waitForEvent("dialog");
  void page.reload().catch(() => {});
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await expect(prompt).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/apps/${id}$`));

  await setScenario(page, "original");
  await prompt
    .getByRole("button", { name: "같은 삭제 요청 다시 보내기", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("status").filter({
      hasText: /^앱을 삭제했어요\.$/,
    }),
  ).toBeVisible();
});
