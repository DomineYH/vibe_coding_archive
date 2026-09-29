import { expect, test } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";
import { captureGalleryState } from "./gallery-helpers.js";

test("uses the committed search during IME filter changes and debounces composition end", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.clock.install();
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await search.fill("추가 공개 앱");
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("q"))
    .toBe("추가 공개 앱");

  const listRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps") listRequests.push(url.searchParams);
  });
  await search.dispatchEvent("compositionstart", { data: "추가 공개 앱 27" });
  await search.fill("추가 공개 앱 27");
  const mathResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await page.getByRole("button", { name: "수학", exact: true }).click();
  await mathResponse;
  expect(
    listRequests.some((params) => params.get("q") === "추가 공개 앱 27"),
  ).toBe(false);
  await captureGalleryState(page, "ime-composition-filter");

  await search.dispatchEvent("compositionend", {
    data: "추가 공개 앱 27",
  });
  await page.clock.fastForward(299);
  expect(
    listRequests.some((params) => params.get("q") === "추가 공개 앱 27"),
  ).toBe(false);
  const committedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱 27" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await page.clock.fastForward(1);
  await committedResponse;
  await expect(page).toHaveURL(
    /q=%EC%B6%94%EA%B0%80\+%EA%B3%B5%EA%B0%9C\+%EC%95%B1\+27/,
  );
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(search).toHaveValue("추가 공개 앱 27");

  const grades = page.getByRole("combobox", { name: "학년 필터" });
  const gradeChangeRequestStart = listRequests.length;
  await search.dispatchEvent("compositionstart", {
    data: "추가 공개 앱 26",
  });
  await search.fill("추가 공개 앱 26");
  const committedGradeResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱 27" &&
      url.searchParams.get("subject") === "수학" &&
      url.searchParams.get("grade") === "초1"
    );
  });
  await grades.selectOption("초1");
  await committedGradeResponse;
  expect(
    listRequests
      .slice(gradeChangeRequestStart)
      .some((params) => params.get("q") === "추가 공개 앱 26"),
  ).toBe(false);

  await search.dispatchEvent("compositionend", {
    data: "추가 공개 앱 26",
  });
  await page.clock.fastForward(299);
  expect(
    listRequests
      .slice(gradeChangeRequestStart)
      .some((params) => params.get("q") === "추가 공개 앱 26"),
  ).toBe(false);
  const committedGradeCompositionResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱 26" &&
      url.searchParams.get("subject") === "수학" &&
      url.searchParams.get("grade") === "초1"
    );
  });
  await page.clock.fastForward(1);
  await committedGradeCompositionResponse;
  await expect(page.locator("a.card-r")).toHaveCount(1);
  await expect(search).toHaveValue("추가 공개 앱 26");
  await expect(grades).toHaveValue("초1");

  const clearResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      !url.searchParams.has("q") &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await search.fill("");
  expect((await clearResponse).status()).toBe(200);
  await expect(search).toHaveValue("");
  await expect(page).toHaveURL(/subject=%EC%88%98%ED%95%99/);
});
