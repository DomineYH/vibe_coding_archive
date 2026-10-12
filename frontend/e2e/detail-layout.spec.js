import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const apps = JSON.parse(
  readFileSync(new URL("../src/fixtures/public-apps.json", import.meta.url)),
);
const privateApps = JSON.parse(
  readFileSync(new URL("../src/fixtures/private-apps.json", import.meta.url)),
);
const description = [
  "A".repeat(4000),
  `https://example.com/${"long-path".repeat(200)}?query=${"B".repeat(200)}`,
  "한글 단어와  공백을 유지합니다.\n다음 줄의 활용 매뉴얼도 유지합니다.",
].join("\n\n");
const prompt = "P".repeat(4000);

for (const viewport of [
  { width: 360, height: 844 },
  { width: 390, height: 844 },
  { width: 1440, height: 1000 },
]) {
  test(`detail description keeps long text inside its card at ${viewport.width}px`, async ({
    page,
    browser,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.clock.install({ time: new Date("2026-09-22T00:12:00.000Z") });
    await page.addInitScript(
      ({ apps, privateApps, description, prompt }) => {
        localStorage.setItem(
          "eduvibe-archive-mock-v1",
          JSON.stringify({
            version: 2,
            generation: 0,
            scenario: "visual_fixture",
            apps: apps.map((app, index) =>
              index === 0 ? { ...app, description, prompt } : app,
            ),
            private_apps: privateApps,
            principal_id: "00000000-0000-4000-8000-000000000103",
          }),
        );
        Object.defineProperty(navigator, "clipboard", {
          configurable: true,
          value: {
            writeText: async (text) => {
              window.copiedPrompt = text;
            },
          },
        });
      },
      { apps, privateApps, description, prompt },
    );
    await page.goto(`/apps/${apps[0].id}`);
    const paragraph = page
      .getByRole("main")
      .locator("section")
      .filter({
        has: page.getByRole("heading", { name: "상세 설명 · 활용 매뉴얼" }),
      })
      .locator("p");
    await expect(paragraph).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    expect(await paragraph.textContent()).toBe(description);
    const geometry = await paragraph.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(element);
      return {
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        height: bounds.height,
        pageScrollWidth: document.documentElement.scrollWidth,
        pageClientWidth: document.documentElement.clientWidth,
        wordBreak: style.wordBreak,
        whiteSpace: style.whiteSpace,
        textWithinParagraph: [...range.getClientRects()].every(
          (rect) =>
            rect.left >= bounds.left - 1 &&
            rect.right <= bounds.right + 1 &&
            rect.top >= bounds.top - 1 &&
            rect.bottom <= bounds.bottom + 1,
        ),
      };
    });
    console.log(
      JSON.stringify({
        width: viewport.width,
        browser: browser.version(),
        ...geometry,
      }),
    );
    await testInfo.attach("description-geometry", {
      body: JSON.stringify(geometry, null, 2),
      contentType: "application/json",
    });
    await page.screenshot({
      path: testInfo.outputPath("detail-long-description.png"),
      fullPage: true,
      animations: "disabled",
      caret: "hide",
    });
    expect
      .soft(geometry.scrollWidth)
      .toBeLessThanOrEqual(geometry.clientWidth + 1);
    expect
      .soft(geometry.pageScrollWidth)
      .toBeLessThanOrEqual(geometry.pageClientWidth + 1);
    expect.soft(geometry.textWithinParagraph).toBe(true);
    expect(geometry.wordBreak).toBe("keep-all");
    expect(geometry.whiteSpace).toBe("pre-wrap");
    const pre = page.locator("pre");
    expect(await pre.textContent()).toBe(prompt);
    await expect(pre).toHaveCSS("overflow-x", "auto");
    expect(
      await pre.evaluate(
        (element) => element.scrollWidth > element.clientWidth,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "복사하기" }).click();
    await expect(page.getByRole("status")).toHaveText("복사됨");
    expect(await page.evaluate(() => window.copiedPrompt)).toBe(prompt);
    await expect(page.getByRole("link", { name: "앱 열기" })).toHaveAttribute(
      "href",
      apps[0].url,
    );
  });
}
