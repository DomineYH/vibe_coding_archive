import { expect, test } from "@playwright/test";

async function login(page, loginId, password) {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  await form.getByLabel("비밀번호", { exact: true }).fill(password);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function expectNeutralBadge(container) {
  const badge = container.getByLabel("연결 결과: 미검사", { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toContainClass(
    "border-neutral-200 bg-neutral-100 text-neutral-600",
  );
  await expect(badge).not.toHaveClass(/red-/);
  const dot = badge.locator('[aria-hidden="true"]');
  await expect(dot).toContainClass("bg-neutral-600");
  await expect(dot).not.toHaveClass(/red-/);
}

test("new app has neutral unchecked badges in gallery and administrator list", async ({
  page,
}) => {
  const name = "미검사 배지 회귀 수업 도구";
  await login(page, "교사김코딩", "1234");
  await page
    .getByRole("navigation", { name: "주 메뉴" })
    .getByRole("link", { name: "앱 등록", exact: true })
    .click();
  const form = page.getByRole("form", { name: "새 앱 등록 양식", exact: true });
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://status-badge.example.org/class");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("학생이 수업 풀이를 설명하는 도구를 만들어줘.");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("학생이 풀이 과정을 함께 설명하고 공유합니다.");
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
  await page.getByRole("button", { name: "갤러리로", exact: true }).click();
  const card = page.getByRole("link", {
    name: `${name}, 교사김코딩, 수학 상세 보기`,
    exact: true,
  });
  await expectNeutralBadge(card);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await login(page, "admin", "admin123");
  await page.goto("/admin?tab=health");
  const panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  const row = panel
    .getByRole("list", { name: "전체 앱 목록" })
    .getByRole("listitem")
    .filter({ hasText: name });
  await expectNeutralBadge(row);
});
