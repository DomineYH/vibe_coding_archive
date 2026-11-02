import { expect, test } from "@playwright/test";

const STORAGE_KEY = "eduvibe-archive-mock-v1";
const DONE = "로컬 완료 · 원격 미확인";

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

async function setScenario(page, scenario) {
  await page.goto("/");
  await page.evaluate(
    ({ key, scenario }) => {
      const state = JSON.parse(localStorage.getItem(key));
      localStorage.setItem(key, JSON.stringify({ ...state, scenario }));
    },
    { key: STORAGE_KEY, scenario },
  );
}

async function openBackups(page) {
  await page.goto("/admin?tab=backups");
  const panel = page.getByRole("tabpanel", { name: "백업" });
  await expect(panel).toBeVisible();
  return {
    panel,
    run: panel.getByRole("button", { name: "백업 실행", exact: true }),
    items: panel.getByRole("list", { name: "백업 목록" }).getByRole("listitem"),
  };
}

test("an administrator runs a backup and sees it listed as local-only", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  const { panel, run, items } = await openBackups(page);
  await expect(page.getByRole("tab", { name: "백업" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText(DONE);
  await expect(run).toBeEnabled();
  await run.click();
  await expect(run).toBeDisabled();
  await expect(panel.getByRole("status")).toContainText(DONE, {
    timeout: 10000,
  });
  await expect(items).toHaveCount(2);
  await expect(run).toBeEnabled();
  await expect(panel).not.toContainText("성공");
});

test("an unconfigured backup root disables the run button with its reason", async ({
  page,
}) => {
  await setScenario(page, "backup_unconfigured");
  await login(page, "admin", "admin123");
  const { panel, run } = await openBackups(page);
  await expect(run).toBeDisabled();
  await expect(run).toHaveAccessibleDescription(
    /백업 저장 위치와 수신자 설정이 확인되지 않아/,
  );
  await expect(panel).toContainText("백업 기록이 없어요.");
});

test("a failed backup is reported without adding a list item", async ({
  page,
}) => {
  await setScenario(page, "backup_failed");
  await login(page, "admin", "admin123");
  const { panel, run, items } = await openBackups(page);
  await expect(items).toHaveCount(1);
  await run.click();
  await expect(panel.getByRole("status")).toContainText(
    "최근 백업이 실패했어요",
    { timeout: 10000 },
  );
  await expect(items).toHaveCount(1);
});

for (const width of [360, 390]) {
  test(`the backup list fits a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page, "admin", "admin123");
    const { panel, run, items } = await openBackups(page);
    await run.click();
    await expect(panel.getByRole("status")).toContainText(DONE, {
      timeout: 10000,
    });
    await expect(items).toHaveCount(2);
    await expect(run).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
}
