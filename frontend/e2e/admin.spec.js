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
  await expect(panel.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
    "",
  );
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
  await expect(panel.getByLabel("임시 비밀번호", { exact: true })).toHaveValue(
    "",
  );

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
  await page.evaluate(async () => {
    const { setMockScenario } = await import("/src/services/mock/state.ts");
    setMockScenario("original");
  });
  await resumed
    .getByLabel("임시 비밀번호", { exact: true })
    .fill(temporaryPassword);
  await resumed
    .getByLabel("임시 비밀번호 확인", { exact: true })
    .fill(temporaryPassword);
  await resumed
    .getByRole("button", { name: "같은 초기화 요청 다시 제출", exact: true })
    .click();
  await expect(resumed.getByRole("status")).toContainText(
    "임시 비밀번호 설정이 확정됐어요",
  );
  await expect(row).toContainText("버전 2");
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
