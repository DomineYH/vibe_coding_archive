import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pauseClockAtCurrentTime } from "../playwright-clock.js";
import {
  blockExternalRequests,
  disableAutomaticPagination,
  deferred,
  prepareViewportCapture,
  viewports,
} from "../e2e-api/helpers.js";

function evidencePath(testInfo, name) {
  const mode = testInfo.project.use.baseURL.endsWith("5174") ? "api" : "mock";
  const directory = path.resolve(
    "../docs/evidence/phase-2/issue95/2026-09-30/visual",
    mode,
  );
  mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}

test.beforeEach(async ({ page, context }) => {
  await blockExternalRequests(context);
  await disableAutomaticPagination(page);
});

test("zero-result reset discards accumulated default pages and restarts at offset zero", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const api = testInfo.project.use.baseURL.endsWith("5174");
  if (!api) {
    await page.goto("/__dev/mock-reset");
    await page.getByLabel("갤러리 시나리오").selectOption("long_list");
    await page.getByRole("link", { name: "갤러리로" }).click();
  } else await page.goto("/");
  const cards = page.locator("a.card-r");
  await expect(cards).toHaveCount(24);
  const firstIds = await cards.evaluateAll((items) =>
    items.map((item) => item.getAttribute("href")),
  );
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(cards).toHaveCount(api ? 30 : 28);
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("없는앱-증거");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  const defaultOffsets = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps" && !url.searchParams.has("q"))
      defaultOffsets.push(url.searchParams.get("offset"));
  });
  await page.getByRole("button", { name: "조건 초기화" }).click();
  await expect(search).toBeFocused();
  await expect(page).toHaveURL(/\/$/);
  await expect(cards).toHaveCount(24);
  expect(
    await cards.evaluateAll((items) =>
      items.map((item) => item.getAttribute("href")),
    ),
  ).toEqual(firstIds);
  if (api) expect(defaultOffsets).toEqual(["0"]);
  await expect(page.getByRole("button", { name: "더 불러오기" })).toBeVisible();
});

for (const [filters, label] of [
  [{ q: "없는앱-증거" }, "검색어: “없는앱-증거” · 과목: 전체 · 학년: 전체"],
  [{ subject: "기타" }, "검색어: 없음 · 과목: 기타 · 학년: 전체"],
  [{ grade: "고3" }, "검색어: 없음 · 과목: 전체 · 학년: 고3"],
  [
    { q: "없는앱-증거", subject: "수학", grade: "초3" },
    "검색어: “없는앱-증거” · 과목: 수학 · 학년: 초3",
  ],
]) {
  test(`normal zero result names applied conditions: ${label}`, async ({
    page,
  }) => {
    await page.goto(`/?${new URLSearchParams(filters)}`);
    await expect(page.getByText(label, { exact: true })).toBeVisible();
    await expect(page.getByRole("alert")).toHaveCount(0);
    if (filters.subject)
      await expect(
        page.getByRole("button", { name: filters.subject, exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("combobox", { name: "학년 필터" }).locator("option"),
    ).toHaveCount(13);
    await page.getByRole("button", { name: "조건 초기화" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("textbox", { name: "앱·작성자 검색" }),
    ).toBeFocused();
    await expect(page.locator("a.card-r").first()).toBeVisible();
  });
}

for (const viewport of viewports) {
  for (const key of ["Enter", "Space"]) {
    test(`keyboard ${key} reset wraps the complete query at ${viewport.width}x${viewport.height}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      const q = "없는앱-" + "Z".repeat(90);
      await page.goto(
        `/?${new URLSearchParams({ q, subject: "수학", grade: "초3" })}`,
      );
      const conditions = page.getByText(
        `검색어: “${q}” · 과목: 수학 · 학년: 초3`,
        { exact: true },
      );
      await expect(conditions).toBeVisible();
      await prepareViewportCapture(page, viewport);
      expect(
        await conditions.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: evidencePath(
          testInfo,
          `long-query-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
      await conditions.locator("../..").screenshot({
        path: evidencePath(
          testInfo,
          `long-query-component-${viewport.width}x${viewport.height}.png`,
        ),
        animations: "disabled",
      });
      const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
      await search.focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("button", { name: "조건 초기화" }),
      ).toBeFocused();
      const historyLength = await page.evaluate(() => history.length);
      await page.keyboard.press(key);
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(
        page.getByRole("combobox", { name: "학년 필터" }),
      ).toHaveValue("");
      await expect(
        page.getByRole("button", { name: "전체", exact: true }),
      ).toHaveAttribute("aria-pressed", "true");
      await expect(page).toHaveURL(/\/$/);
      expect(await page.evaluate(() => history.length)).toBe(historyLength);
      await expect(page.locator("a.card-r").first()).toBeVisible();
      await prepareViewportCapture(page, viewport);
      await page.screenshot({
        path: evidencePath(
          testInfo,
          `reset-focused-${viewport.width}x${viewport.height}.png`,
        ),
        fullPage: true,
        animations: "disabled",
      });
    });
  }
}

test("reset replaces its history entry and cancels draft debounce and IME", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("a.card-r").first()).toBeVisible();
  await page.getByRole("button", { name: "수학", exact: true }).click();
  await page.getByRole("combobox", { name: "학년 필터" }).selectOption("초3");
  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("없는앱-증거");
  await expect(
    page.getByText("검색어: “없는앱-증거” · 과목: 수학 · 학년: 초3", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await pauseClockAtCurrentTime(page);
  await page.clock.runFor(0);
  const applied = await page.evaluate(() => {
    const input = document.getElementById("gallery-search");
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, "보류된 검색");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const applied = [...document.querySelectorAll("main p")].find((element) =>
      element.textContent.startsWith("검색어:"),
    )?.textContent;
    window.setTimeout(
      () =>
        [...document.querySelectorAll("button")]
          .find((element) => element.textContent === "조건 초기화")
          .click(),
      100,
    );
    return applied;
  });
  expect(applied).toBe("검색어: “없는앱-증거” · 과목: 수학 · 학년: 초3");
  await page.clock.runFor(400);
  await page.clock.resume();
  await expect(page).toHaveURL(/\/$/);
  await expect(search).toHaveValue("");
  await expect(page.locator("a.card-r").first()).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\?subject=%EC%88%98%ED%95%99$/);
  await expect(search).toHaveValue("");
  await expect(page.getByRole("combobox", { name: "학년 필터" })).toHaveValue(
    "",
  );
  await page.clock.resume();
  await search.fill("없는앱-증거");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await search.dispatchEvent("compositionstart");
  await search.fill("조합중");
  await page.getByRole("button", { name: "조건 초기화" }).click();
  await search.dispatchEvent("compositionend");
  await page.clock.runFor(400);
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/\/$/);
  await expect(search).toBeFocused();
  await expect(page.locator("a.card-r").first()).toBeVisible();
});

test("empty archive applies conditions then resets to defaults and refetches the first page", async ({
  page,
}, testInfo) => {
  const api = testInfo.project.use.baseURL.endsWith("5174");
  let publicIds;
  if (api) {
    publicIds = execFileSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        `
import json, os, sqlite3, tempfile
from pathlib import Path
p = Path(os.environ["DATABASE_PATH"])
runner_root = Path(os.environ["API_E2E_TEMP_ROOT"])
assert os.environ["APP_ENV"] == "test" and p.is_absolute() and runner_root.is_absolute()
runner_root = runner_root.resolve(strict=True)
assert runner_root.parent == Path(tempfile.gettempdir()).resolve(strict=True)
assert runner_root.name.startswith("eduvibe-api-e2e-")
p = p.resolve(strict=True)
relative = p.relative_to(runner_root)
assert len(relative.parts) == 2 and relative.parts[1] == "api.sqlite3"
run = relative.parts[0]
assert run.startswith("run-") and run[4:].isascii() and run[4:].isdigit()
with sqlite3.connect(p) as db:
    ids = [row[0] for row in db.execute("SELECT id FROM apps WHERE is_public = 1")]
    db.execute("UPDATE apps SET is_public = 0 WHERE is_public = 1")
print(json.dumps(ids))
`,
      ],
      { cwd: path.resolve("../backend"), encoding: "utf8" },
    ).trim();
  } else {
    await page.goto("/__dev/mock-reset");
    await page.getByLabel("갤러리 시나리오").selectOption("empty");
  }
  try {
    await page.goto("/");
    const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
    const reset = page.getByRole("button", { name: "조건 초기화" });
    await expect(page.getByText("아직 공개된 앱이 없어요")).toBeVisible();
    await expect(
      page.getByText("앱이 공개되면 여기에 표시돼요."),
    ).toBeVisible();
    await expect(page.getByText(/검색어:/)).toHaveCount(0);
    await expect(reset).toHaveCount(0);

    await search.fill("없는앱-증거");
    await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
    await expect(
      page.getByText("검색어: “없는앱-증거” · 과목: 전체 · 학년: 전체", {
        exact: true,
      }),
    ).toBeVisible();
    const response = api
      ? page.waitForResponse((response) => {
          const url = new URL(response.url());
          return url.pathname === "/api/v1/apps" && !url.searchParams.has("q");
        })
      : null;
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(reset).toBeFocused();
    await page.keyboard.press("Enter");
    if (response)
      expect((await (await response).json()).pagination.offset).toBe(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText("아직 공개된 앱이 없어요")).toBeVisible();
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
    await expect(page.getByText(/검색어:/)).toHaveCount(0);
    await expect(reset).toHaveCount(0);
    await expect(page.locator("a.card-r")).toHaveCount(0);
  } finally {
    if (api)
      execFileSync(
        "uv",
        [
          "run",
          "--frozen",
          "python",
          "-c",
          `
import json, os, sqlite3, sys
with sqlite3.connect(os.environ["DATABASE_PATH"]) as db:
    db.executemany("UPDATE apps SET is_public = 1 WHERE id = ?", [(id,) for id in json.loads(sys.argv[1])])
`,
          publicIds,
        ],
        { cwd: path.resolve("../backend") },
      );
  }
});

test("a late prior-condition response cannot replace the reset default list", async ({
  page,
}, testInfo) => {
  const api = testInfo.project.use.baseURL.endsWith("5174");
  const started = deferred();
  const release = deferred();
  const settled = deferred();
  if (api) {
    await page.route("**/api/v1/apps?*", async (route) => {
      if (
        new URL(route.request().url()).searchParams.get("q") !==
        "추가 공개 앱 27"
      )
        return route.continue();
      const response = await route.fetch();
      started.resolve();
      try {
        await release.promise;
        await route.fulfill({ response });
      } catch {
        // A changed query can abort the old transport before release.
      } finally {
        settled.resolve();
      }
    });
  } else {
    await page.clock.install();
    await page.goto("/__dev/mock-reset");
    await page.getByLabel("갤러리 시나리오").selectOption("list_delayed");
  }
  try {
    await page.goto(`/?q=${encodeURIComponent("없는앱-증거")}`);
    await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
    await page.getByRole("button", { name: "수학", exact: true }).click();
    await expect(page).toHaveURL(/subject=/);
    await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
    const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
    await search.fill(api ? "추가 공개 앱 27" : "slow");
    if (api) await started.promise;
    await expect(page.getByRole("main").getByRole("status")).toContainText(
      "공개 아카이브를 불러오는 중이에요",
    );
    await page.goBack();
    await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
    await page.getByRole("button", { name: "조건 초기화" }).click();
    await expect(page.locator("a.card-r")).toHaveCount(api ? 24 : 16);
    if (api) {
      release.resolve();
      await settled.promise;
    } else await page.clock.runFor(1000);
    await expect(page.locator("a.card-r")).toHaveCount(api ? 24 : 16);
    await expect(page).toHaveURL(/\/$/);
    await expect(search).toHaveValue("");
    await expect(search).toBeFocused();
  } finally {
    release.resolve();
  }
});
