import { expect, test } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";
import { captureGalleryState } from "./gallery-helpers.js";

test("preserves an over-limit direct search query without requesting a wider list", async ({
  page,
  context,
}) => {
  const listRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps") listRequests.push(url.search);
  });
  await blockExternalRequests(context);

  await page.goto(`/?q=${encodeURIComponent("ß".repeat(51))}`);

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  await expect(search).toHaveValue("ß".repeat(51));
  await expect(page.getByRole("alert")).toContainText("검색어가 너무 길어요");
  expect(listRequests).toEqual([]);
  await captureGalleryState(page, "over-limit-search");

  await search.fill("추가 공개 앱 27");
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
  expect(listRequests).toHaveLength(1);

  await search.fill("ß".repeat(51));
  await expect(search).toHaveValue("ß".repeat(51));
  await expect(page.getByRole("alert")).toContainText("검색어가 너무 길어요");
  await expect(page.locator("a.card-r")).toHaveCount(0);
  expect(listRequests).toHaveLength(1);
  await captureGalleryState(page, "over-limit-typed-search");

  await search.fill("추가 공개 앱 27");
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();
});

test("rejects malformed gallery queries with an explicit reset", async ({
  page,
  context,
}) => {
  const listRequests = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/v1/apps") listRequests.push(url.search);
  });
  await blockExternalRequests(context);

  for (const query of [
    "subject=전체",
    "subject=수학&subject=수학",
    "tracking=1",
    "q=%",
    "q=%FF",
  ]) {
    await page.goto(`/?${query}`);
    await expect(page.getByRole("alert")).toContainText(
      "검색 조건을 확인할 수 없어요",
    );
    await expect(
      page.getByRole("button", { name: "조건 초기화" }),
    ).toBeVisible();
    expect(listRequests).toEqual([]);
  }
  await captureGalleryState(page, "invalid-query");

  await page.getByRole("button", { name: "조건 초기화" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(24);
  expect(listRequests).toHaveLength(1);
});

test("searches actual public names, nicknames, descriptions, symbols, and combined filters", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.goto("/");
  await expect(page.locator("a.card-r")).toHaveCount(24);

  const apps = await page.request.get("/api/v1/apps?limit=2&offset=0");
  const firstPage = await apps.json();
  expect(firstPage.items[0].url).toBe(firstPage.items[1].url);
  expect(firstPage.items[0].id).not.toBe(firstPage.items[1].id);
  for (const { id } of firstPage.items) {
    await expect(page.locator(`a.card-r[href="/apps/${id}"]`)).toHaveCount(1);
  }

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  const nicknameResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "공개 별명"
    );
  });
  await search.fill("공개 별명");
  expect((await (await nicknameResponse).json()).pagination.total).toBe(27);
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await expect(search).toHaveValue("공개 별명");

  const descriptionResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "Description for 추가 공개 앱 27"
    );
  });
  await search.fill("Description for 추가 공개 앱 27");
  expect((await (await descriptionResponse).json()).pagination.total).toBe(1);
  await expect(
    page.getByRole("link", { name: /추가 공개 앱 27/ }),
  ).toBeVisible();

  const math = page.getByRole("button", { name: "수학", exact: true });
  const mathResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await math.click();
  await mathResponse;
  await page.getByRole("combobox", { name: "학년 필터" }).selectOption("초1");
  const combinedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "추가 공개 앱" &&
      url.searchParams.get("subject") === "수학" &&
      url.searchParams.get("grade") === "초1"
    );
  });
  await search.fill("추가 공개 앱");
  expect((await (await combinedResponse).json()).pagination.total).toBe(25);
  await expect(page.locator("a.card-r")).toHaveCount(24);
  await page.getByRole("button", { name: "더 불러오기" }).click();
  await expect(page.locator("a.card-r")).toHaveCount(25);
  await captureGalleryState(page, "combined-filter");

  await search.fill("%_");
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(math).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("combobox", { name: "학년 필터" })).toHaveValue(
    "초1",
  );
  await captureGalleryState(page, "literal-symbol-zero-results");
});

test("keeps a selected valid subject and fixed grades when API results disappear", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  await page.goto(`/?q=${encodeURIComponent("둘째 공개 앱")}`);

  const search = page.getByRole("textbox", { name: "앱·작성자 검색" });
  const subject = page.getByRole("button", { name: "수학", exact: true });
  const grades = page.getByRole("combobox", { name: "학년 필터" });
  await expect(page.getByRole("link", { name: /둘째 공개 앱/ })).toBeVisible();

  const filteredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/apps" &&
      url.searchParams.get("q") === "둘째 공개 앱" &&
      url.searchParams.get("subject") === "수학"
    );
  });
  await subject.click();
  const body = await (await filteredResponse).json();

  expect(body.items).toEqual([]);
  expect(body.pagination.total).toBe(0);
  await expect(page.locator("a.card-r")).toHaveCount(0);
  await expect(page.getByText("조건에 맞는 앱이 없어요")).toBeVisible();
  await expect(search).toHaveValue("둘째 공개 앱");
  await expect(subject).toHaveAttribute("aria-pressed", "true");
  expect(
    await grades
      .locator("option")
      .evaluateAll((options) => options.map((option) => option.value)),
  ).toEqual([
    "",
    "초1",
    "초2",
    "초3",
    "초4",
    "초5",
    "초6",
    "중1",
    "중2",
    "중3",
    "고1",
    "고2",
    "고3",
  ]);
});
