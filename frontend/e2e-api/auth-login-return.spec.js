import { expect } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";
import { change, ORIGINAL, test } from "./password-reset-helpers.js";

const returnLogin = "/auth?mode=login&return_to=%2Fadmin";

test.skip(
  process.env.API_E2E_AUTH_BOUNDARY !== "prepared",
  "requires isolated prepared authentication",
);
test.beforeEach(async ({ context }) => {
  test.setTimeout(90000);
  await blockExternalRequests(context);
});

async function submitReturnLogin(page, loginId, path = returnLogin) {
  await page.goto(path);
  const form = page.locator('[data-screen-label="로그인"] form');
  await form.getByLabel("로그인 아이디", { exact: true }).fill(loginId);
  await form.getByLabel("비밀번호", { exact: true }).fill(ORIGINAL);
  await form.getByRole("button", { name: "로그인", exact: true }).click();
}

async function expectMemberGallery(page, member) {
  await expect(page).toHaveURL("/");
  await expect(page.locator('[data-screen-label="로그인"] form')).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("banner").getByText(member.login, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("banner").getByText(member.login, { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL("/");
}

test("member admin login returns to gallery, keeps session and refuses direct admin", async ({
  page,
  members,
}) => {
  await submitReturnLogin(page, members.member.login);
  await expectMemberGallery(page, members.member);
  await page.screenshot({
    path: test.info().outputPath("member-admin-return-gallery.png"),
    animations: "disabled",
  });
  await page.goto("/admin");
  await expect(page.getByRole("alert")).toContainText("관리자 권한이 필요해요");
  await expect(
    page.getByRole("heading", { name: "관리자 대시보드", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "로그아웃" })).toHaveCount(0);
});

test("administrator admin login returns to admin", async ({
  page,
  members,
}) => {
  await submitReturnLogin(page, members.admin.login);
  await expect(page).toHaveURL("/admin");
  await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
  await expect(page.locator('[data-screen-label="로그인"] form')).toHaveCount(
    0,
  );
});

test("temporary member admin login returns to gallery only after required password change", async ({
  page,
  members,
}) => {
  await submitReturnLogin(page, members.temporary.login);
  await expect(page).toHaveURL("/auth?mode=password-change&return_to=%2Fadmin");
  await expect(
    page.getByRole("heading", { name: "관리자 대시보드", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("새 비밀번호 (필수)", { exact: true }),
  ).toBeVisible();
  await change(page);
  await expectMemberGallery(page, members.temporary);
  await expect(
    page.locator('[data-screen-label="비밀번호 변경"] form'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeVisible();
});

for (const kind of ["member", "admin", "temporary", "temporary-existing"]) {
  test(`exact create return for ${kind} without detail reads or automatic registration`, async ({
    page,
    members,
  }) => {
    const detailReads = [];
    const writes = [];
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === "GET" && /^\/api\/v1\/apps\/[^/]+$/.test(path))
        detailReads.push(path);
      if (
        request.method() === "POST" &&
        ["/api/v1/apps", "/api/v1/write-operations"].includes(path)
      )
        writes.push(path);
    });
    const temporary = kind.startsWith("temporary");
    const member = members[temporary ? "temporary" : kind];
    if (kind === "temporary-existing") {
      await submitReturnLogin(page, member.login, "/auth?mode=login");
      await expect(
        page.locator('[data-screen-label="비밀번호 변경"] form'),
      ).toBeVisible();
    }
    await page.goto("/apps/new");
    const registration = page.getByRole("form", {
      name: "새 앱 등록 양식",
      exact: true,
    });
    await expect(registration).toHaveCount(0);
    if (kind !== "temporary-existing") {
      await expect(page).toHaveURL("/auth?mode=login&return_to=%2Fapps%2Fnew");
      const form = page.locator('[data-screen-label="로그인"] form');
      await form
        .getByLabel("로그인 아이디", { exact: true })
        .fill(member.login);
      await form.getByLabel("비밀번호", { exact: true }).fill(ORIGINAL);
      await form.getByRole("button", { name: "로그인", exact: true }).click();
    }
    if (temporary) {
      await expect(page).toHaveURL(
        "/auth?mode=password-change&return_to=%2Fapps%2Fnew",
      );
      await expect(registration).toHaveCount(0);
      await change(page);
    }
    await expect(page).toHaveURL("/apps/new");
    await expect(registration).toBeVisible();
    await expect(
      registration.getByLabel("어플리케이션 이름", { exact: true }),
    ).toHaveValue("");
    await expect(page.locator('[data-screen-label="로그인"] form')).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-screen-label="비밀번호 변경"] form'),
    ).toHaveCount(0);
    await expect(
      page.getByRole("banner").getByText(member.login, { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "로그아웃", exact: true }),
    ).toBeVisible();
    expect(detailReads).toEqual([]);
    expect(writes).toEqual([]);
  });
}
