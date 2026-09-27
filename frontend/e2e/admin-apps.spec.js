import { expect, test } from "@playwright/test";

const storageKey = "eduvibe-archive-mock-v1";
const privateAppId = "00000000-0000-4000-8000-000000000091";

async function loginAsAdmin(page) {
  await page.goto("/auth?mode=login");
  const form = page.locator('[data-screen-label="로그인"] form');
  await expect(form).toBeVisible();
  await form.getByLabel("로그인 아이디", { exact: true }).fill("admin");
  await form.getByLabel("비밀번호", { exact: true }).fill("admin123");
  await form.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

async function seedMoreApps(page) {
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    const source = state.apps[0];
    const additions = Array.from({ length: 8 }, (_, index) => {
      const number = index + 1;
      const timestamp = `2026-09-21T00:00:${String(number).padStart(2, "0")}.000Z`;
      return {
        ...source,
        id: `00000000-0000-4000-8000-${String(700 + index).padStart(12, "0")}`,
        name: `추가 관리 앱 ${number}`,
        url: `https://admin-list-${number}.example.org/app`,
        created_at: timestamp,
        updated_at: timestamp,
      };
    });
    localStorage.setItem(
      key,
      JSON.stringify({ ...state, apps: [...state.apps, ...additions] }),
    );
  }, storageKey);
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

async function openHealthMonitor(page) {
  await page.goto("/admin?tab=health");
  await expect(page).toHaveURL("/admin?tab=health");
  await expect(
    page.getByRole("tab", { name: "Health Monitor", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel", { name: "Health Monitor" });
}

function appRow(panel, name) {
  return panel
    .getByRole("list", { name: "전체 앱 목록" })
    .getByRole("listitem")
    .filter({ hasText: name });
}

const narrowViewports = [
  { width: 360, height: 844 },
  { width: 390, height: 844 },
];

async function textLineCount(locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set(
      Array.from(range.getClientRects(), (rect) => Math.round(rect.top)),
    ).size;
  });
}

async function expectHeaderTextOnOneLine(page) {
  const logo = page
    .getByRole("link", { name: "EduVibe 아카이브 홈" })
    .locator("span")
    .filter({ hasText: "EduVibe" });
  const logout = page.getByRole("button", { name: "로그아웃", exact: true });
  const nickname = page
    .getByRole("banner")
    .getByText("아카이브 관리자", { exact: true });
  await expect(logo).toBeVisible();
  await expect(logout).toBeVisible();
  await expect(nickname).toBeVisible();
  const nicknameSlotWidth = await nickname.evaluate(
    (element) => element.parentElement.clientWidth,
  );
  const documentWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(await textLineCount(logo)).toBe(1);
  expect(await textLineCount(logout)).toBe(1);
  expect(nicknameSlotWidth).toBeGreaterThan(72);
  expect(documentWidth).toBe(await page.evaluate(() => window.innerWidth));
}

test("admin can edit and delete another member's private app from the monitor", async ({
  page,
}) => {
  await loginAsAdmin(page);
  let panel = await openHealthMonitor(page);
  const row = appRow(panel, "과학 수행평가 루브릭 채점기");
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "앱 관리", exact: true }).click();
  await expect(page).toHaveURL(`/apps/${privateAppId}`);
  await expect(
    page.getByRole("heading", {
      name: "과학 수행평가 루브릭 채점기",
      exact: true,
    }),
  ).toBeVisible();

  await page.getByRole("link", { name: "앱 수정", exact: true }).click();
  await expect(page).toHaveURL(`/apps/${privateAppId}/edit`);
  const editForm = page.getByRole("form", {
    name: "앱 수정 양식",
    exact: true,
  });
  await expect(editForm).toBeVisible();
  const visibility = editForm.getByRole("switch", {
    name: "전체 공개",
    exact: true,
  });
  await visibility.click();
  await expect(visibility).toHaveAttribute("aria-checked", "true");
  const save = editForm.getByRole("button", {
    name: "변경사항 저장",
    exact: true,
  });
  await expect(save).toBeEnabled();
  await save.click();

  await expect(page).toHaveURL("/admin?tab=health");
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(appRow(panel, "과학 수행평가 루브릭 채점기")).toContainText(
    "공개",
  );
  await expect(
    page.getByRole("status").filter({ hasText: /^앱을 수정했어요\.$/ }),
  ).toBeVisible();

  await page.goto(
    "/?q=%EA%B3%BC%ED%95%99%20%EC%88%98%ED%96%89%ED%8F%89%EA%B0%80%20%EB%A3%A8%EB%B8%8C%EB%A6%AD%20%EC%B1%84%EC%A0%90%EA%B8%B0",
  );
  const publicApp = page.getByRole("link", {
    name: /과학 수행평가 루브릭 채점기/,
  });
  await expect(publicApp).toBeVisible();

  await page.goto("/admin");
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
  const ownerRow = page
    .getByRole("listitem")
    .filter({ has: page.getByText("교사김코딩", { exact: true }) });
  const beforeOwnerAppCount = Number(
    (await ownerRow.getByText(/^등록 앱 \d+개$/).innerText()).match(/\d+/)[0],
  );
  await openHealthMonitor(page);
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  const beforeCount = page
    .getByRole("region", { name: "전체 통계" })
    .locator("dl > div")
    .filter({ has: page.getByText("등록된 앱", { exact: true }) })
    .locator("dd");
  await expect(beforeCount).toHaveText("17");
  await appRow(panel, "과학 수행평가 루브릭 채점기")
    .getByRole("button", { name: "앱 관리", exact: true })
    .click();
  await expect(page).toHaveURL(`/apps/${privateAppId}`);
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  const confirmation = page.getByRole("group", {
    name: /과학 수행평가 루브릭 채점기.*아카이브에서 삭제할까요/,
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "삭제 확인", exact: true })
    .click();

  await expect(page).toHaveURL("/admin?tab=health");
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(appRow(panel, "과학 수행평가 루브릭 채점기")).toHaveCount(0);
  await expect(beforeCount).toHaveText("16");
  await page.getByRole("tab", { name: "사용자 관리", exact: true }).click();
  await expect(ownerRow.getByText(/^등록 앱 \d+개$/)).toHaveText(
    `등록 앱 ${beforeOwnerAppCount - 1}개`,
  );
});

test("Health Monitor metadata stays clear of status badges at narrow widths", async ({
  page,
}) => {
  await loginAsAdmin(page);

  for (const viewport of narrowViewports) {
    await page.setViewportSize(viewport);
    const panel = await openHealthMonitor(page);
    const rows = panel
      .getByRole("list", { name: "전체 앱 목록" })
      .getByRole("listitem");
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);

    for (let index = 0; index < rowCount; index += 1) {
      const row = rows.nth(index);
      const metadata = row
        .locator("span")
        .filter({ hasText: /^(작성자|버전|공개|비공개)/ });
      const badge = row.locator('[aria-label^="연결 결과:"]');
      await expect(metadata).toHaveCount(3);
      await expect(badge).toBeVisible();

      const metadataItems = await metadata.evaluateAll((elements) =>
        elements.map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const rects = Array.from(range.getClientRects(), (rect) => ({
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
          }));
          return {
            text: element.textContent.trim(),
            lineCount: new Set(rects.map((rect) => Math.round(rect.top))).size,
            rects,
          };
        }),
      );
      const badgeBox = await badge.boundingBox();
      expect(badgeBox).not.toBeNull();

      for (const item of metadataItems) {
        expect(
          item.lineCount,
          `${viewport.width}px ${item.text} must stay on one line`,
        ).toBe(1);
        for (const rect of item.rects) {
          const separatedByTwoPixels =
            badgeBox.x - rect.right >= 2 ||
            rect.left - (badgeBox.x + badgeBox.width) >= 2 ||
            badgeBox.y - rect.bottom >= 2 ||
            rect.top - (badgeBox.y + badgeBox.height) >= 2;
          expect(
            separatedByTwoPixels,
            `${viewport.width}px ${item.text} must have a visible gap from its status badge`,
          ).toBe(true);
        }
      }
    }
  }
});

test("authenticated header text stays on one line at narrow widths", async ({
  page,
}) => {
  await loginAsAdmin(page);

  for (const viewport of narrowViewports) {
    await page.setViewportSize(viewport);
    await page.goto("/admin?tab=health");
    await expect(
      page.getByRole("tabpanel", { name: "Health Monitor" }),
    ).toBeVisible();
    await expectHeaderTextOnOneLine(page);

    await page.goto("/admin?tab=users");
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    await expectHeaderTextOnOneLine(page);

    await page.goto(`/apps/${privateAppId}`);
    await expect(
      page.getByRole("heading", {
        name: "과학 수행평가 루브릭 채점기",
        exact: true,
      }),
    ).toBeVisible();
    await expectHeaderTextOnOneLine(page);
  }
});

test("admin monitor retains the first page and retries a failed next page", async ({
  page,
}) => {
  await seedMoreApps(page);
  await setScenario(page, "admin_apps_more_failure");
  await loginAsAdmin(page);
  const panel = await openHealthMonitor(page);
  const list = panel.getByRole("list", { name: "전체 앱 목록" });
  await expect(list.getByRole("listitem")).toHaveCount(24);
  const appCount = page
    .getByRole("region", { name: "전체 통계" })
    .locator("dl > div")
    .filter({ has: page.getByText("등록된 앱", { exact: true }) })
    .locator("dd");
  await expect(appCount).toHaveText("25");

  await panel
    .getByRole("button", { name: "추가 앱 불러오기 (24/25)", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText(
    "추가 앱을 불러오지 못했어요",
  );
  await expect(list.getByRole("listitem")).toHaveCount(24);

  await setScenario(page, "original");
  await panel
    .getByRole("button", { name: "추가 앱 다시 불러오기", exact: true })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(25);
  await expect(
    panel.getByRole("button", { name: /추가 앱 불러오기/ }),
  ).toHaveCount(0);
});

test("admin monitor deduplicates an overlapping page and keeps empty/error states clear", async ({
  page,
}) => {
  await seedMoreApps(page);
  await setScenario(page, "admin_apps_duplicate_page");
  await loginAsAdmin(page);
  let panel = await openHealthMonitor(page);
  const list = panel.getByRole("list", { name: "전체 앱 목록" });
  await expect(list.getByRole("listitem")).toHaveCount(24);
  await panel
    .getByRole("button", { name: /추가 앱 불러오기 \(24\/25\)/ })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(25);
  const appNames = await list
    .locator("[aria-label^='앱 관리:']")
    .allTextContents();
  expect(new Set(appNames).size).toBe(25);

  await setScenario(page, "admin_apps_empty");
  await page.reload();
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(
    panel.getByText("표시할 앱이 없어요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "전체 통계" })).toContainText(
    "23 / 25",
  );

  await setScenario(page, "admin_apps_list_failure");
  await page.reload();
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(panel.getByRole("alert")).toContainText(
    "앱 목록을 불러오지 못했어요",
  );
  await setScenario(page, "original");
  await panel.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(
    panel.getByRole("list", { name: "전체 앱 목록" }).getByRole("listitem"),
  ).toHaveCount(24);
  await panel
    .getByRole("button", { name: "추가 앱 불러오기 (24/25)", exact: true })
    .click();
  await expect(
    panel.getByRole("list", { name: "전체 앱 목록" }).getByRole("listitem"),
  ).toHaveCount(25);
});

test("whole scan rediscovers the active batch by ID after reload", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await setScenario(page, "health_batch_query_failure");
  await loginAsAdmin(page);
  let panel = await openHealthMonitor(page);
  const start = panel.getByRole("button", {
    name: "전체 재검사",
    exact: true,
  });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(panel.getByRole("alert")).toContainText(
    "전체 검사 진행 상태를 불러오지 못했어요",
  );
  const firstBatchId = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).health_batches[0].id,
    storageKey,
  );
  const unchangedBatch = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).health_batches[0],
    storageKey,
  );
  expect(
    unchangedBatch.targets.every((target) => target.state === "queued"),
  ).toBe(true);

  await page.reload();
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(panel.getByRole("alert")).toContainText(
    "전체 검사 진행 상태를 불러오지 못했어요",
  );
  const restoredBatches = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).health_batches,
    storageKey,
  );
  expect(restoredBatches).toMatchObject([{ id: firstBatchId }]);
  await setScenario(page, "original");
  await panel
    .getByRole("button", { name: "진행 다시 조회", exact: true })
    .click();
  await expect(
    panel.getByRole("region", { name: "전체 검사 진행 상황" }),
  ).toContainText("전체 검사 진행 중");
  const sameBatch = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)).health_batches,
    storageKey,
  );
  expect(sameBatch).toMatchObject([{ id: firstBatchId }]);
});

test("whole scan reports mixed terminal counts and marks stale rows", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await setScenario(page, "health_batch_mixed");
  await loginAsAdmin(page);
  let panel = await openHealthMonitor(page);
  await panel.getByRole("button", { name: "전체 재검사", exact: true }).click();
  const summary = panel.getByRole("region", {
    name: "전체 검사 진행 상황",
  });
  await expect(summary).toContainText("전체 검사 완료", { timeout: 10000 });
  await expect(summary).toContainText("실패 1");
  await expect(summary).toContainText("취소 1");
  await expect(summary).toContainText("처리 17/17");

  await page.evaluate(async () => {
    const { setMockClock } = await import("/src/services/mock/state.ts");
    setMockClock("2026-09-22T00:27:00.000Z");
  });
  await page.reload();
  panel = page.getByRole("tabpanel", { name: "Health Monitor" });
  await expect(page.getByRole("region", { name: "전체 통계" })).toContainText(
    "0 / 17",
  );
  await expect(
    panel.getByText("오래된 결과", { exact: true }).first(),
  ).toBeVisible();
});

test("empty batches show cooldown time and unavailable health capability", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(16);
  await setScenario(page, "health_batch_empty");
  await loginAsAdmin(page);
  const panel = await openHealthMonitor(page);
  await expect(panel.getByRole("list", { name: "전체 앱 목록" })).toHaveCount(
    0,
  );
  await panel.getByRole("button", { name: "전체 재검사", exact: true }).click();
  const summary = panel.getByRole("region", { name: "전체 검사 진행 상황" });
  await expect(summary).toContainText("전체 검사 완료");
  await expect(summary).toContainText("처리 0/0");

  await panel.getByRole("button", { name: "전체 재검사", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("전체 검사 대기 시간");
  await setScenario(page, "health_check_unavailable");
  await panel.getByRole("button", { name: "전체 재검사", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "현재 전체 연결 검사를 사용할 수 없어요",
  );
  await expect(
    page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).health_batches.length,
      storageKey,
    ),
  ).resolves.toBe(1);
});

test("admin tabs are operable with the keyboard", async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto("/admin");
  const usersTab = page.getByRole("tab", { name: "사용자 관리", exact: true });
  await expect(usersTab).toHaveAttribute("aria-selected", "true");
  await usersTab.focus();
  await page.keyboard.press("ArrowRight");
  const healthTab = page.getByRole("tab", {
    name: "Health Monitor",
    exact: true,
  });
  await expect(healthTab).toBeFocused();
  await expect(healthTab).toHaveAttribute("aria-selected", "true");
  await expect(page).toHaveURL("/admin?tab=health");
  await expect(
    page.getByRole("tabpanel", { name: "Health Monitor" }),
  ).toBeVisible();
});
