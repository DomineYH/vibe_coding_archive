import { expect, test } from "@playwright/test";

const historyAppId = "00000000-0000-4000-8000-000000000013";

async function login(page, loginId, password = "1234") {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  await form.getByLabel("비밀번호", { exact: true }).fill(password);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "로그아웃", exact: true }),
  ).toBeVisible();
}

function userRow(page, nickname) {
  return page
    .getByRole("list", { name: "회원 목록", exact: true })
    .getByRole("listitem")
    .filter({ has: page.getByText(nickname, { exact: true }) });
}

test("fixture ownership gives history edit and delete controls only to its owner", async ({
  page,
}) => {
  await login(page, "과학덕후박샘");
  await page.goto(`/apps/${historyAppId}`);
  await expect(
    page.getByRole("heading", { name: "조선왕조 인터랙티브 타임라인" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByText("역사수업연구가"),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "앱 편집", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "삭제", exact: true }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await login(page, "역사수업연구가");
  await page.goto(`/apps/${historyAppId}`);
  await expect(
    page.getByRole("link", { name: "앱 편집", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "삭제", exact: true }),
  ).toBeVisible();
});

test("fixture counts remain correct and deleting a pending member preserves all apps", async ({
  page,
}) => {
  await login(page, "admin", "admin123");
  await page.goto("/admin");
  const statistics = page.getByRole("region", { name: "전체 통계" });
  await expect(statistics.getByText("7", { exact: true })).toBeVisible();
  await expect(statistics.getByText("2", { exact: true })).toBeVisible();
  await expect(statistics).toContainText("15 / 17");
  for (const [nickname, count] of [
    ["교사김코딩", 6],
    ["과학덕후박샘", 4],
    ["역사수업연구가", 4],
    ["영어쌤제이", 3],
    ["비기너개발자", 0],
    ["코딩꿈나무", 0],
    ["아카이브 관리자", 0],
  ]) {
    await expect(userRow(page, nickname)).toContainText(`등록 앱 ${count}개`);
  }

  await page.evaluate(async () => {
    const { authService } = await import("/src/services/mock/auth.ts");
    await authService.reauthenticate({ password: "admin123" });
  });
  const pending = userRow(page, "비기너개발자");
  await pending.getByRole("button", { name: "삭제", exact: true }).click();
  await expect(page).toHaveURL("/admin");
  const panel = page.getByRole("region", {
    name: /계정 삭제 확인|계정을 삭제할까요/,
  });
  await expect(panel).toContainText("비기너개발자 계정을 삭제할까요?");
  await expect(panel).toContainText("등록한 앱 0개도 함께 삭제");
  await panel.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText(
    "소유 앱 0개 삭제가 확정됐어요",
  );
  await expect(pending).toHaveCount(0);
  await expect(statistics.getByText("6", { exact: true })).toBeVisible();
  await expect(statistics).toContainText("15 / 17");
  await expect(userRow(page, "과학덕후박샘")).toContainText("등록 앱 4개");

  await page.goto("/admin?tab=health");
  const apps = page.getByRole("list", { name: "전체 앱 목록", exact: true });
  await expect(apps.getByRole("listitem")).toHaveCount(17);
  await expect(
    apps.getByText("작성자 과학덕후박샘", { exact: true }),
  ).toHaveCount(4);
  await expect(
    apps.getByText("작성자 역사수업연구가", { exact: true }),
  ).toHaveCount(4);
});
