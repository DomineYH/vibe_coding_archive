import { expect, test } from "@playwright/test";

test("public gallery opens a detail route and supports refresh and browser history", async ({
  page,
}) => {
  await page.goto("/");
  const app = page.getByRole("link", {
    name: "분수 피자 가게, 교사김코딩, 수학 상세 보기",
  });
  await expect(app).toBeVisible();
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await app.click();
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "앱 열기" })).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.locator("a.card-r")).toHaveCount(16);
});

test("opens public detail directly and rejects an unknown app", async ({
  page,
}) => {
  await page.goto("/apps/00000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await page.goto("/apps/00000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  await expect(page.getByRole("link", { name: "갤러리로" })).toBeVisible();
});

test("gallery navigation is keyboard reachable and controls have accessible names", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "EduVibe 아카이브 홈" }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "갤러리", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "로그인" })).toBeFocused();
  await expect(page.getByLabel("학년 필터")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "앱·작성자 검색" }),
  ).toBeVisible();
});

test("filters search by app, author, and description and distinguishes an empty result", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(16);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("분수 피자");
  await expect(cards).toHaveCount(1);
  await search.fill("no matching app");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("explicitly selects empty and failure scenarios, then lets the visitor retry", async ({
  page,
}) => {
  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("empty");
  await page.getByRole("link", { name: "갤러리로" }).click();
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();

  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("list_failure");
  await page.getByRole("link", { name: "갤러리로" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "공개 아카이브를 불러오지 못했어요",
  );
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "목록을 불러오지 못했어요",
  );
});

test("damaged mock storage is reported until the visitor explicitly resets it", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() =>
    localStorage.setItem("eduvibe-archive-mock-v1", "{"),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "개발용 저장 데이터를 읽거나 저장하지 못했어요",
  );
  await page.getByRole("link", { name: "mock 저장 초기화" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "저장된 mock을 읽지 못했습니다",
  );
  await page
    .getByRole("button", { name: "기본 fixture로 명시적 초기화" })
    .click();
  await expect(page.locator("a.card-r")).toHaveCount(16);
});
