import { browserContextOptions } from "./helpers.js";
import { publicOrigin } from "./helpers.js";
import { expect, test } from "@playwright/test";
import { login as submitLogin } from "./approval-helpers.js";
import { blockExternalRequests, query } from "./helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.skip(!prepared, "deletion requires prepared authentication");
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

async function register(page, name, privateApp = false) {
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
    .fill("삭제 검증 프롬프트");
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
  if (privateApp)
    await form.getByRole("switch", { name: "전체 공개", exact: true }).click();
  await form
    .getByRole("button", { name: "아카이브에 등록", exact: true })
    .click();
  await expect(page).toHaveURL(/\/apps\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  return page.url().split("/").at(-1);
}

for (const [account, privateApp] of [
  ["approval-25", false],
  ["approval-25", true],
  ["approval-admin", false],
]) {
  test(`inline deletion, cancel, and cached back navigation (${account}, private=${privateApp})`, async ({
    page,
  }) => {
    await login(page, account);
    const id = await register(
      page,
      `API 삭제 검증 160 ${account} ${privateApp}`,
      privateApp,
    );
    const before = query("SELECT count(*) FROM apps")[0][0];
    const capabilities = await (await page.request.get("/api/v1/meta")).json();
    expect(capabilities.capabilities.apps_delete_own.enabled).toBe(true);
    expect(capabilities.capabilities.admin_apps_manage.enabled).toBe(true);
    let issues = 0;
    let deletes = 0;
    page.on("request", (request) => {
      if (
        request.url().endsWith("/write-operations") &&
        request.postDataJSON()?.kind === "app_delete"
      )
        issues++;
      if (
        request.method() === "DELETE" &&
        request.url().endsWith(`/apps/${id}`)
      )
        deletes++;
    });
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await page.getByRole("button", { name: "취소", exact: true }).click();
    expect(query(`SELECT count(*) FROM apps WHERE id='${id}'`)).toEqual([[1]]);
    expect(issues).toBe(0);
    expect(deletes).toBe(0);
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await page
      .getByRole("button", { name: "삭제 확인", exact: true })
      .evaluate((button) => {
        button.click();
        button.click();
      });
    await expect(page).toHaveURL("/");
    expect(issues).toBe(1);
    expect(deletes).toBe(1);
    expect(query(`SELECT count(*) FROM apps WHERE id='${id}'`)).toEqual([[0]]);
    expect(query("SELECT count(*) FROM apps")).toEqual([[before - 1]]);
    await page.reload();
    await page.goto(`/apps/${id}`);
    await expect(
      page.getByText("아카이브 앱을 찾을 수 없어요", { exact: true }),
    ).toBeVisible();
    await page.goto(`/apps/${id}/edit`);
    await expect(
      page.getByText("앱을 수정할 수 없어요", { exact: true }),
    ).toBeVisible();
  });
}

test("lost real DELETE response uses the same key replay and result lookup", async ({
  page,
}) => {
  await login(page, "approval-25");
  const id = await register(page, "API 삭제 응답 유실 160");
  const keys = [];
  let issues = 0;
  let lost = false;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/write-operations") &&
      request.postDataJSON()?.kind === "app_delete"
    )
      issues++;
    if (request.method() === "DELETE" && request.url().endsWith(`/apps/${id}`))
      keys.push(request.headers()["idempotency-key"]);
  });
  await page.route(`**/api/v1/apps/${id}`, async (route) => {
    if (route.request().method() === "DELETE" && !lost) {
      lost = true;
      const response = await route.fetch();
      expect(response.status()).toBe(204);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "같은 삭제 요청 다시 보내기",
      exact: true,
    }),
  ).toBeVisible();
  expect(query(`SELECT count(*) FROM apps WHERE id='${id}'`)).toEqual([[0]]);
  const replay = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().endsWith(`/apps/${id}`),
  );
  await page
    .getByRole("button", { name: "같은 삭제 요청 다시 보내기", exact: true })
    .click();
  expect((await replay).status()).toBe(409);
  await page
    .getByRole("button", { name: "삭제 결과 확인", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  expect(issues).toBe(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
});

test("real edit conflict requires latest content then explicit deletion re-confirmation", async ({
  page,
}) => {
  const { approvalHeaders } = await import("./approval-helpers.js");
  await login(page, "approval-25");
  const id = await register(page, "API 삭제 충돌 원본 160");
  const headers = {
    ...(await approvalHeaders(page)),
    Origin: publicOrigin,
  };
  let competed = false;
  let issues = 0;
  await page.route("**/api/v1/write-operations", async (route) => {
    if (route.request().postDataJSON()?.kind !== "app_delete")
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
          expected_version: 1,
          input: { name: "API 삭제 충돌 최신 160" },
        },
      });
      expect(rival.status()).toBe(201);
      const key = (await rival.json()).key;
      const saved = await page.request.patch(`/api/v1/apps/${id}`, {
        headers: { ...headers, "Idempotency-Key": key },
        data: { expected_version: 1, name: "API 삭제 충돌 최신 160" },
      });
      expect(saved.status()).toBe(200);
    }
    await route.fulfill({ response });
  });
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await page.getByRole("button", { name: "최신 앱 확인", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "API 삭제 충돌 최신 160", exact: true }),
  ).toBeVisible();
  expect(issues).toBe(1);
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL("/");
  expect(issues).toBe(2);
});

test("cached foreign public detail offers no delete and cannot return a deleted body", async ({
  page,
  browser,
}) => {
  await login(page, "approval-25");
  const id = await register(page, "API 삭제 타 회원 경계 160");
  const context = await browser.newContext(browserContextOptions);
  await blockExternalRequests(context);
  const other = await context.newPage();
  await login(other, "approval-24");
  await other.goto(`/apps/${id}`);
  await expect(
    other.getByRole("heading", {
      name: "API 삭제 타 회원 경계 160",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    other.getByRole("button", { name: "삭제", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "삭제", exact: true }).click();
  await page.getByRole("button", { name: "삭제 확인", exact: true }).click();
  await expect(page).toHaveURL("/");
  await other.reload();
  await expect(
    other.getByText("아카이브 앱을 찾을 수 없어요", { exact: true }),
  ).toBeVisible();
  await context.close();
});
