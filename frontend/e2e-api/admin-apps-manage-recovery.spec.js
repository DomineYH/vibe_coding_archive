import { approvalHeaders } from "./approval-helpers.js";
import { expect, test } from "@playwright/test";
import { blockExternalRequests } from "./helpers.js";
import {
  adminDetail,
  createApp,
  editForm,
  openApp,
  signIn,
  signOut,
} from "./admin-apps-manage-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
test.skip(
  !prepared,
  "app management requires isolated prepared authentication",
);
test.beforeEach(async ({ context }) => {
  test.setTimeout(60000);
  await blockExternalRequests(context);
});

for (const kind of ["PATCH", "DELETE"]) {
  test(`lost admin ${kind} response is explicitly recovered with the existing actor key`, async ({
    page,
  }) => {
    const original = await createApp(
      page,
      "approval-24",
      `관리 응답 유실 168 ${kind}`,
    );
    await signOut(page);
    await signIn(page, "approval-admin");
    await openApp(page, original);
    const keys = [];
    let issues = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.url().endsWith("/write-operations")
      )
        issues++;
      if (
        request.method() === kind &&
        request.url().endsWith(`/apps/${original.id}`)
      )
        keys.push(request.headers()["idempotency-key"]);
    });
    let lost = false;
    await page.route(`**/api/v1/apps/${original.id}`, async (route) => {
      if (route.request().method() !== kind || lost) return route.continue();
      lost = true;
      const result = await route.fetch();
      expect(result.status()).toBe(kind === "PATCH" ? 200 : 204);
      await route.abort("failed");
    });
    if (kind === "PATCH") {
      const form = await editForm(page);
      await form
        .getByRole("textbox", { name: "어플리케이션 이름", exact: true })
        .fill(`${original.name} 수정`);
      await form.getByRole("switch", { name: "전체 공개" }).click();
      await form.getByRole("button", { name: "변경사항 저장" }).click();
    } else {
      await page.getByRole("button", { name: "삭제", exact: true }).click();
      await page
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
    }
    const lookup = page.waitForResponse(
      (response) =>
        response.request().method() === "GET" &&
        response.url().endsWith(`/write-operations/${keys[0]}`),
    );
    await page
      .getByRole("button", {
        name: kind === "PATCH" ? "저장 결과 확인" : "삭제 결과 확인",
        exact: true,
      })
      .click();
    expect((await (await lookup).json()).state).toBe("succeeded");
    await expect(page).toHaveURL("/admin?tab=health");
    expect(issues).toBe(1);
    expect(keys).toHaveLength(1);
    if (kind === "PATCH") {
      expect((await adminDetail(page, original.id)).version).toBe(2);
      await openApp(page, { ...original, name: `${original.name} 수정` });
      await page.getByRole("button", { name: "삭제", exact: true }).click();
      await page
        .getByRole("button", { name: "삭제 확인", exact: true })
        .click();
      await expect(page).toHaveURL("/admin?tab=health");
    }
  });
}

test("an owner edit conflicts with admin editing until explicit latest load and reconfirmation", async ({
  page,
  browser,
}) => {
  const original = await createApp(
    page,
    "approval-24",
    "관리자 충돌 원본 168",
    false,
  );
  const ownerHeaders = {
    ...(await approvalHeaders(page)),
    Origin: "http://localhost:5174",
  };
  // Keep the owner's authenticated browser separate from the administrator.
  const adminContext = await browser.newContext();
  await blockExternalRequests(adminContext);
  const admin = await adminContext.newPage();
  try {
    await signIn(admin, "approval-admin");
    await openApp(admin, original);
    const form = await editForm(admin);
    const name = form.getByRole("textbox", {
      name: "어플리케이션 이름",
      exact: true,
    });
    await name.fill("보존할 관리자 초안 168");
    let competed = false;
    await admin.route("**/api/v1/write-operations", async (route) => {
      const response = await route.fetch();
      if (!competed && route.request().postDataJSON()?.kind === "app_update") {
        competed = true;
        const issued = await page.request.post("/api/v1/write-operations", {
          headers: ownerHeaders,
          data: {
            kind: "app_update",
            target_id: original.id,
            expected_version: 1,
            input: { name: "먼저 확정한 소유자 내용 168" },
          },
        });
        expect(issued.status()).toBe(201);
        const saved = await page.request.patch(`/api/v1/apps/${original.id}`, {
          headers: {
            ...ownerHeaders,
            "Idempotency-Key": (await issued.json()).key,
          },
          data: { expected_version: 1, name: "먼저 확정한 소유자 내용 168" },
        });
        expect(saved.status()).toBe(200);
      }
      await route.fulfill({ response });
    });
    await form.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(
      admin.getByRole("region", { name: "버전 충돌 확인" }),
    ).toBeVisible();
    await expect(name).toHaveValue("보존할 관리자 초안 168");
    await expect(
      form.getByRole("button", { name: "변경사항 저장" }),
    ).toBeDisabled();
    await admin.getByRole("button", { name: "최신 내용 불러오기" }).click();
    await expect(name).toHaveValue("먼저 확정한 소유자 내용 168");
    await name.fill("재확인한 관리자 내용 168");
    await form.getByRole("button", { name: "변경사항 저장" }).click();
    await expect(admin).toHaveURL("/admin?tab=health");
    const current = await adminDetail(admin, original.id);
    expect(current.version).toBe(3);
    expect(current.owner).toEqual(original.owner);
    expect(current.name).toBe("재확인한 관리자 내용 168");
    await openApp(admin, { ...original, name: current.name });
    await admin.getByRole("button", { name: "삭제", exact: true }).click();
    await admin.getByRole("button", { name: "삭제 확인", exact: true }).click();
    await expect(admin).toHaveURL("/admin?tab=health");
  } finally {
    await adminContext.close();
  }
});
