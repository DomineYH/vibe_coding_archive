import { expect, test } from "@playwright/test";

for (const width of [1440, 360]) {
  test(`227 gallery to auth main and keyboard paths ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("banner").getByRole("link").first(),
    ).toBeFocused();
    await page
      .getByRole("banner")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    const main = page.getByRole("main");
    await expect(main).toBeFocused();
    await expect(main).toHaveAccessibleName("다시 만나서 반가워요");
    await page.keyboard.press("Tab");
    await expect(
      main.getByRole("link", { name: "로그인", exact: true }),
    ).toBeFocused();
    await page.getByRole("link", { name: "회원가입", exact: true }).click();
    await expect(main).toBeFocused();
    await expect(main).toHaveAccessibleName("아카이브에 합류하기");
    await page.keyboard.press("Shift+Tab");
    await expect(
      page
        .getByRole("banner")
        .getByRole("button", { name: "로그인", exact: true }),
    ).toBeFocused();
  });
}

async function login(page, loginId = "교사김코딩", password = "1234") {
  await page.goto("/auth?mode=login");
  const main = page.getByRole("main");
  await main.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  await main.getByLabel("비밀번호", { exact: true }).fill(password);
  await main.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("main")).toBeFocused();
}
async function destination(page, name) {
  const main = page.getByRole("main");
  await expect(main).toHaveAccessibleName(name);
  await expect(main).toBeFocused();
  expect(
    await main.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        style.outlineStyle === "none" ||
        style.outlineColor === "rgba(0, 0, 0, 0)"
      );
    }),
  ).toBe(true);
  return main;
}
for (const width of [1440, 360]) {
  test(`227 member detail edit POP and initial order ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 600 });
    await login(page);
    await page.goto(
      "/?q=%EB%B6%84%EC%88%98&subject=%EC%88%98%ED%95%99&grade=%EC%B4%883",
    );
    const card = page.locator("a.card-r").first();
    await expect(card).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("link", { name: "EduVibe 아카이브 홈" }),
    ).toBeFocused();
    if (width === 1440) {
      for (const name of ["갤러리", "앱 등록"]) {
        await page.keyboard.press("Tab");
        await expect(
          page.getByRole("banner").getByRole("link", { name, exact: true }),
        ).toBeFocused();
      }
    }
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeFocused();
    await card.click();
    await destination(page, "분수 피자 가게");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "갤러리로", exact: true }),
    ).toBeFocused();
    await page.getByRole("link", { name: "앱 편집", exact: true }).click();
    await destination(page, "앱 정보 편집");
    await page.getByRole("button", { name: "취소", exact: true }).click();
    await destination(page, "분수 피자 가게");
    await page.goBack();
    await destination(page, /수업을 바꾼 앱/);
    expect(
      await page.getByRole("textbox", { name: "앱·작성자 검색" }).inputValue(),
    ).toBe("분수");
    const restored = await page.evaluate(() => window.scrollY);
    expect(restored).toBeGreaterThan(0);
    await expect(page.locator("a.card-r")).toHaveCount(1);
    await page.waitForTimeout(350);
    expect(await page.evaluate(() => window.scrollY)).toBeCloseTo(restored, 0);
    await page.goForward();
    await destination(page, "분수 피자 가게");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeFocused();
  });
  test(`227 delayed detail handoff and deliberate user focus ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page.evaluate(async () => {
      const { appsService } = await import("/src/services/mock/apps.ts");
      const get = appsService.get.bind(appsService);
      let release;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      window.release227 = () => {
        release();
        appsService.get = get;
        delete window.release227;
      };
      appsService.get = async (...args) => {
        await gate;
        return get(...args);
      };
    });
    try {
      await page.getByRole("link", { name: /분수 피자 가게/ }).click();
      await expect(page.getByRole("main")).toHaveAttribute(
        "data-route-pending",
        "true",
      );
      await expect(page.getByRole("main")).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(
        page.getByRole("button", { name: "로그아웃" }),
      ).toBeFocused();
      await page.evaluate(() => window.release227());
      await expect(
        page.getByRole("heading", { name: "분수 피자 가게" }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "로그아웃" }),
      ).toBeFocused();
      await page.goBack();
      await destination(page, /수업을 바꾼 앱/);
      await page.getByRole("link", { name: /분수 피자 가게/ }).click();
      await destination(page, "분수 피자 가게");
      await page.screenshot({
        path: test.info().outputPath(`main-focus-${width}.png`),
        fullPage: true,
      });
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "갤러리로" }),
      ).toBeFocused();
      expect(
        await page
          .getByRole("button", { name: "갤러리로" })
          .evaluate((element) => element.matches(":focus-visible")),
      ).toBe(true);
      await page.screenshot({
        path: test.info().outputPath(`control-focus-${width}.png`),
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await page.evaluate(() => window.release227?.());
    }
  });
  test(`227 admin Arrow tabs and hidden edit recovery ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page, "admin", "admin123");
    await page.goto("/admin");
    await page.getByRole("tab", { name: "Health Monitor" }).click();
    await destination(page, "관리자 대시보드 — Health Monitor");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("tab", { name: "Health Monitor" }),
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await destination(page, "관리자 대시보드 — 사용자 관리");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "로그아웃" })).toBeFocused();
    await page.goto("/apps/00000000-0000-4000-8000-000000000091/edit");
    const input = page.getByLabel("어플리케이션 이름", { exact: true });
    await input.fill("227 browser preserved draft");
    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      state.auth_flow.session_cookie_present = false;
      localStorage.setItem(key, JSON.stringify(state));
    });
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(page.locator("[inert] main")).toBeHidden();
    await page.getByRole("link", { name: "로그인 및 인증 복구" }).click();
    await destination(page, "인증 결과를 확인할 수 없어요");
    await page.evaluate(() => {
      const key = "eduvibe-archive-mock-v1";
      const state = JSON.parse(localStorage.getItem(key));
      state.auth_flow.session_cookie_present = true;
      localStorage.setItem(key, JSON.stringify(state));
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await page.getByRole("button", { name: "편집으로 돌아가기" }).click();
    await destination(page, "앱 정보 편집");
    await expect(input).toHaveValue("227 browser preserved draft");
  });
}
for (const width of [1440, 360]) {
  test(`227 create to detail and terminal auth error ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await login(page);
    await page
      .getByRole("button", { name: "내 앱 등록하기", exact: true })
      .click();
    await destination(page, "새 앱 등록");
    const form = page.getByRole("form", {
      name: "새 앱 등록 양식",
      exact: true,
    });
    await form
      .getByLabel("어플리케이션 이름", { exact: true })
      .fill("227 created app");
    await form
      .getByLabel("배포 URL", { exact: true })
      .fill("https://create.example.org/class");
    await form
      .getByLabel("핵심 프롬프트", { exact: true })
      .fill("수업 도구를 만들어줘.");
    await form
      .getByLabel("상세 설명", { exact: true })
      .fill("함께 풀이합니다.");
    await form
      .getByRole("group", { name: "교과 과목" })
      .getByRole("button", { name: "수학", exact: true })
      .click();
    await form
      .getByRole("group", { name: "적용 가능 학년" })
      .getByRole("button", { name: "초3", exact: true })
      .click();
    await form
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await destination(page, "227 created app");
    await page.getByRole("button", { name: "로그아웃" }).click();
    await destination(page, /수업을 바꾼 앱/);
    await page
      .getByRole("banner")
      .getByRole("button", { name: "로그인", exact: true })
      .click();
    await destination(page, "다시 만나서 반가워요");
    await page.goto("/auth?mode=invalid");
    await page.getByRole("link", { name: "로그인 주소 초기화" }).click();
    await destination(page, "다시 만나서 반가워요");
  });
}
