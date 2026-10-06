import { expect, test } from "@playwright/test";

const MEMBER_ID = "00000000-0000-4000-8000-000000000101";
const PENDING_ID = "00000000-0000-4000-8000-000000000102";
const STORAGE_KEY = "eduvibe-archive-mock-v1";

async function login(page, loginId, password) {
  await page.goto("/auth?mode=login");
  const form = page.locator("form");
  await expect(page).toHaveURL(/\/auth\?mode=login/);
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  const passwordInput = form.getByLabel("비밀번호", { exact: true });
  await passwordInput.fill(password);
  await passwordInput.press("Enter");
}

function userRow(page, nickname) {
  return page
    .getByRole("listitem")
    .filter({ has: page.getByText(nickname, { exact: true }) });
}

function userDeletePanel(page) {
  return page.getByRole("region", {
    name: /계정 삭제 확인|계정을 삭제할까요/,
  });
}

async function deleteAfterReauthentication(page, nickname) {
  const row = userRow(page, nickname);
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
  const reauth = page.locator('[data-screen-label="관리자 재인증"]');
  const form = reauth.locator("form");
  await expect(form).toBeVisible();
  await reauth
    .getByLabel("현재 관리자 비밀번호", { exact: true })
    .fill("admin123");
  await form.getByRole("button", { name: "본인 확인", exact: true }).click();
  await expect(page).toHaveURL("/admin");
  const panel = userDeletePanel(page);
  await expect(panel).toContainText(`${nickname} 계정을 삭제할까요?`);
  return { row, panel };
}

async function openApproval(page, nickname, action, confirmation) {
  const row = userRow(page, nickname);
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: action, exact: true }).click();
  const panel = page.getByRole("region", { name: /회원 승인 확인/ });
  await expect(panel).toContainText("대상 버전:");
  await panel.getByRole("button", { name: confirmation, exact: true }).click();
  return { row, panel };
}

test("an approved member can log in and loses access after approval is revoked", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  await expect(
    page.getByRole("heading", { name: "관리자 대시보드" }),
  ).toBeVisible();
  const statistics = page.getByRole("region", { name: "전체 통계" });
  await expect(statistics).toContainText("7");
  await expect(statistics).toContainText("2");
  await expect(statistics).toContainText("15 / 17");

  const { row: pendingRow, panel } = await openApproval(
    page,
    "비기너개발자",
    "승인하기",
    "승인하기 확인",
  );
  await expect(panel.getByRole("status")).toContainText(
    "요청한 승인 상태가 확정됐어요",
  );
  await expect(pendingRow).toContainText("로그인 아이디: 비기너개발자");
  await expect(pendingRow).toContainText("버전 2");
  await expect(statistics).toContainText("1");

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "비기너개발자", "1234");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { panel: revokePanel } = await openApproval(
    page,
    "비기너개발자",
    "승인 해제",
    "승인 해제 확인",
  );
  await expect(revokePanel.getByRole("status")).toContainText(
    "요청한 승인 상태가 확정됐어요",
  );
  await expect(statistics).toContainText("2");

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "비기너개발자", "1234");
  await expect(page.getByRole("alert")).toContainText(
    "승인 대기 중인 계정입니다",
  );
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toHaveCount(0);
});

test("non-admins are denied and the protected admin account has no approval control", async ({
  page,
}) => {
  await login(page, "교사김코딩", "1234");
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const protectedRow = userRow(page, "아카이브 관리자");
  await expect(protectedRow).toContainText("보호된 계정");
  await expect(protectedRow.getByRole("button")).toHaveCount(0);
});

test("admins see the complete public and private app monitor summaries", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin?tab=health");

  const healthTab = page.getByRole("tab", {
    name: "Health Monitor",
    exact: true,
  });
  await expect(healthTab).toBeVisible();
  await expect(healthTab).toHaveAttribute("aria-current", "page");
  const statistics = page.getByRole("region", { name: "전체 통계" });
  await expect(statistics).toContainText("15 / 17");

  const list = page.getByRole("list", { name: "전체 앱 목록" });
  await expect(list).toBeVisible();
  const privateRow = list
    .getByRole("listitem")
    .filter({ hasText: "과학 수행평가 루브릭 채점기" });
  await expect(privateRow).toHaveCount(1);
  await expect(privateRow).toContainText("교사김코딩");
  await expect(privateRow).toContainText("비공개");
  await expect(privateRow).toContainText("rubric-grader.vercel.app");
  await expect(privateRow).toContainText("버전 1");
  await expect(
    privateRow.getByLabel("연결 결과: 정상", { exact: true }),
  ).toBeVisible();
  await expect(privateRow).not.toContainText(
    "교사 전용 수행평가 루브릭 채점 도구",
  );
  await expect(privateRow).not.toContainText("학생 명렬");
  const checkAll = page.getByRole("button", {
    name: "전체 재검사",
    exact: true,
  });
  const checkOne = privateRow.getByRole("button", {
    name: "즉시 재검사",
    exact: true,
  });
  await expect(checkAll).toBeEnabled();
  await expect(checkOne).toBeDisabled();
  await expect(checkAll).toHaveAccessibleDescription(
    "새 전체 검사는 이 버튼을 눌렀을 때 시작합니다.",
  );
  await expect(checkOne).toHaveAccessibleDescription(
    "개별 재검사는 아직 사용할 수 없어요.",
  );
});

test("member password reset requires reauthentication and an explicit submit", async ({
  page,
}) => {
  const temporaryPassword = "New temporary password for issue 44!";
  const replacementPassword = "Member chosen password after reset 44!";
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const row = userRow(page, "교사김코딩");
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
    .click();

  await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
  expect(page.url()).not.toContain(MEMBER_ID);
  const reauth = page.locator('[data-screen-label="관리자 재인증"]');
  const reauthForm = reauth.locator("form");
  await expect(reauthForm).toBeVisible();
  const reauthPassword = reauth.getByLabel("현재 관리자 비밀번호", {
    exact: true,
  });
  await reauthPassword.fill("incorrect admin password");
  const verifyAdmin = reauthForm.getByRole("button", {
    name: "본인 확인",
    exact: true,
  });
  await verifyAdmin.focus();
  await expect(verifyAdmin).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(reauth.getByRole("alert")).toContainText(
    "현재 로그인은 유지됩니다",
  );
  await expect(reauthPassword).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();

  await reauthPassword.fill("admin123");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/admin");
  const panel = page.getByRole("region", { name: /임시 비밀번호 초기화 확인/ });
  const resetForm = panel.locator("form");
  const temporaryInput = panel.getByLabel("임시 비밀번호", { exact: true });
  await expect(resetForm).toBeVisible();
  await expect(temporaryInput).toHaveValue("");
  await expect(row).toContainText("버전 1");
  expect(
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.credential_overrides.some(
        (item) => item.account_id === "00000000-0000-4000-8000-000000000101",
      );
    }, STORAGE_KEY),
  ).toBe(false);

  await temporaryInput.fill(temporaryPassword);
  await panel
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  const confirmReset = resetForm.getByRole("button", {
    name: "초기화 확인",
    exact: true,
  });
  await confirmReset.focus();
  await expect(confirmReset).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status")).toContainText(
    "임시 비밀번호 설정이 확정됐어요",
  );
  await expect(panel.getByText(/본인 비밀번호 변경 기한/)).toBeVisible();
  expect(
    await page.evaluate(
      ({ key, password }) => {
        const raw = localStorage.getItem(key);
        const state = JSON.parse(raw);
        const member = state.admin_users.find(
          (user) => user.id === "00000000-0000-4000-8000-000000000101",
        );
        const credential = state.credential_overrides.find(
          (item) => item.account_id === member.id,
        );
        return {
          includesPassword: raw.includes(password),
          approved: member.approved,
          version: member.account_version,
          mustChangePassword: credential.must_change_password,
        };
      },
      { key: STORAGE_KEY, password: temporaryPassword },
    ),
  ).toEqual({
    includesPassword: false,
    approved: true,
    version: 2,
    mustChangePassword: true,
  });

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  const loginForm = page.locator('[data-screen-label="로그인"] form');
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(loginForm).toBeVisible();
  await loginForm
    .getByLabel("로그인 아이디", { exact: true })
    .fill("교사김코딩");
  await loginForm.getByLabel("비밀번호", { exact: true }).fill("1234");
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(loginForm.getByRole("alert")).toContainText(
    "로그인 아이디 또는 비밀번호를 확인해 주세요",
  );
  await loginForm
    .getByLabel("비밀번호", { exact: true })
    .fill(temporaryPassword);
  await loginForm.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL(/mode=password-change/);
  const changeForm = page.locator('[data-screen-label="비밀번호 변경"] form');
  await expect(changeForm).toBeVisible();
  await changeForm.locator("#new-password").fill(replacementPassword);
  await changeForm.locator("#new-password-confirm").fill(replacementPassword);
  await changeForm
    .getByRole("button", { name: "비밀번호 변경", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  const replacementLogin = page.locator('[data-screen-label="로그인"] form');
  await expect(replacementLogin).toBeVisible();
  await replacementLogin
    .getByLabel("로그인 아이디", { exact: true })
    .fill("교사김코딩");
  await replacementLogin
    .getByLabel("비밀번호", { exact: true })
    .fill(replacementPassword);
  await replacementLogin
    .getByRole("button", { name: "로그인", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
});

test("member deletion reauthenticates, preserves cancellation, and removes owned apps", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const statistics = page.getByRole("region", { name: "전체 통계" });
  const row = userRow(page, "교사김코딩");
  await expect(row).toHaveCount(1);
  const deleteButton = row.getByRole("button", { name: "삭제", exact: true });
  await deleteButton.focus();
  await expect(deleteButton).toBeFocused();
  await page.keyboard.press("Enter");
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

  let panel = userDeletePanel(page);
  await expect(panel).toContainText("교사김코딩 계정을 삭제할까요?");
  const appCountText = (await row.innerText()).match(/등록 앱 (\d+)개/);
  expect(appCountText).not.toBeNull();
  const appCount = Number(appCountText[1]);
  expect(appCount).toBeGreaterThan(0);
  await expect(panel).toContainText(`등록한 앱 ${appCount}개도 함께 삭제`);
  await expect(panel).toContainText("로그인 아이디: 교사김코딩");
  await panel.getByRole("button", { name: "취소", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(row).toHaveCount(1);
  await expect(statistics.getByText("7", { exact: true })).toBeVisible();
  await expect(statistics.getByText("17", { exact: true })).toBeVisible();

  panel = (await deleteAfterReauthentication(page, "교사김코딩")).panel;
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    `소유 앱 ${appCount}개 삭제가 확정됐어요`,
  );
  await expect(row).toHaveCount(0);
  await expect(statistics.getByText("6", { exact: true })).toBeVisible();
  await expect(
    statistics.getByText(String(17 - appCount), { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      const id = "00000000-0000-4000-8000-000000000101";
      return {
        member: state.admin_users.some((user) => user.id === id),
        ownedApps: [...state.apps, ...state.private_apps].filter(
          (app) => app.owner.id === id,
        ).length,
      };
    }, STORAGE_KEY),
  ).toEqual({ member: false, ownedApps: 0 });

  await page.goto("/admin?tab=health");
  const allApps = page.getByRole("list", { name: "전체 앱 목록" });
  await expect(allApps.getByRole("listitem")).toHaveCount(17 - appCount);
  await expect(allApps).not.toContainText("교사김코딩");
});

test("app-count conflict requires an explicit current-member refresh", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { panel } = await deleteAfterReauthentication(page, "교사김코딩");
  const row = userRow(page, "교사김코딩");
  const originalAppCount = Number(
    (await row.innerText()).match(/등록 앱 (\d+)개/)[1],
  );
  expect(originalAppCount).toBeGreaterThan(0);
  await page.evaluate(
    ({ key, accountId }) => {
      const state = JSON.parse(localStorage.getItem(key));
      const listName = ["apps", "private_apps"].find((name) =>
        state[name].some((app) => app.owner.id === accountId),
      );
      const index = state[listName].findIndex(
        (app) => app.owner.id === accountId,
      );
      state[listName].splice(index, 1);
      localStorage.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    },
    { key: STORAGE_KEY, accountId: "00000000-0000-4000-8000-000000000101" },
  );

  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "소유 앱 수가 바뀌었어요",
  );
  await panel
    .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
    .click();
  await expect(panel).toContainText(
    `등록한 앱 ${originalAppCount - 1}개도 함께 삭제`,
  );
  await panel.getByRole("button", { name: "취소", exact: true }).click();
  await expect(row).toHaveCount(1);
});

test("unknown deletion result needs lookup and an explicit same-key retry", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { row, panel } = await deleteAfterReauthentication(page, "교사김코딩");
  await page.evaluate(async () => {
    const { adminService } = await import("/src/services/mock/admin.ts");
    const { ServiceError } = await import("/src/services/service-error.ts");
    const original = adminService.deleteUser.bind(adminService);
    let first = true;
    adminService.deleteUser = async (...args) => {
      if (first) {
        first = false;
        throw new ServiceError("NETWORK_ERROR", "응답을 확인할 수 없어요.", {
          outcome: "unknown",
        });
      }
      return original(...args);
    };
  });
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제 결과가 아직 확정되지 않았어요",
  );
  await expect(row).toHaveCount(1);

  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제 결과가 아직 확정되지 않았어요",
  );
  await panel
    .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "같은 삭제 요청 다시 제출", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("삭제가 확정됐어요");
  await expect(row).toHaveCount(0);
});

test("a lost delete response is resolved with its issued key without replay", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { setMockScenario } = await import("/src/services/mock/state.ts");
    setMockScenario("admin_delete_unknown");
  });
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { row, panel } = await deleteAfterReauthentication(page, "교사김코딩");
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("삭제가 확정됐어요");
  await expect(row).toHaveCount(0);
  expect(
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      return {
        memberExists: state.admin_users.some(
          (user) => user.id === "00000000-0000-4000-8000-000000000101",
        ),
        ownedApps: [...state.apps, ...state.private_apps].filter(
          (app) => app.owner.id === "00000000-0000-4000-8000-000000000101",
        ).length,
      };
    }, STORAGE_KEY),
  ).toEqual({ memberExists: false, ownedApps: 0 });
});

test("pending deletion confirmation stays distinct and resolves by its known key", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const { setMockScenario } = await import("/src/services/mock/state.ts");
    setMockScenario("admin_delete_pending_confirmation");
  });
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { row, panel } = await deleteAfterReauthentication(page, "교사김코딩");
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제는 반영됐고 별도 확인을 기다리고 있어요",
  );
  await expect(
    panel.getByRole("button", {
      name: "같은 삭제 요청 다시 제출",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(row).toHaveCount(0);
  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제는 반영됐고 별도 확인을 기다리고 있어요",
  );
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.mock_now = "2026-09-22T00:13:00.000Z";
    localStorage.setItem(key, JSON.stringify(state));
  }, STORAGE_KEY);
  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("삭제가 확정됐어요");
});

test("reauthenticating an expired recent-auth delete preserves its key without replay", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { row, panel } = await deleteAfterReauthentication(page, "교사김코딩");
  await page.evaluate(async () => {
    const { adminService } = await import("/src/services/mock/admin.ts");
    const { ServiceError } = await import("/src/services/service-error.ts");
    const original = adminService.deleteUser.bind(adminService);
    let first = true;
    adminService.deleteUser = async (...args) => {
      if (first) {
        first = false;
        throw new ServiceError("NETWORK_ERROR", "응답을 확인할 수 없어요.", {
          outcome: "unknown",
        });
      }
      return original(...args);
    };
  });
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제 결과가 아직 확정되지 않았어요",
  );
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.mock_now = "2026-09-22T00:28:00.000Z";
    localStorage.setItem(key, JSON.stringify(state));
  }, STORAGE_KEY);
  await panel
    .getByRole("button", { name: "현재 회원 정보 다시 확인", exact: true })
    .click();
  await panel
    .getByRole("button", { name: "같은 삭제 요청 다시 제출", exact: true })
    .click();
  await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
  const reauth = page.locator('[data-screen-label="관리자 재인증"]');
  const form = reauth.locator("form");
  await expect(form).toBeVisible();
  await reauth
    .getByLabel("현재 관리자 비밀번호", { exact: true })
    .fill("admin123");
  await form.getByRole("button", { name: "본인 확인", exact: true }).click();
  await expect(page).toHaveURL("/admin");
  const resumedPanel = userDeletePanel(page);
  await expect(resumedPanel.getByRole("status")).toContainText(
    "삭제 결과가 아직 확정되지 않았어요",
  );
  await expect(row).toHaveCount(1);

  await resumedPanel
    .getByRole("button", { name: "같은 삭제 요청 다시 제출", exact: true })
    .click();
  await expect(resumedPanel.getByRole("status")).toContainText(
    "삭제가 확정됐어요",
  );
  await expect(row).toHaveCount(0);
});

test("a delayed delete cannot apply after the admin permission changes", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
  await page.goto("/");
  await page.evaluate(async () => {
    const { setMockScenario } = await import("/src/services/mock/state.ts");
    setMockScenario("admin_delete_delayed");
  });
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const { panel } = await deleteAfterReauthentication(page, "교사김코딩");
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "삭제 결과가 아직 확정되지 않았어요",
  );
  await page.evaluate(async (memberId) => {
    const { setMockPrincipal } = await import("/src/services/mock/state.ts");
    setMockPrincipal(memberId);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "eduvibe-archive-mock-v1" }),
    );
  }, MEMBER_ID);
  await page.clock.fastForward(600);
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");
  expect(
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      return state.admin_users.some(
        (user) => user.id === "00000000-0000-4000-8000-000000000101",
      );
    }, STORAGE_KEY),
  ).toBe(true);
});

test("unknown password-reset results require explicit query, same-key retry, or cancel", async ({
  page,
}) => {
  const temporaryPassword = "Temporary password for unresolved 44!";
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_unresolved" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const row = userRow(page, "교사김코딩");
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
    .click();
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

  const panel = page.getByRole("region", { name: /임시 비밀번호 초기화 확인/ });
  const resetForm = panel.locator("form");
  await expect(resetForm).toBeVisible();
  await panel
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await panel
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await resetForm
    .getByRole("button", { name: "초기화 확인", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await expect(panel.getByLabel("임시 비밀번호", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    panel.getByLabel("임시 비밀번호 확인", { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: "같은 초기화 요청 다시 제출",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      ({ key, password }) => localStorage.getItem(key).includes(password),
      { key: STORAGE_KEY, password: temporaryPassword },
    ),
  ).toBe(false);

  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await expect(panel.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    panel.getByLabel("임시 비밀번호 확인", { exact: true }),
  ).toHaveValue("");
  await panel
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await panel
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await panel
    .getByRole("button", { name: "같은 초기화 요청 다시 제출", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await panel
    .getByRole("button", { name: "초기화 요청 취소", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "초기화 요청 취소가 확정됐어요",
  );
  await expect(row).toContainText("버전 1");
});

test("a lost reset response stays unknown until the member operation is read", async ({
  page,
}) => {
  const temporaryPassword = "Confirmed after response loss 44!";
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_unknown" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const row = userRow(page, "교사김코딩");
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
    .click();
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

  const panel = page.getByRole("region", { name: /임시 비밀번호 초기화 확인/ });
  const resetForm = panel.locator("form");
  await expect(resetForm).toBeVisible();
  await panel
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await panel
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await resetForm
    .getByRole("button", { name: "초기화 확인", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await expect(row).toContainText("버전 1");
  await expect(
    userRow(page, "비기너개발자").getByRole("button", {
      name: "승인하기",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(panel.getByLabel("임시 비밀번호", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    panel.getByLabel("임시 비밀번호 확인", { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: "같은 초기화 요청 다시 제출",
      exact: true,
    }),
  ).toHaveCount(0);

  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "임시 비밀번호 설정이 확정됐어요",
  );
  await expect(row).toContainText("버전 2");
  expect(
    await page.evaluate(
      ({ key, password }) => localStorage.getItem(key).includes(password),
      { key: STORAGE_KEY, password: temporaryPassword },
    ),
  ).toBe(false);
});

test("a delayed password reset is rejected after the admin session changes", async ({
  page,
}) => {
  const temporaryPassword = "Must not apply after auth changes 44!";
  await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_delayed" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const row = userRow(page, "교사김코딩");
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
    .click();
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

  const panel = page.getByRole("region", { name: /임시 비밀번호 초기화 확인/ });
  const resetForm = panel.locator("form");
  await expect(resetForm).toBeVisible();
  await panel
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await panel
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await resetForm
    .getByRole("button", { name: "초기화 확인", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await page.evaluate(async (memberId) => {
    const { setMockPrincipal } = await import("/src/services/mock/state.ts");
    setMockPrincipal(memberId);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "eduvibe-archive-mock-v1" }),
    );
  }, MEMBER_ID);
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");
  await page.clock.fastForward(1000);
  expect(
    await page.evaluate((key) => {
      const state = JSON.parse(localStorage.getItem(key));
      const member = state.admin_users.find(
        (user) => user.id === "00000000-0000-4000-8000-000000000101",
      );
      return {
        principal: state.principal_id,
        version: member.account_version,
        credential: state.credential_overrides.some(
          (item) => item.account_id === member.id,
        ),
      };
    }, STORAGE_KEY),
  ).toEqual({ principal: MEMBER_ID, version: 1, credential: false });
});

test("reauthenticating an expired recent-auth reset preserves its key without replay", async ({
  page,
}) => {
  const temporaryPassword = "Same-key password after reauth 44!";
  await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_delayed" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const row = userRow(page, "교사김코딩");
  await expect(row).toHaveCount(1);
  await row
    .getByRole("button", { name: "임시 비밀번호 설정", exact: true })
    .click();
  await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
  const firstReauth = page.locator('[data-screen-label="관리자 재인증"]');
  const firstForm = firstReauth.locator("form");
  await expect(firstForm).toBeVisible();
  await firstReauth
    .getByLabel("현재 관리자 비밀번호", { exact: true })
    .fill("admin123");
  await firstForm
    .getByRole("button", { name: "본인 확인", exact: true })
    .click();
  await expect(page).toHaveURL("/admin");

  await page.evaluate(async () => {
    const { adminService } = await import("/src/services/mock/admin.ts");
    const trace = { issued: [], executed: [], reads: [] };
    window.resetTrace = trace;
    const issue = adminService.createPasswordResetOperation;
    adminService.createPasswordResetOperation = async (...args) => {
      const operation = await issue(...args);
      trace.issued.push(operation.key);
      return operation;
    };
    const execute = adminService.setPasswordReset;
    adminService.setPasswordReset = (...args) => {
      trace.executed.push(args[3]);
      return execute(...args);
    };
    for (const name of ["getPasswordResetOperation", "getUser"]) {
      const read = adminService[name];
      adminService[name] = (...args) => {
        trace.reads.push(name);
        return read(...args);
      };
    }
  });

  const panel = page.getByRole("region", { name: /임시 비밀번호 초기화 확인/ });
  const resetForm = panel.locator("form");
  await expect(resetForm).toBeVisible();
  await panel
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await panel
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await resetForm
    .getByRole("button", { name: "초기화 확인", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-busy", "true");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, mock_now: "2026-09-22T00:28:00.000Z" }),
    );
  }, STORAGE_KEY);
  await page.clock.fastForward(1000);
  await expect(page).toHaveURL(/\/auth\?mode=reauth&return_to=%2Fadmin/);
  const secondReauth = page.locator('[data-screen-label="관리자 재인증"]');
  const secondForm = secondReauth.locator("form");
  await expect(secondForm).toBeVisible();
  await secondReauth
    .getByLabel("현재 관리자 비밀번호", { exact: true })
    .fill("admin123");
  await page.evaluate(() => {
    window.resetTrace.reads = [];
  });
  await secondForm
    .getByRole("button", { name: "본인 확인", exact: true })
    .click();
  await expect(page).toHaveURL("/admin");

  const resumed = page.getByRole("region", {
    name: /임시 비밀번호 초기화 확인/,
  });
  await expect(resumed.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await expect(
    resumed.getByLabel("임시 비밀번호", { exact: true }),
  ).toHaveValue("");
  await expect(row).toContainText("버전 1");
  await expect(
    resumed.getByLabel("임시 비밀번호 확인", { exact: true }),
  ).toHaveValue("");
  await expect(
    resumed.getByRole("button", {
      name: "같은 초기화 요청 다시 제출",
      exact: true,
    }),
  ).toBeEnabled();
  const beforeRetry = await page.evaluate(() => window.resetTrace);
  expect(beforeRetry.issued).toHaveLength(1);
  expect(beforeRetry.executed).toEqual(beforeRetry.issued);
  const targetRead = beforeRetry.reads.indexOf("getUser");
  expect(targetRead).toBeGreaterThan(0);
  expect(beforeRetry.reads.slice(0, targetRead)).toEqual(
    Array(targetRead).fill("getPasswordResetOperation"),
  );
  expect(
    await page.evaluate(
      (password) =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
          state: history.state,
        }).includes(password),
      temporaryPassword,
    ),
  ).toBe(false);
  await resumed
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await resumed
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await resumed
    .getByRole("button", { name: "같은 초기화 요청 다시 제출", exact: true })
    .click();
  await expect(resumed).toHaveAttribute("aria-busy", "true");
  await page.clock.fastForward(1000);
  await expect(resumed.getByRole("status")).toContainText(
    "임시 비밀번호 설정이 확정됐어요",
  );
  await expect(row).toContainText("버전 2");
  const afterRetry = await page.evaluate(() => window.resetTrace);
  expect(afterRetry.issued).toEqual(beforeRetry.issued);
  expect(afterRetry.executed).toEqual([
    beforeRetry.issued[0],
    beforeRetry.issued[0],
  ]);
  await expect(
    resumed.getByLabel("임시 비밀번호", { exact: true }),
  ).toHaveCount(0);
});

test("unknown approval results require explicit query, same-key resubmit, or cancel", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_unresolved" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");

  const row = userRow(page, "비기너개발자");
  await expect(row).toHaveCount(1);
  const startApproval = row.getByRole("button", {
    name: "승인하기",
    exact: true,
  });
  await startApproval.focus();
  await expect(startApproval).toBeFocused();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("region", { name: /회원 승인 확인/ });
  await expect(panel).toContainText("대상 버전: 1");
  const confirmApproval = panel.getByRole("button", {
    name: "승인하기 확인",
    exact: true,
  });
  await confirmApproval.focus();
  await expect(confirmApproval).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );

  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await panel
    .getByRole("button", { name: "같은 승인 요청 다시 제출", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );
  await panel
    .getByRole("button", { name: "승인 요청 취소", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "승인 요청을 취소했어요",
  );
  await expect(row.getByText("승인 대기", { exact: true })).toBeVisible();
});

test("expired approval keys stay unknown and require a current-state recheck", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_unresolved" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");

  const row = userRow(page, "비기너개발자");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "승인하기", exact: true }).click();
  const panel = page.getByRole("region", { name: /회원 승인 확인/ });
  await panel
    .getByRole("button", { name: "승인하기 확인", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText(
    "처리 결과가 아직 확정되지 않았어요",
  );

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({
        ...state,
        approval_operations: state.approval_operations.map((operation) => ({
          ...operation,
          issued_at: "2000-01-01T00:00:00.000Z",
          expires_at: "2000-01-02T00:00:00.000Z",
        })),
      }),
    );
  }, STORAGE_KEY);
  await panel.getByRole("button", { name: "결과 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "작업 키가 만료되어 과거 결과를 확인할 수 없어요",
  );
  await expect(
    panel.getByRole("button", {
      name: "같은 승인 요청 다시 제출",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", { name: "승인 요청 취소", exact: true }),
  ).toHaveCount(0);

  await panel
    .getByRole("button", { name: "현재 회원 상태 다시 확인", exact: true })
    .click();
  await expect(panel).toContainText("대상 버전: 1");
  await expect(
    panel.getByRole("button", { name: "승인하기 확인", exact: true }),
  ).toBeVisible();
  await expect(row.getByText("승인 대기", { exact: true })).toBeVisible();
});

test("list failures retry and offset pages keep their rows on an additional-load error", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(async (key) => {
    const { authService } = await import("/src/services/mock/auth.ts");
    for (let index = 0; index < 18; index += 1) {
      await authService.register({
        loginId: `extra-teacher-${String(index).padStart(2, "0")}`,
        password: "a sufficiently long fake password",
        nickname: `새 회원 ${index}`,
      });
    }
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_list_failure" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText(
    "사용자 목록과 통계를 불러오지 못했어요",
  );

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_more_failure" }),
    );
  }, STORAGE_KEY);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  const users = page.getByRole("list", { name: "회원 목록" });
  await expect(users.getByRole("listitem")).toHaveCount(24);
  await page.getByRole("button", { name: /추가 회원 불러오기/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "표시된 목록은 유지됩니다",
  );
  await expect(users.getByRole("listitem")).toHaveCount(24);

  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "original" }),
    );
  }, STORAGE_KEY);
  await page
    .getByRole("button", { name: "추가 회원 다시 불러오기", exact: true })
    .click();
  await expect(users.getByRole("listitem")).toHaveCount(25);
  await expect(page.getByRole("region", { name: "전체 통계" })).toContainText(
    "25",
  );
});

test("a late approval response is rejected after the auth flow changes", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "admin_write_delayed" }),
    );
  }, STORAGE_KEY);
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const row = userRow(page, "비기너개발자");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "승인하기", exact: true }).click();
  const panel = page.getByRole("region", { name: /회원 승인 확인/ });
  await panel
    .getByRole("button", { name: "승인하기 확인", exact: true })
    .click();
  await expect(panel).toHaveAttribute("aria-busy", "true");

  await page.evaluate(async (memberId) => {
    const { setMockPrincipal } = await import("/src/services/mock/state.ts");
    setMockPrincipal(memberId);
    window.dispatchEvent(
      new StorageEvent("storage", { key: "eduvibe-archive-mock-v1" }),
    );
  }, MEMBER_ID);
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");
  expect(
    await page.evaluate(
      ({ key, targetId }) => {
        const state = JSON.parse(localStorage.getItem(key));
        return {
          principal: state.principal_id,
          approved: state.admin_users.find((user) => user.id === targetId)
            .approved,
        };
      },
      { key: STORAGE_KEY, targetId: PENDING_ID },
    ),
  ).toEqual({ principal: MEMBER_ID, approved: false });
});
