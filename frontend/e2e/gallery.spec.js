import { expect, test } from "@playwright/test";

async function tabTo(page, target, maxTabs = 40) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((element) => element === document.activeElement))
      return;
  }
  throw new Error("Tab did not reach the requested control");
}

test("public gallery opens a detail route and supports refresh and browser history", async ({
  page,
}) => {
  await page.goto("/");
  const app = page.getByRole("link", {
    name: "분수 피자 가게, 교사김코딩, 수학 상세 보기",
  });
  await expect(app).toBeVisible();
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await tabTo(page, app);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  const open = page.getByRole("link", { name: "앱 열기" });
  await expect(open).toHaveAccessibleName("앱 열기");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
  for (const [action, name] of [
    [page.getByRole("link", { name: "갤러리로" }), "갤러리로"],
    [page.getByRole("button", { name: "복사하기" }), "복사하기"],
    [page.getByRole("button", { name: "연결 다시 확인" }), "연결 다시 확인"],
  ]) {
    await expect(action).toHaveAccessibleName(name);
    await tabTo(page, action);
    await expect(action).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "실제 연결 검사는 실행하지 않았어요",
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
  const validStorage = await page.evaluate(() =>
    localStorage.getItem("eduvibe-archive-mock-v1"),
  );
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...state, apps: [{}] }));
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "개발용 저장 데이터를 읽거나 저장하지 못했어요",
  );
  const retry = page.getByRole("button", { name: "다시 시도" });
  const resetLink = page.getByRole("link", { name: "mock 저장 초기화" });
  await expect(retry).toHaveAccessibleName("다시 시도");
  await expect(resetLink).toHaveAccessibleName("mock 저장 초기화");
  await tabTo(page, resetLink);
  await expect(resetLink).toBeFocused();
  await tabTo(page, retry);
  await expect(retry).toBeFocused();
  await page.evaluate((value) => {
    localStorage.setItem("eduvibe-archive-mock-v1", value);
  }, validStorage);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();

  await page.goto("/apps/00000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  const back = page.getByRole("link", { name: "갤러리로" });
  await expect(back).toHaveAccessibleName("갤러리로");
  await tabTo(page, back);
  await expect(back).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("a.card-r")).toHaveCount(16);
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

  const subjectFilters = page.getByRole("group", { name: "과목 필터" });
  await expect(subjectFilters).toBeVisible();
  for (const name of ["전체", "수학", "과학", "영어", "역사"]) {
    const filter = subjectFilters.getByRole("button", { name, exact: true });
    await expect(filter).toHaveAccessibleName(name);
    await expect(filter).toHaveAttribute(
      "aria-pressed",
      name === "전체" ? "true" : "false",
    );
    await tabTo(page, filter);
    await expect(filter).toBeFocused();
  }
  const mathFilter = subjectFilters.getByRole("button", {
    name: "수학",
    exact: true,
  });
  await tabTo(page, mathFilter);
  await page.keyboard.press("Enter");
  await expect(mathFilter).toHaveAttribute("aria-pressed", "true");
  const allFilter = subjectFilters.getByRole("button", {
    name: "전체",
    exact: true,
  });
  await tabTo(page, allFilter);
  await page.keyboard.press("Enter");
  await expect(allFilter).toHaveAttribute("aria-pressed", "true");

  const grade = page.getByRole("combobox", { name: "학년 필터" });
  await expect(grade).toHaveAccessibleName("학년 필터");
  await tabTo(page, grade);
  await expect(grade).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(grade).toHaveValue("초1");
  await page.keyboard.press("Home");
  await expect(grade).toHaveValue("");

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await tabTo(page, search);
  await expect(search).toBeFocused();

  const cards = page.getByRole("link", { name: /상세 보기$/ });
  await expect(cards).toHaveCount(16);
  for (let index = 0; index < 16; index += 1) {
    const card = cards.nth(index);
    await expect(card).toHaveAccessibleName(/.+,\s.+,\s.+ 상세 보기$/);
    await tabTo(page, card);
    await expect(card).toBeFocused();
  }
  await tabTo(page, cards.nth(0));
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
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

  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, scenario: "original" }),
    );
  });
  const retry = page.getByRole("button", { name: "다시 시도" });
  await expect(retry).toHaveAccessibleName("다시 시도");
  await tabTo(page, retry);
  await expect(retry).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("damaged mock catalog is reported until the visitor explicitly resets it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const current = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...current, generation: -1 }));
  });
  await page.reload();
  await expect(page.getByRole("alert")).toContainText(
    "개발용 저장 데이터를 읽거나 저장하지 못했어요",
  );
  const recover = page.getByRole("link", { name: "mock 저장 초기화" });
  await expect(recover).toHaveAccessibleName("mock 저장 초기화");
  await tabTo(page, recover);
  await expect(recover).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText(
    "저장된 mock을 읽지 못했습니다",
  );
  const reset = page.getByRole("button", {
    name: "기본 fixture로 명시적 초기화",
  });
  await expect(reset).toHaveAccessibleName("기본 fixture로 명시적 초기화");
  await tabTo(page, reset);
  await expect(reset).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("a.card-r")).toHaveCount(16);
});

test("a mock reset in one tab refreshes the other tab", async ({
  page,
  context,
}) => {
  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("empty");
  await page.getByRole("link", { name: "갤러리로" }).click();
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();

  const otherTab = await context.newPage();
  await otherTab.goto("/");
  await expect(otherTab.getByText("조건에 맞는 앱이 없어요")).toBeVisible();

  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("original");
  await expect(otherTab.locator("a.card-r")).toHaveCount(16);
});
