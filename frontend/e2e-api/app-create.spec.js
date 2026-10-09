import { browserContextOptions } from "./helpers.js";
import { expect, test } from "@playwright/test";
import { login } from "./approval-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.skip(
  !prepared,
  "app creation requires the prepared authentication boundary",
);

test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});

async function fillApp(page, name) {
  await page.goto("/apps/new");
  const form = page.getByRole("form", {
    name: "새 앱 등록 양식",
    exact: true,
  });
  await expect(form).toBeVisible();
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://www.naver.com");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("학생과 함께 풀이하는 수업 도구를 만들어줘.");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("수학 수업의 풀이 과정을 공유합니다.");
  await form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "초3", exact: true })
    .click();
  return form;
}

test("approved member creates a persisted public app and a private app", async ({
  page,
  browser,
}) => {
  await login(page, "approval-24");
  await expect(
    page.getByRole("banner").getByText("승인 교사 24", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "앱 등록", exact: true }),
  ).toBeVisible();
  const name = "API 등록 공개 수업 도구 149";
  const form = await fillApp(page, name);
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  const publicUrl = page.url();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(
    query("SELECT count(*) FROM apps WHERE name='API 등록 공개 수업 도구 149'"),
  ).toEqual([[1]]);
  const anonymous = await browser.newContext(browserContextOptions);
  await blockExternalRequests(anonymous);
  const guest = await anonymous.newPage();
  try {
    await guest.goto(publicUrl);
    await expect(
      guest.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await guest.goto("/");
    await expect(
      guest.getByRole("link", {
        name: `${name}, 승인 교사 24, 수학 상세 보기`,
        exact: true,
      }),
    ).toBeVisible();
    const privateName = "API 등록 비공개 수업 도구 149";
    const privateForm = await fillApp(page, privateName);
    await privateForm
      .getByRole("switch", { name: "전체 공개", exact: true })
      .click();
    await privateForm
      .getByRole("button", { name: "아카이브에 등록", exact: true })
      .click();
    await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
    await expect(
      page.getByRole("heading", { name: privateName, exact: true }),
    ).toBeVisible();
    const id = page.url().split("/").at(-1);
    const response = await guest.request.get(`/api/v1/apps/${id}`);
    expect(response.status()).toBe(404);
    const listed = await (
      await guest.request.get("/api/v1/apps?q=API%20등록%20비공개")
    ).json();
    expect(listed.items).toEqual([]);
    expect(listed.pagination.total).toBe(0);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: privateName, exact: true }),
    ).toBeVisible();
  } finally {
    await anonymous.close();
  }
});

test("approved full admin creates a persisted app owned by the session actor", async ({
  page,
}) => {
  await login(page, "approval-admin");
  await expect(
    page.getByRole("banner").getByText("승인 담당", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "주 메뉴" })
      .getByRole("link", { name: "앱 등록", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "내 앱 등록하기", exact: true }),
  ).toBeVisible();
  const name = "API 관리자 등록 수업 도구 150";
  const form = await fillApp(page, name);
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").at(-1);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("승인 담당")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByText("승인 담당")).toBeVisible();
  expect(query(`SELECT owner_id FROM apps WHERE id='${id}'`)).toEqual([
    ["00000000-0000-4000-8000-000000000110"],
  ]);
});
