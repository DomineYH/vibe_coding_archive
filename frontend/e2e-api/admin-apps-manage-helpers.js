import { expect } from "@playwright/test";
import { approvalHeaders, login } from "./approval-helpers.js";

export async function signIn(page, account) {
  await login(page, account);
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
}

export async function signOut(page) {
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
}

export async function createApp(page, account, name, publicApp = true) {
  await signIn(page, account);
  const meta = await (await page.request.get("/api/v1/meta")).json();
  const headers = {
    ...(await approvalHeaders(page)),
    Origin: "http://localhost:5174",
  };
  const input = {
    name,
    url: "https://www.naver.com",
    prompt: "관리자 편집 검증 프롬프트",
    description: "원래 설명",
    subject: meta.subjects[0],
    grades: [meta.grades[0]],
    theme_id: meta.themes[0].id,
    is_public: publicApp,
    stack_db: null,
    stack_backend: null,
    stack_frontend: null,
    stack_hosting: null,
  };
  const issued = await page.request.post("/api/v1/write-operations", {
    headers,
    data: { kind: "app_create", input },
  });
  expect(issued.status(), await issued.text()).toBe(201);
  const created = await page.request.post("/api/v1/apps", {
    headers: { ...headers, "Idempotency-Key": (await issued.json()).key },
    data: input,
  });
  expect(created.status()).toBe(201);
  return (await created.json()).item;
}

export async function openApp(page, app) {
  await page.goto("/admin?tab=health");
  await page.getByRole("button", { name: `앱 관리: ${app.name}` }).click();
  await expect(
    page.getByRole("heading", { name: app.name, exact: true }),
  ).toBeVisible();
}

export async function editForm(page) {
  await page.getByRole("link", { name: "앱 편집", exact: true }).click();
  return page.getByRole("form", { name: "앱 수정 양식", exact: true });
}

export async function adminDetail(page, id) {
  const response = await page.request.get(`/api/v1/apps/${id}`, {
    headers: await approvalHeaders(page),
  });
  expect(response.status()).toBe(200);
  return (await response.json()).item;
}
