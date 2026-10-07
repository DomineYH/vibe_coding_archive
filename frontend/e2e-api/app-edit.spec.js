import { expect, test } from "@playwright/test";
import { login as submitLogin } from "./approval-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.skip(!prepared, "editing requires prepared authentication");
test.beforeEach(async ({ context }) => {
  await blockExternalRequests(context);
});

async function login(page, id) {
  await submitLogin(page, id);
  await expect(
    page
      .getByRole("banner")
      .getByText(
        id === "approval-admin"
          ? "승인 담당"
          : `승인 교사 ${id.split("-").at(-1)}`,
        { exact: true },
      ),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
}

async function register(page, name) {
  await page.goto("/apps/new");
  const form = page.getByRole("form", { name: "새 앱 등록 양식", exact: true });
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "배포 URL", exact: true })
    .fill("https://www.naver.com");
  await form
    .getByRole("textbox", { name: "핵심 프롬프트", exact: true })
    .fill("편집 검증 프롬프트");
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("원래 수업 설명");
  await form
    .getByRole("group", { name: "교과 과목", exact: true })
    .getByRole("button", { name: "수학", exact: true })
    .click();
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "초3", exact: true })
    .click();
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.url().split("/").at(-1);
}
async function edit(page, id) {
  await page.goto(`/apps/${id}/edit`);
  await expect(
    page.getByRole("heading", { name: "앱 정보 편집", exact: true }),
  ).toBeVisible();
  return page.getByRole("form", { name: "앱 수정 양식", exact: true });
}
async function save(page, form, name) {
  await form
    .getByRole("button", { name: "변경사항 저장", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

test("owner persists edits and toggles public private public with current owner and guest reads", async ({
  page,
  browser,
}) => {
  await login(page, "approval-24");
  const id = await register(page, "API 편집 원본 165");
  const name = "API 편집 결과 165";
  let form = await edit(page, id);
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill(name);
  await form
    .getByRole("textbox", { name: "상세 설명", exact: true })
    .fill("편집한 수업 설명 165");
  await form
    .getByRole("group", { name: "적용 가능 학년", exact: true })
    .getByRole("button", { name: "중1", exact: true })
    .click();
  await save(page, form, name);
  await page.reload();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(
    query(`SELECT name,description,version FROM apps WHERE id='${id}'`),
  ).toEqual([[name, "편집한 수업 설명 165", 2]]);
  expect(
    query(`SELECT grade FROM app_grades WHERE app_id='${id}' ORDER BY grade`),
  ).toEqual([["중1"], ["초3"]]);
  const guestContext = await browser.newContext();
  await blockExternalRequests(guestContext);
  const guest = await guestContext.newPage();
  try {
    await guest.goto(`/apps/${id}`);
    await expect(
      guest.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    form = await edit(page, id);
    await form.getByRole("switch", { name: "전체 공개", exact: true }).click();
    await save(page, form, name);
    await page.reload();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect((await guest.request.get(`/api/v1/apps/${id}`)).status()).toBe(404);
    const listed = await (
      await guest.request.get(`/api/v1/apps?q=${encodeURIComponent(name)}`)
    ).json();
    expect(listed.items).toEqual([]);
    await guest.reload();
    await expect(
      guest.getByText("아카이브 앱을 찾을 수 없어요", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.evaluate((appId) => {
      history.pushState({}, "", `/apps/${appId}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, id);
    await expect(
      page.getByText("아카이브 앱을 찾을 수 없어요", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name, exact: true })).toHaveCount(
      0,
    );
    await login(page, "approval-25");
    await page.goto(`/apps/${id}`);
    await expect(
      page.getByText("아카이브 앱을 찾을 수 없어요", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page).toHaveURL("/");
    await login(page, "approval-24");
    form = await edit(page, id);
    await form.getByRole("switch", { name: "전체 공개", exact: true }).click();
    await save(page, form, name);
    await guest.reload();
    await expect(
      guest.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    expect(
      query(`SELECT is_public,version FROM apps WHERE id='${id}'`),
    ).toEqual([[1, 4]]);
  } finally {
    await guestContext.close();
  }
});

test("full admin edits their own app", async ({ page }) => {
  await login(page, "approval-admin");
  const id = await register(page, "API 관리자 편집 원본 165");
  const form = await edit(page, id);
  await form
    .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
    .fill("API 관리자 편집 결과 165");
  await save(page, form, "API 관리자 편집 결과 165");
  expect(query(`SELECT owner_id,version FROM apps WHERE id='${id}'`)).toEqual([
    ["00000000-0000-4000-8000-000000000110", 2],
  ]);
});

for (const privateSave of [false, true]) {
  test(`a lost committed ${privateSave ? "private" : "public"} PATCH response recovers with the same key and minimum result without automatic resubmission`, async ({
    page,
  }) => {
    await login(page, "approval-24");
    const id = await register(page, "API 응답 유실 원본 165");
    const form = await edit(page, id);
    await form
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
      .fill("API 응답 유실 결과 165");
    if (privateSave)
      await form
        .getByRole("switch", { name: "전체 공개", exact: true })
        .click();
    let issued = 0;
    const keys = [];
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issued++;
      if (request.method() === "PATCH" && request.url().endsWith(`/apps/${id}`))
        keys.push(request.headers()["idempotency-key"]);
    });
    let lost = false;
    await page.route(`**/api/v1/apps/${id}`, async (route) => {
      if (route.request().method() === "PATCH" && !lost) {
        lost = true;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "같은 요청 다시 보내기", exact: true }),
    ).toBeVisible();
    expect(issued).toBe(1);
    expect(keys).toHaveLength(1);
    expect(query(`SELECT version FROM apps WHERE id='${id}'`)).toEqual([[2]]);
    const replay = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().endsWith(`/apps/${id}`),
    );
    await page
      .getByRole("button", { name: "같은 요청 다시 보내기", exact: true })
      .click();
    expect((await replay).status()).toBe(409);
    await expect(
      page.getByRole("button", { name: "저장 결과 확인", exact: true }),
    ).toBeVisible();
    expect(issued).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    await page
      .getByRole("button", { name: "저장 결과 확인", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "API 응답 유실 결과 165",
        exact: true,
      }),
    ).toBeVisible();
    expect(query(`SELECT version FROM apps WHERE id='${id}'`)).toEqual([[2]]);
    expect(issued).toBe(1);
    expect(keys).toHaveLength(2);
  });
}

for (const privateApp of [false, true]) {
  test(`real competing ${privateApp ? "private" : "public"} writes preserve the conflicted draft until an explicit latest load and submission`, async ({
    page,
  }) => {
    const { approvalHeaders } = await import("./approval-helpers.js");
    await login(page, "approval-24");
    const id = await register(page, "API 충돌 원본 165");
    if (privateApp) {
      const initial = await edit(page, id);
      await initial
        .getByRole("switch", { name: "전체 공개", exact: true })
        .click();
      await save(page, initial, "API 충돌 원본 165");
    }
    const expectedVersion = privateApp ? 2 : 1;
    const form = await edit(page, id);
    await form
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
      .fill("보존할 충돌 초안 165");
    const headers = {
      ...(await approvalHeaders(page)),
      Origin: "http://localhost:5174",
    };
    let competed = false;
    let issues = 0;
    let patches = 0;
    page.on("request", (request) => {
      if (request.method() === "PATCH" && request.url().endsWith(`/apps/${id}`))
        patches++;
    });
    await page.route("**/api/v1/write-operations", async (route) => {
      if (route.request().postDataJSON()?.kind !== "app_update")
        return route.continue();
      issues++;
      const response = await route.fetch();
      if (!competed) {
        competed = true;
        const rival = await page.request.post("/api/v1/write-operations", {
          headers,
          data: {
            kind: "app_update",
            target_id: id,
            expected_version: expectedVersion,
            input: { name: "먼저 저장한 내용 165" },
          },
        });
        expect(rival.status()).toBe(201);
        const result = await page.request.patch(`/api/v1/apps/${id}`, {
          headers: { ...headers, "Idempotency-Key": (await rival.json()).key },
          data: {
            expected_version: expectedVersion,
            name: "먼저 저장한 내용 165",
          },
        });
        expect(result.status()).toBe(200);
      }
      await route.fulfill({ response });
    });
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "버전 충돌 확인" }),
    ).toBeVisible();
    await expect(
      form.getByRole("textbox", { name: "어플리케이션 이름", exact: true }),
    ).toHaveValue("보존할 충돌 초안 165");
    await expect(
      form.getByRole("button", { name: "변경사항 저장", exact: true }),
    ).toBeDisabled();
    expect(issues).toBe(1);
    expect(patches).toBe(1);
    expect(query(`SELECT name,version FROM apps WHERE id='${id}'`)).toEqual([
      ["먼저 저장한 내용 165", expectedVersion + 1],
    ]);
    await page
      .getByRole("button", { name: "최신 내용 불러오기", exact: true })
      .click();
    await expect(
      form.getByRole("textbox", { name: "어플리케이션 이름", exact: true }),
    ).toHaveValue("먼저 저장한 내용 165");
    await form
      .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
      .fill("명시적으로 다시 저장한 내용 165");
    await save(page, form, "명시적으로 다시 저장한 내용 165");
    expect(issues).toBe(2);
    expect(patches).toBe(2);
    expect(query(`SELECT version FROM apps WHERE id='${id}'`)).toEqual([
      [expectedVersion + 2],
    ]);
  });
}
