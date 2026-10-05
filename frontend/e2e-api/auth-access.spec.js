import { expect, test } from "@playwright/test";
import {
  blockExternalRequests,
  deferred,
  prepareViewportCapture,
  query,
  viewports,
} from "./helpers.js";
import {
  approvalHeaders,
  login,
  openAdmin,
  userRow,
} from "./approval-helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const A = "00000000-0000-4000-8000-000000000030";
const B = "00000000-0000-4000-8000-000000000031";
const absent = "00000000-0000-4000-8000-000000000999";
const titleA = "회원 A 비공개 자료";
const titleB = "회원 B 비공개 자료";
const heading = (page, name = titleA) =>
  page.getByRole("heading", { name, exact: true });
async function signedIn(page, id = "member-a", nickname = "승인 회원") {
  await login(page, id);
  await expect(
    page.getByRole("banner").getByText(nickname, { exact: true }),
  ).toBeVisible();
  const observed = await page.evaluate(async () => {
    const { authService } = await import("/src/services/api/auth.ts");
    const state = await authService.getCurrentAuthState();
    return { status: state.status, kind: state.user?.sessionKind };
  });
  expect(observed).toEqual({ status: "ready", kind: "full" });
}
async function read(page, id, contextual = true, captured = null) {
  return page.evaluate(
    async ({ id, contextual, captured }) => {
      let headers = captured ?? {};
      if (contextual && !captured) {
        const { flowId } = JSON.parse(
          localStorage.getItem("eduvibe-auth-flow-v1"),
        );
        const flow = await (
          await fetch("/api/v1/auth/flow-state", {
            headers: { "X-EduVibe-Flow-Id": flowId },
          })
        ).json();
        headers = {
          "X-EduVibe-Flow-Id": flowId,
          "X-EduVibe-Auth-Revision": flow.revision,
          "X-EduVibe-Session-Generation": flow.session_generation,
        };
      }
      const response = await fetch(`/api/v1/apps/${id}`, {
        headers,
        cache: "no-store",
      });
      const body = await response.json();
      return {
        status: response.status,
        code: body.error?.code,
        message: body.error?.message,
        item: body.item,
        private: response.headers.get("Cache-Control") === "private, no-store",
      };
    },
    { id, contextual, captured },
  );
}
async function denied(page, id) {
  await page.goto(`/apps/${id}`);
  await expect(page.getByRole("alert")).toContainText(
    "아카이브 앱을 찾을 수 없어요",
  );
  expect(await page.locator("body").textContent()).not.toContain(titleA);
  expect(await page.locator("body").textContent()).not.toContain(titleB);
}

test("public visitor makes zero auth calls and private/missing remain indistinguishable", async ({
  page,
  context,
}) => {
  await blockExternalRequests(context);
  const authCalls = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/v1/auth/"))
      authCalls.push(request.method());
  });
  await page.goto("/");
  await expect(page.locator("a.card-r").first()).toBeVisible();
  await page.goto("/apps/00000000-0000-4000-8000-000000000002");
  await expect(heading(page, "둘째 공개 앱")).toBeVisible();
  await denied(page, A);
  const safe = await page.getByRole("alert").innerText();
  await denied(page, absent);
  expect(await page.getByRole("alert").innerText()).toBe(safe);
  expect(authCalls).toEqual([]);
});

if (prepared) {
  test("focus during a delayed real auth proof and explicit concealed retry restore private detail", async ({
    page,
    context,
  }) => {
    await blockExternalRequests(context);
    await signedIn(page);
    await page.goto(`/apps/${A}`);
    await expect(heading(page)).toBeVisible();
    const started = deferred(),
      release = deferred(),
      completed = deferred();
    let held = false;
    await page.route("**/api/v1/auth/flow-state", async (route) => {
      if (held) return route.continue();
      held = true;
      const proof = await route.fetch();
      expect(proof.status()).toBe(200);
      started.resolve();
      await release.promise;
      await route.fulfill({ response: proof });
      completed.resolve();
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      const key = "eduvibe-auth-flow-v1";
      window.dispatchEvent(
        new StorageEvent("storage", {
          key,
          newValue: localStorage.getItem(key),
        }),
      );
    });
    await started.promise;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(heading(page)).toHaveCount(0);
    release.resolve();
    await completed.promise;
    await expect(heading(page)).toBeVisible();
    await page.unroute("**/api/v1/auth/flow-state");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.route("**/api/v1/auth/flow-state", (route) =>
      route.abort("failed"),
    );
    await page
      .getByRole("banner")
      .getByRole("button", { name: "다시 확인" })
      .click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "로그인 상태를 확인할 수 없습니다",
    );
    await expect(heading(page)).toHaveCount(0);
    await page.unroute("**/api/v1/auth/flow-state");
    await page
      .getByRole("main")
      .getByRole("button", { name: "다시 확인" })
      .click();
    await expect(heading(page)).toBeVisible();
  });

  test("real owner A/B, full admin and change-only permission matrix preserves public listing", async ({
    page,
    context,
  }) => {
    await blockExternalRequests(context);
    await signedIn(page);
    await page.goto(`/apps/${A}`);
    await expect(heading(page)).toBeVisible();
    const allowed = await read(page, A);
    expect(allowed.status).toBe(200);
    expect(allowed.private).toBe(true);
    expect(allowed.item.owner).toEqual({
      id: "00000000-0000-4000-8000-000000000100",
      nickname: "승인 회원",
    });
    for (const id of [B, absent])
      expect(await read(page, id)).toMatchObject({
        status: 404,
        code: "NOT_FOUND",
        private: true,
      });
    expect(await read(page, A, false)).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await denied(page, B);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page).toHaveURL("/");
    await signedIn(page, "한글교사", "한글 교사");
    await page.goto(`/apps/${B}`);
    await expect(heading(page, titleB)).toBeVisible();
    await denied(page, A);
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page).toHaveURL("/");
    await signedIn(page, "approval-admin", "승인 담당");
    for (const [id, title] of [
      [A, titleA],
      [B, titleB],
    ]) {
      await page.goto(`/apps/${id}`);
      await expect(heading(page, title)).toBeVisible();
    }
    const publicOnly = await page.evaluate(async () =>
      (await fetch("/api/v1/apps?q=비공개")).json(),
    );
    expect(publicOnly.items).toEqual([]);
    expect(publicOnly.pagination.total).toBe(0);
    const meta = await (await page.request.get("/api/v1/meta")).json();
    expect(meta.capabilities.apps_create.enabled).toBe(true);
    expect(meta.capabilities.apps_update_own.enabled).toBe(true);
    expect(meta.capabilities.apps_delete_own.enabled).toBe(true);
    for (const key of ["admin_apps_read", "admin_apps_manage"])
      expect(meta.capabilities[key].enabled).toBe(false);
    for (const [method, url, expected] of [
      ["post", "/api/v1/apps", 422],
      ["patch", `/api/v1/apps/${A}`, 422],
      ["delete", `/api/v1/apps/${A}`, 422],
      ["get", "/api/v1/admin/apps", 404],
    ]) {
      const refused = await page.request[method](url);
      expect(refused.status()).toBe(expected);
    }
    await page.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(page).toHaveURL("/");
    query(
      "UPDATE members SET must_change_password=1,temporary_password_expires_at='2099-01-01T00:00:00.000000Z' WHERE login_id_key='limit-user'",
    );
    await login(page, "limit-user");
    await expect(
      page.getByRole("heading", { name: "비밀번호를 변경해 주세요" }),
    ).toBeVisible();
    expect(await read(page, A)).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    await denied(page, A);
    query(
      "UPDATE members SET must_change_password=0,temporary_password_expires_at=NULL WHERE login_id_key='limit-user'",
    );
  });

  test("shared-cookie tabs reject delayed actual backend responses through A logout B, refresh and history", async ({
    page,
    context,
  }) => {
    await blockExternalRequests(context);
    await signedIn(page);
    await page.goto(`/apps/${A}`);
    await expect(heading(page)).toBeVisible();
    const second = await context.newPage();
    await second.goto(`/apps/${A}`);
    await expect(heading(second)).toBeVisible();
    await page.bringToFront();
    const started = deferred(),
      release = deferred(),
      completed = deferred();
    let held = false;
    await page.route(`**/api/v1/apps/${A}`, async (route) => {
      if (!route.request().headers()["x-eduvibe-flow-id"] || held)
        return route.continue();
      held = true;
      const real = await route.fetch();
      expect(real.status()).toBe(200);
      started.resolve();
      await release.promise;
      await route.fulfill({ response: real }).catch(() => {});
      completed.resolve();
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await started.promise;
    await expect(heading(page)).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await second.bringToFront();
    await second.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(
      second
        .getByRole("banner")
        .getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    await signedIn(second, "한글교사", "한글 교사");
    release.resolve();
    await completed.promise;
    await expect(heading(page)).toHaveCount(0);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("alert")).toContainText(
      "아카이브 앱을 찾을 수 없어요",
    );
    await page.reload();
    await expect(heading(page)).toHaveCount(0);
    await page.goto(`/apps/${B}`);
    await expect(heading(page, titleB)).toBeVisible();
    await page.goto("/");
    await page.goBack();
    await expect(heading(page, titleB)).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
    );
    expect(stored).not.toContain(titleA);
    expect(stored).not.toContain(titleB);
    await second.close();
  });

  test("focus without notification, hide, failed recheck and pageshow keep protected DOM and keyboard excluded", async ({
    page,
    context,
  }) => {
    await blockExternalRequests(context);
    await signedIn(page);
    await page.goto(`/apps/${A}`);
    await expect(heading(page)).toBeVisible();
    await page.getByRole("button", { name: "복사하기", exact: true }).focus();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "앱 열기" })).toHaveCount(0);
    await page.keyboard.press("Tab");
    expect(await page.locator("body").textContent()).not.toContain(titleA);
    await page.route("**/api/v1/auth/flow-state", (route) =>
      route.abort("failed"),
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "로그인 상태를 확인할 수 없습니다",
    );
    await expect(heading(page)).toHaveCount(0);
    await page.unroute("**/api/v1/auth/flow-state");
    await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
    await expect(heading(page)).toBeVisible();
    await page.getByRole("link", { name: "갤러리", exact: true }).click();
    await expect(page).toHaveURL("/");
    await expect(
      page.getByRole("banner").getByText("승인 회원", { exact: true }),
    ).toBeVisible();
    const proofs = [];
    const countProof = (request) => {
      if (new URL(request.url()).pathname === "/api/v1/auth/flow-state")
        proofs.push(request);
    };
    page.on("request", countProof);
    await page.goBack();
    await expect(heading(page)).toBeVisible();
    expect(proofs).toHaveLength(1);
    page.off("request", countProof);
  });

  test("POP during deferred gallery rendering conceals private detail and issues exactly one proof", async ({
    page,
    context,
  }) => {
    await page.addInitScript(() => {
      const nativeFetch = window.fetch;
      window.fetch = (input, init) => {
        const url = input instanceof Request ? input.url : input;
        if (
          new URL(url, location.href).pathname === "/api/v1/auth/flow-state"
        ) {
          const headers = new Headers(
            init?.headers ??
              (input instanceof Request ? input.headers : undefined),
          );
          // Capture the origin before Playwright handles a potentially late request.
          headers.set("X-Test-Proof-Pathname", location.pathname);
          init = { ...init, headers };
        }
        return nativeFetch.call(window, input, init);
      };
      const NativeMessageChannel = window.MessageChannel;
      const tasks = [];
      let held = false;
      window.holdRenderTasks = () => {
        held = true;
      };
      window.releaseRenderTasks = () => {
        held = false;
        for (const task of tasks.splice(0)) task();
      };
      window.MessageChannel = class extends NativeMessageChannel {
        constructor() {
          super();
          const onmessage = Object.getOwnPropertyDescriptor(
            MessagePort.prototype,
            "onmessage",
          );
          Object.defineProperty(this.port1, "onmessage", {
            set(handler) {
              onmessage.set.call(this, (event) => {
                if (held) tasks.push(() => handler(event));
                else handler(event);
              });
            },
          });
        }
      };
    });
    await blockExternalRequests(context);
    await signedIn(page);
    await page.goto(`/apps/${A}`);
    await expect(heading(page)).toBeVisible();
    await page.evaluate(() => window.holdRenderTasks());
    await page.getByRole("link", { name: "갤러리", exact: true }).click();
    await expect(page).toHaveURL("/");
    const started = deferred(),
      release = deferred(),
      completed = deferred();
    const proofs = [];
    await page.route("**/api/v1/auth/flow-state", async (route) => {
      // The preceding gallery PUSH may start a proof that POP later aborts.
      if (route.request().headers()["x-test-proof-pathname"] === "/")
        return route.continue();
      proofs.push(route.request());
      const proof = await route.fetch();
      expect(proof.status()).toBe(200);
      started.resolve();
      await release.promise;
      await route.fulfill({ response: proof });
      completed.resolve();
    });
    await page.goBack();
    // Pending browser work must not leave the previous private observation visible.
    expect(await heading(page).count()).toBe(0);
    await page.evaluate(() => window.releaseRenderTasks());
    await started.promise;
    await expect(heading(page)).toHaveCount(0);
    await expect(page.getByRole("link", { name: "앱 열기" })).toHaveCount(0);
    expect(await page.locator("body").textContent()).not.toContain(titleA);
    expect(proofs).toHaveLength(1);
    release.resolve();
    await completed.promise;
    await expect(heading(page)).toBeVisible();
    expect(proofs).toHaveLength(1);
  });

  test("actual admin revoke and reapprove cannot revive owner old session or change public data", async ({
    page,
    context,
    browser,
  }) => {
    await blockExternalRequests(context);
    await signedIn(page);
    await page.goto(`/apps/${A}`);
    await expect(heading(page)).toBeVisible();
    const oldCookies = await context.cookies();
    const oldContext = await page.evaluate(async () => {
      const { flowId } = JSON.parse(
        localStorage.getItem("eduvibe-auth-flow-v1"),
      );
      const flow = await (
        await fetch("/api/v1/auth/flow-state", {
          headers: { "X-EduVibe-Flow-Id": flowId },
        })
      ).json();
      return {
        "X-EduVibe-Flow-Id": flowId,
        "X-EduVibe-Auth-Revision": flow.revision,
        "X-EduVibe-Session-Generation": flow.session_generation,
      };
    });
    const oldSession = oldCookies.find((cookie) =>
      cookie.name.startsWith("eduvibe_session_dev_"),
    );
    expect(oldSession).toBeDefined();
    const before = await (await page.request.get("/api/v1/apps")).json();
    const secondContext = await browser.newContext();
    await blockExternalRequests(secondContext);
    const secondPage = await secondContext.newPage();
    await secondPage.bringToFront();
    await signedIn(secondPage);
    await secondPage.goto(`/apps/${A}`);
    await expect(heading(secondPage)).toBeVisible();
    const secondProof = await approvalHeaders(secondPage);
    expect(secondProof["X-EduVibe-Flow-Id"]).not.toBe(
      oldContext["X-EduVibe-Flow-Id"],
    );
    const adminContext = await browser.newContext();
    await blockExternalRequests(adminContext);
    const adminPage = await adminContext.newPage();
    try {
      await adminPage.bringToFront();
      await openAdmin(adminPage);
      const headers = {
        ...(await approvalHeaders(adminPage)),
        Origin: "http://localhost:5174",
      };
      const id = "00000000-0000-4000-8000-000000000100";
      for (const approved of [false, true]) {
        const user = await (
          await adminPage.request.get(`/api/v1/admin/users/${id}`, { headers })
        ).json();
        const issued = await adminPage.request.post(
          "/api/v1/write-operations",
          {
            headers,
            data: {
              kind: "user_approval",
              target_id: id,
              approved,
              expected_account_version: user.account_version,
            },
          },
        );
        expect(issued.status()).toBe(201);
        const operation = await issued.json();
        const response = await adminPage.request.patch(
          `/api/v1/admin/users/${id}/approval`,
          {
            headers: { ...headers, "Idempotency-Key": operation.key },
            data: {
              approved,
              expected_account_version: user.account_version,
            },
          },
        );
        expect(response.status()).toBe(200);
        // Both independently issued browser sessions are rejected immediately
        // after revoke and remain rejected after reapproval.
        expect(await read(page, A, true, oldContext)).toMatchObject({
          status: 404,
          code: "NOT_FOUND",
        });
        expect(await read(secondPage, A, true, secondProof)).toMatchObject({
          status: 404,
          code: "NOT_FOUND",
        });
        await expect
          .poll(
            () =>
              query(
                `SELECT approval_status FROM members WHERE id='${id}'`,
              )[0][0],
          )
          .toBe(approved ? "approved" : "revoked");
      }
      expect(
        query(
          `SELECT count(*) FROM sessions WHERE member_id='${id}' AND kind='full' AND revoked_at IS NULL`,
        ),
      ).toEqual([[0]]);
      await context.clearCookies();
      await context.addCookies(oldCookies);
      expect(await read(page, A, true, oldContext)).toMatchObject({
        status: 404,
        code: "NOT_FOUND",
      });
      expect(
        (await (await page.request.get("/api/v1/apps")).json()).items,
      ).toEqual(before.items);
      await page.bringToFront();
      await signedIn(page);
      await page.goto(`/apps/${A}`);
      await expect(heading(page)).toBeVisible();
    } finally {
      await secondContext.close();
      await adminContext.close();
    }
  });

  test("actual admin pending work survives revision-only proof and is discarded after logout and the same admin login", async ({
    page,
    context,
  }) => {
    await blockExternalRequests(context);
    await openAdmin(page);
    const row = userRow(page, "approval-02");
    await row.getByRole("button", { name: "승인 해제", exact: true }).click();
    const panel = page.getByRole("region", { name: /회원 승인 확인/ });
    await expect(panel).toBeVisible();
    const before = query("SELECT count(*) FROM write_operations");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(panel).toHaveCount(0);
    const continuity = await page.evaluate(async () => {
      const { authService } = await import("/src/services/api/auth.ts");
      const before = await authService.getFlowState();
      const result = await authService.rotateRecoveryCookie(before.flowId, {
        expectedRevision: before.revision,
        expectedSessionGeneration: before.sessionGeneration,
      });
      await authService.confirmRecoveryCookie(before.flowId, {
        expectedRevision: result.revision,
      });
      const after = await authService.getFlowState();
      return {
        revisionChanged: before.revision !== after.revision,
        identityUnchanged:
          before.lastIdentityChangeRevision ===
          after.lastIdentityChangeRevision,
      };
    });
    expect(continuity).toEqual({
      revisionChanged: true,
      identityUnchanged: true,
    });
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(panel).toBeVisible();
    expect(query("SELECT count(*) FROM write_operations")).toEqual(before);
    const second = await context.newPage();
    await second.goto("/admin");
    await expect(second.getByRole("list", { name: "회원 목록" })).toBeVisible();
    await second.getByRole("button", { name: "로그아웃", exact: true }).click();
    await expect(
      second
        .getByRole("banner")
        .getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    await openAdmin(second);
    await page.bringToFront();
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.goto("/admin");
    await expect(page.getByRole("list", { name: "회원 목록" })).toBeVisible();
    await expect(panel).toHaveCount(0);
    expect(query("SELECT count(*) FROM write_operations")).toEqual(before);
    await second.close();
  });

  for (const viewport of viewports)
    test(`private access states ${viewport.width}x${viewport.height}`, async ({
      page,
      context,
    }, testInfo) => {
      await blockExternalRequests(context);
      await page.clock.setFixedTime(new Date("2026-10-01T00:00:00Z"));
      await signedIn(page);
      await page.goto(`/apps/${A}`);
      await expect(heading(page)).toBeVisible();
      async function capture(state) {
        await prepareViewportCapture(page, viewport);
        await page.screenshot({
          path: testInfo.outputPath(`${state}.png`),
          fullPage: true,
          animations: "disabled",
        });
      }
      await capture("owner");
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expect(heading(page)).toHaveCount(0);
      await capture("concealed");
      const started = deferred(),
        release = deferred();
      await page.route("**/api/v1/auth/flow-state", async (route) => {
        const real = await route.fetch();
        started.resolve();
        await release.promise;
        await route.fulfill({ response: real }).catch(() => {});
      });
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await started.promise;
      await expect(heading(page)).toHaveCount(0);
      await capture("checking");
      release.resolve();
      await page.unroute("**/api/v1/auth/flow-state");
      await expect(heading(page)).toBeVisible();
      await capture("restored");
      await page.route("**/api/v1/auth/flow-state", (route) =>
        route.abort("failed"),
      );
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "로그인 상태를 확인할 수 없습니다",
      );
      await capture("error");
      await page.unroute("**/api/v1/auth/flow-state");
      await page
        .getByRole("main")
        .getByRole("button", { name: "다시 확인" })
        .click();
      await expect(heading(page)).toBeVisible();
      await denied(page, B);
      await capture("denied");
      await page.getByRole("button", { name: "로그아웃", exact: true }).click();
      await expect(page).toHaveURL("/");
      await signedIn(page, "approval-admin", "승인 담당");
      await page.goto(`/apps/${A}`);
      await expect(heading(page)).toBeVisible();
      await capture("admin");
    });
}
