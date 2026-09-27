import { expect, test } from "@playwright/test";

const storageKey = "eduvibe-archive-mock-v1";
const loginId = "issue49teacher";
const nickname = "T19 통합 교사";
const password = "issue49 teacher passphrase";
const appName = "T19 통합 수업 도구";
const publishedName = "T19 공개 수업 도구";

async function signIn(page, id, secret) {
  await page.goto("/auth?mode=login");
  await expect(page).toHaveURL("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill(id);
  await form.getByLabel("비밀번호", { exact: true }).fill(secret);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
}

async function openNewAppForm(page) {
  await page.getByRole("link", { name: "앱 등록", exact: true }).click();
  await expect(page).toHaveURL("/apps/new");
  const form = page.getByRole("form", {
    name: "새 앱 등록 양식",
    exact: true,
  });
  await expect(form).toBeVisible();
  return form;
}

async function fillAppForm(form, name) {
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://issue49.example.org/class");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("학생이 풀이 과정을 설명하는 수업 도구를 만들어줘.");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("수업에서 풀이 과정을 함께 확인합니다.");
  await form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "초3", exact: true })
    .click();
}

async function setScenario(page, scenario) {
  await page.evaluate(
    ({ key, scenario }) => {
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...state, scenario }));
    },
    { key: storageKey, scenario },
  );
}

function userRow(page) {
  return page
    .getByRole("list", { name: "회원 목록" })
    .getByRole("listitem")
    .filter({ has: page.getByText(nickname, { exact: true }) });
}

test("signup through approval, app health, account deletion, and reset works as one journey", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await page.goto("/auth?mode=signup");
  await expect(page).toHaveURL("/auth?mode=signup");
  const signup = page.locator('[data-screen-label="회원가입"] form');
  await expect(signup).toBeVisible();
  await signup.getByLabel(/^로그인 아이디/).fill(loginId);
  await signup.getByLabel(/^비밀번호 \(필수\)$/).fill(password);
  await signup.getByLabel(/^비밀번호 확인/).fill(password);
  await signup.getByLabel(/^별명/).fill(nickname);
  await signup.getByLabel(/^이메일/).fill("");
  await signup.getByLabel(/^연락처/).fill("");
  await signup
    .getByRole("button", { name: "가입 신청하기", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "가입 신청이 접수되었어요",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toHaveCount(0);

  await signIn(page, "admin", "admin123");
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "관리자 대시보드", exact: true }),
  ).toBeVisible();
  const pending = userRow(page);
  await expect(pending).toHaveCount(1);
  await pending.getByRole("button", { name: "승인하기", exact: true }).click();
  const approval = page.getByRole("region", { name: /회원 승인 확인/ });
  await expect(approval).toBeVisible();
  await approval
    .getByRole("button", { name: "승인하기 확인", exact: true })
    .click();
  await expect(approval.getByRole("status")).toContainText(
    "요청한 승인 상태가 확정됐어요",
  );

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await signIn(page, loginId, password);
  const form = await openNewAppForm(page);
  await fillAppForm(form, appName);
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: appName, exact: true }),
  ).toBeVisible();
  const appId = new URL(page.url()).pathname.match(/^\/apps\/([^/]+)$/)?.[1];
  expect(appId).toBeTruthy();

  await page.goto(`/apps/${appId}`);
  await expect(
    page.getByRole("heading", { name: appName, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: appName, exact: true }),
  ).toBeVisible();
  await page.goto(`/?q=${encodeURIComponent(appName)}`);
  const appCard = page.locator("a.card-r").filter({ hasText: appName });
  await expect(appCard).toHaveCount(1);
  await appCard.click();
  await expect(page).toHaveURL(`/apps/${appId}`);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?q=/);
  await expect(appCard).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(`/apps/${appId}`);

  await page.getByRole("link", { name: "앱 수정", exact: true }).click();
  await expect(page).toHaveURL(`/apps/${appId}/edit`);
  let editForm = page.getByRole("form", { name: "앱 수정 양식", exact: true });
  await expect(editForm).toBeVisible();
  await editForm
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(publishedName);
  const visibility = editForm.getByRole("switch", {
    name: "전체 공개",
    exact: true,
  });
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-checked", "false");
  await editForm
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page).toHaveURL(`/apps/${appId}`);
  await expect(
    page.locator('[data-screen-label="비공개 앱 상세"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: publishedName, exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "앱 수정", exact: true }).click();
  await expect(page).toHaveURL(`/apps/${appId}/edit`);
  editForm = page.getByRole("form", { name: "앱 수정 양식", exact: true });
  await expect(editForm).toBeVisible();
  const publish = editForm.getByRole("switch", {
    name: "전체 공개",
    exact: true,
  });
  await publish.click();
  await expect(publish).toHaveAttribute("aria-checked", "true");
  await editForm
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page).toHaveURL(`/apps/${appId}`);
  await expect(
    page.locator('[data-screen-label="공개 앱 상세"]'),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: publishedName, exact: true }),
  ).toBeVisible();

  const health = page.locator("aside section").filter({
    has: page.getByRole("heading", { name: "연결 상태", exact: true }),
  });
  await health
    .getByRole("button", { name: "연결 다시 확인", exact: true })
    .click();
  await expect(
    health.getByRole("status").filter({ hasText: "검사 작업이 완료됐어요" }),
  ).toBeVisible();

  const secondTab = await context.newPage();
  await secondTab.goto(`/apps/${appId}`);
  await expect(
    secondTab.getByRole("heading", { name: publishedName, exact: true }),
  ).toBeVisible();
  await secondTab.reload();
  await expect(
    secondTab.getByRole("heading", { name: publishedName, exact: true }),
  ).toBeVisible();

  await setScenario(page, "health_batch_mixed");
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await signIn(page, "admin", "admin123");
  await page.goto("/admin?tab=health");
  await expect(page).toHaveURL("/admin?tab=health");
  const monitor = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(monitor).toBeVisible();
  const apps = monitor.getByRole("list", { name: "전체 앱 목록" });
  const initialRows = await apps.getByRole("listitem").count();
  const statistics = page.getByRole("region", { name: "전체 통계" });
  const totals = statistics.getByRole("definition");
  const initialUsers = Number(await totals.nth(0).innerText());
  const initialApps = Number(await totals.nth(2).innerText());
  expect(initialApps).toBe(initialRows);
  const createdRow = apps
    .getByRole("listitem")
    .filter({ hasText: publishedName });
  await expect(createdRow).toHaveCount(1);
  await monitor
    .getByRole("button", { name: "전체 재검사", exact: true })
    .click();
  const summary = monitor.getByRole("region", {
    name: "전체 검사 진행 상황",
  });
  await expect(summary).toContainText("전체 검사 완료", { timeout: 10000 });
  await expect(summary).toContainText(`처리 ${initialRows}/${initialRows}`);

  await page.goto("/admin");
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
  const member = userRow(page);
  await expect(member).toHaveCount(1);
  await expect(member).toContainText("등록 앱 1개");
  await member.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
  const reauth = page.locator('[data-screen-label="관리자 재인증"]');
  const reauthForm = reauth.locator("form");
  await expect(reauthForm).toBeVisible();
  await reauth
    .getByLabel("현재 관리자 비밀번호", { exact: true })
    .fill("admin123");
  await reauthForm
    .getByRole("button", { name: "본인 확인", exact: true })
    .click();
  await expect(page).toHaveURL("/admin");
  const deletion = page.getByRole("region", {
    name: /계정 삭제 확인|계정을 삭제할까요/,
  });
  await expect(deletion).toContainText(`${nickname} 계정을 삭제할까요?`);
  await expect(deletion).toContainText("등록한 앱 1개도 함께 삭제");
  await deletion
    .getByRole("button", { name: "삭제 확인", exact: true })
    .click();
  await expect(deletion.getByRole("status")).toContainText(
    "소유 앱 1개 삭제가 확정됐어요",
  );
  await expect(member).toHaveCount(0);
  await expect(totals.nth(0)).toHaveText(String(initialUsers - 1));
  await expect(totals.nth(2)).toHaveText(String(initialApps - 1));

  await expect(
    secondTab
      .getByRole("alert")
      .filter({ hasText: "아카이브 앱을 찾을 수 없어요" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();

  await secondTab.goto("/__dev/mock-reset");
  await expect(
    secondTab.getByRole("heading", { name: "mock 저장 관리", exact: true }),
  ).toBeVisible();
  await secondTab
    .getByRole("button", { name: "기본 fixture로 명시적 초기화", exact: true })
    .click();
  await expect(secondTab).toHaveURL("/");
  await expect
    .poll(() =>
      secondTab.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key));
        return {
          principal: state.principal_id,
          registeredAccounts: state.registered_accounts.length,
          createdApp: [...state.apps, ...state.private_apps].some(
            (app) => app.name === "T19 공개 수업 도구",
          ),
          healthBatches: state.health_batches.length,
          createdUser: state.registered_accounts.some(
            (account) => account.loginId === "issue49teacher",
          ),
        };
      }, storageKey),
    )
    .toEqual({
      principal: null,
      registeredAccounts: 0,
      createdApp: false,
      healthBatches: 0,
      createdUser: false,
    });
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await secondTab.close();
});

test("explicit reset discards an in-flight app registration response", async ({
  page,
  context,
}) => {
  await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
  await signIn(page, "교사김코딩", "1234");
  const form = await openNewAppForm(page);
  const name = "T19 초기화 후 복원 금지 앱";
  await fillAppForm(form, name);
  await setScenario(page, "app_create_delayed");
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(
    form.getByRole("button", { name: "등록 중…", exact: true }),
  ).toBeDisabled();

  const resetTab = await context.newPage();
  await resetTab.goto("/__dev/mock-reset");
  await expect(
    resetTab.getByRole("heading", { name: "mock 저장 관리", exact: true }),
  ).toBeVisible();
  await resetTab
    .getByRole("button", { name: "기본 fixture로 명시적 초기화", exact: true })
    .click();
  await expect(resetTab).toHaveURL("/");
  await page.clock.fastForward(600);
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const state = JSON.parse(localStorage.getItem(key));
        return {
          principal: state.principal_id,
          registeredAccounts: state.registered_accounts.length,
          createdApp: [...state.apps, ...state.private_apps].some(
            (app) => app.name === "T19 초기화 후 복원 금지 앱",
          ),
          healthBatches: state.health_batches.length,
        };
      }, storageKey),
    )
    .toEqual({
      principal: null,
      registeredAccounts: 0,
      createdApp: false,
      healthBatches: 0,
    });
  await resetTab.close();
});
