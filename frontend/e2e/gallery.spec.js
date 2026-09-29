import { expect, test } from "@playwright/test";

async function tabTo(page, target, maxTabs = 40) {
  if (await target.evaluate((element) => element === document.activeElement))
    return;
  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    await expect(target).toBeVisible();
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
  await expect(page.getByRole("main")).toBeFocused();
  const open = page.getByRole("link", { name: "앱 열기" });
  await expect(open).toHaveAccessibleName("앱 열기");
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");
  for (const [action, name] of [
    [page.getByRole("button", { name: "갤러리로" }), "갤러리로"],
    [page.getByRole("button", { name: "복사하기" }), "복사하기"],
    [page.getByRole("button", { name: "연결 다시 확인" }), "연결 다시 확인"],
  ]) {
    await expect(action).toHaveAccessibleName(name);
    await tabTo(page, action);
    await expect(action).toBeFocused();
  }
  await page.keyboard.press("Enter");
  const healthPanel = page.locator("aside section").filter({
    has: page.getByRole("heading", { name: "연결 상태", exact: true }),
  });
  await expect(
    healthPanel.getByRole("status").filter({
      hasText: "검사 작업이 완료됐어요",
    }),
  ).toBeVisible();
  const savedJobId = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem("eduvibe-archive-mock-v1"));
    return state.apps.find((item) => item.id.endsWith("000000000001")).health
      .latest_job.id;
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "연결 다시 확인" }),
  ).toBeEnabled();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const state = JSON.parse(
          localStorage.getItem("eduvibe-archive-mock-v1"),
        );
        return state.apps.find((item) => item.id.endsWith("000000000001"))
          .health.latest_job.id;
      }),
    )
    .toBe(savedJobId);
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
  const alert = page.getByRole("alert");
  const retry = alert.getByRole("button", {
    name: "다시 확인",
    exact: true,
  });
  const resetLink = alert.getByRole("link", {
    name: "mock 저장 초기화",
    exact: true,
  });
  await expect(retry).toHaveAccessibleName("다시 확인");
  await expect(resetLink).toHaveAccessibleName("mock 저장 초기화");
  await tabTo(page, resetLink);
  await expect(resetLink).toBeFocused();
  await page.keyboard.press("Shift+Tab");
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

test("preserves gallery filters through detail navigation, history, and reload", async ({
  page,
}) => {
  await page.goto(
    "/?q=%EB%B6%84%EC%88%98%20%ED%94%BC%EC%9E%90&subject=%EC%88%98%ED%95%99&grade=%EC%B4%883",
  );
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  const subject = page.getByRole("button", { name: "수학", exact: true });
  const grade = page.getByRole("combobox", { name: "학년 필터" });
  await expect(search).toHaveValue("분수 피자");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  await expect(grade).toHaveValue("초3");
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator("a.card-r").click();
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "갤러리로" }).click();

  await expect(page).toHaveURL(
    /\/\?q=%EB%B6%84%EC%88%98\+%ED%94%BC%EC%9E%90&subject=%EC%88%98%ED%95%99&grade=%EC%B4%883$/,
  );
  await expect(search).toHaveValue("분수 피자");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  await expect(grade).toHaveValue("초3");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);

  await page.goForward();
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("분수 피자");
  await page.reload();
  await expect(search).toHaveValue("분수 피자");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  await expect(grade).toHaveValue("초3");
});

test("search edits replace history while subject and grade filters remain navigable", async ({
  page,
}) => {
  await page.goto("/");
  const throttle = await page.context().newCDPSession(page);
  await throttle.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.getByRole("button", { name: "수학", exact: true }).click();
  await expect(page).toHaveURL(/\?subject=%EC%88%98%ED%95%99$/);
  const grade = page.getByRole("combobox", { name: "학년 필터" });
  await grade.selectOption("초3");
  await expect(page).toHaveURL(/subject=%EC%88%98%ED%95%99&grade=%EC%B4%883$/);

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("분수 피자");
  await expect(page).toHaveURL(/q=%EB%B6%84%EC%88%98\+%ED%94%BC%EC%9E%90/);
  await search.fill("분수");
  await expect(page).toHaveURL(/q=%EB%B6%84%EC%88%98&subject=/);

  await page.goBack();
  await expect(
    page.getByRole("button", { name: "수학", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(grade).toHaveValue("");
  await expect(search).toHaveValue("");
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await page.goForward();
  await page.goForward();
  await expect(search).toHaveValue("분수");
  await expect(grade).toHaveValue("초3");
});

test("same-path filter history preserves the gallery position", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 450 });
  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("long_list");
  await page.getByRole("link", { name: "갤러리로" }).click();
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(24);
  await page.evaluate(() => window.scrollTo(0, 1000));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "수학", exact: true }).click();
  await expect(page).toHaveURL(/\?subject=%EC%88%98%ED%95%99$/);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(0);
});

test("rejects invalid gallery query values and offers an explicit reset", async ({
  page,
}) => {
  for (const query of [
    "?unknown=value",
    "?q=first&q=first",
    "?subject=%EC%88%98%ED%95%99&subject=%EC%88%98%ED%95%99",
    "?q=%",
    "?q=%C0%AF",
    "?q=%E0%A4%A",
    "?subject=%EC%A0%84%EC%B2%B4",
  ]) {
    await page.goto(`/${query}`);
    const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
    const alert = page.getByRole("alert");
    const reset = page.getByRole("button", { name: "조건 초기화" });
    await expect(alert).toContainText("검색 조건을 확인할 수 없어요");
    await expect(search).toHaveAccessibleName("앱·작성자 검색");
    await expect(reset).toHaveAccessibleName("조건 초기화");
    const searchBox = await search.boundingBox();
    const alertBox = await alert.boundingBox();
    expect(alertBox.y).toBeGreaterThan(searchBox.y + searchBox.height);
    await tabTo(page, reset);
    await expect(reset).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("a.card-r")).toHaveCount(16);
  }

  const foldedOverflow = encodeURIComponent("ß".repeat(51));
  await page.goto(`/?q=${foldedOverflow}`);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await expect(search).toHaveValue("ß".repeat(51));
  await expect(page.getByRole("alert")).toContainText("검색어가 너무 길어요");
  await expect(page.locator("a.card-r")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "조건 초기화" })).toHaveCount(
    0,
  );
});

test("canonicalizes empty filters and preserves valid zero-result conditions", async ({
  page,
}) => {
  await page.goto("/?q=%20&subject=&grade=");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await expect(page).toHaveURL(/\/$/);

  await page.goto(
    "/?q=no+matching+app&subject=%EC%88%98%ED%95%99&grade=%EC%B4%883",
  );
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "수학", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "학년 필터" })).toHaveValue(
    "초3",
  );
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
  const fractionApp = page.getByRole("link", {
    name: "분수 피자 가게, 교사김코딩, 수학 상세 보기",
  });
  await tabTo(page, fractionApp);
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

test("an unabortable stale search response cannot replace newer results", async ({
  page,
}) => {
  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("list_delayed");
  await page.getByRole("link", { name: "갤러리로" }).click();
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(16);

  await search.fill("slow");
  await expect(page).toHaveURL(/q=slow$/);
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText(
    "공개 아카이브를 불러오는 중이에요",
  );
  await search.fill("분수 피자");
  await expect(page).toHaveURL(/q=%EB%B6%84%EC%88%98\+%ED%94%BC%EC%9E%90$/);
  await expect(cards).toHaveCount(1);
  await page.waitForTimeout(400);
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toHaveAccessibleName(
    "분수 피자 가게, 교사김코딩, 수학 상세 보기",
  );
});

test("a same-range refetch failure hides previously loaded cards", async ({
  page,
}) => {
  await page.goto("/");
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(16);
  await page.evaluate(() => {
    const key = "eduvibe-archive-mock-v1";
    const state = JSON.parse(localStorage.getItem(key));
    localStorage.setItem(
      key,
      JSON.stringify({
        ...state,
        scenario: "list_refetch_failure",
        generation: state.generation + 1,
      }),
    );
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });

  await expect(page.getByRole("status")).toContainText(
    "공개 아카이브를 불러오는 중이에요",
  );
  await expect(cards).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText(
    "목록을 불러오지 못했어요",
  );
});

test("selects long-list and long-copy mock states for deterministic layout review", async ({
  page,
}) => {
  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("long_list");
  await page.getByRole("link", { name: "갤러리로" }).click();
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(24);
  await expect(cards.first()).toHaveAccessibleName(/긴 목록 1/);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(cards).toHaveCount(28);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toHaveCount(
    0,
  );

  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("long_copy");
  await page.goto("/apps/00000000-0000-4000-8000-000000000001");
  await expect(
    page.getByRole("heading", { name: "분수 피자 가게" }),
  ).toBeVisible();
  await expect
    .poll(() => page.locator("pre").evaluate((element) => element.scrollHeight))
    .toBeGreaterThan(420);
});

test("deduplicates duplicate pages and stops when a response cannot advance", async ({
  page,
}) => {
  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("duplicate_pages");
  await page.getByRole("link", { name: "갤러리로" }).click();
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(24);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(cards).toHaveCount(24);
  const continueLoading = page.getByRole("button", { name: "계속 불러오기" });
  await expect(continueLoading).toBeVisible();
  await continueLoading.click();
  await expect(cards).toHaveCount(28);

  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("no_progress");
  await page.getByRole("link", { name: "갤러리로" }).click();
  await expect(cards).toHaveCount(24);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(cards).toHaveCount(24);
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();

  await page.goto("/__dev/mock-reset");
  await page.getByLabel("갤러리 시나리오").selectOption("next_page_failure");
  await page.getByRole("link", { name: "갤러리로" }).click();
  await expect(cards).toHaveCount(24);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.getByRole("alert")).toContainText(
    "추가 자료를 불러오지 못했어요",
  );
  await expect(cards).toHaveCount(24);
  await expect(page.getByRole("button", { name: "다시 시도" })).toBeVisible();
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
