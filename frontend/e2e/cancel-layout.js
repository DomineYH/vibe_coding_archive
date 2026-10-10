import { expect } from "@playwright/test";

export async function expectSingleLineCancel(page, cancel, width) {
  await expect(cancel).toHaveAccessibleName("취소");
  await page.evaluate(() => document.fonts.ready);
  const layout = await cancel.evaluate((control) => {
    const label = control.querySelector("span");
    const range = document.createRange();
    range.selectNodeContents(label);
    const lines = [...range.getClientRects()];
    const bounds = control.getBoundingClientRect();
    const description = control.previousElementSibling.getBoundingClientRect();
    return {
      lines: lines.length,
      contained: lines.every(
        (line) =>
          line.left >= bounds.left &&
          line.right <= bounds.right &&
          line.top >= bounds.top &&
          line.bottom <= bounds.bottom,
      ),
      separated: description.right <= bounds.left,
      controlRight: bounds.right,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  expect(layout.lines, "취소 must occupy one text line").toBe(1);
  expect(layout.contained, "취소 must fit inside its control").toBe(true);
  expect(layout.separated, "header text must not overlap 취소").toBe(true);
  expect(layout.controlRight).toBeLessThanOrEqual(width);
  expect(layout.scrollWidth).toBeLessThanOrEqual(width);

  await cancel.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  expect(
    await cancel.evaluate((control) => {
      const style = getComputedStyle(control);
      return (
        control.matches(":focus-visible") &&
        style.outlineStyle !== "none" &&
        parseFloat(style.outlineWidth) > 0
      );
    }),
    "keyboard focus retains its visible outline",
  ).toBe(true);
}
