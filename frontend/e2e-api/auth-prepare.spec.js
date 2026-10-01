import { expect, test } from "@playwright/test";
import { blockExternalRequests, prepareViewportCapture } from "./helpers.js";

const prepared = process.env.API_E2E_AUTH_BOUNDARY === "prepared";
const sizes = [
  [1440, 1000],
  [1024, 900],
  [768, 1024],
  [390, 844],
  [360, 844],
];
const key = "eduvibe-auth-flow-v1";

test.beforeEach(async ({ page }) => {
  await blockExternalRequests(page);
  await page.clock.setFixedTime(new Date("2026-10-01T00:00:00.000Z"));
});

for (const [width, height] of sizes) {
  test(`actual preparation and public independence at ${width}x${height}`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height });
    const authRequests = [];
    const storedBeforeSend = [];
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/auth/"))
        authRequests.push(request.url());
    });
    await page.route("**/api/v1/auth/**", async (route) => {
      if (
        route.request().url().endsWith("/recovery-cookie") ||
        route.request().url().endsWith("/transitions")
      ) {
        storedBeforeSend.push(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key)),
            key,
          ),
        );
      }
      await route.continue();
    });
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /^둘째 공개 앱,/ }),
    ).toBeVisible();
    expect(authRequests).toHaveLength(0);
    if (prepared)
      await expect(
        page.getByRole("button", { name: "로그인", exact: true }),
      ).toBeVisible();
    await page.goto("/auth?mode=login");
    if (!prepared) {
      await expect(
        page.getByText("인증 기능은 아직 준비 중이에요"),
      ).toBeVisible();
      expect(authRequests).toHaveLength(0);
      return;
    }
    await expect(
      page.getByRole("textbox", { name: "로그인 아이디", exact: true }),
    ).toBeVisible();
    expect(storedBeforeSend[0].flowId).toMatch(/^[0-9a-f-]{36}$/);
    expect(storedBeforeSend[1].transitionId).toMatch(/\.[0-9]+$/);
    const cookies = await context.cookies();
    const authCookies = cookies.filter((cookie) =>
      cookie.name.startsWith("eduvibe_"),
    );
    expect(authCookies).toHaveLength(2);
    expect(
      authCookies.every(
        (cookie) =>
          cookie.httpOnly && cookie.sameSite === "Lax" && cookie.expires === -1,
      ),
    ).toBe(true);
    const record = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    expect(Object.keys(record).sort()).toEqual(["flowId", "revision"]);
    const result = await page.evaluate(async (id) => {
      const headers = { "X-EduVibe-Flow-Id": id };
      const state = await fetch("/api/v1/auth/flow-state", { headers }).then(
        (response) => response.json(),
      );
      const csrf = await fetch("/api/v1/auth/csrf", { headers });
      return {
        present: state.session_cookie_present,
        generation: state.session_generation,
        ready: state.recovery_ready,
        csrfStatus: csrf.status,
        noStore: csrf.headers.get("Cache-Control"),
      };
    }, record.flowId);
    expect(result).toMatchObject({
      present: true,
      ready: true,
      csrfStatus: 200,
      noStore: "no-store",
    });
    expect(result.generation).not.toBeNull();
    await page.reload();
    await expect(
      page.getByRole("textbox", { name: "로그인 아이디", exact: true }),
    ).toBeVisible();
    expect(
      (await context.cookies())
        .filter((cookie) => cookie.name.startsWith("eduvibe_"))
        .map((cookie) => cookie.name)
        .sort(),
    ).toEqual(authCookies.map((cookie) => cookie.name).sort());
    await page
      .getByRole("textbox", { name: "로그인 아이디", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(page.locator("#login-password")).toBeFocused();
    await page.locator("#login-password").blur();
    await prepareViewportCapture(page, { width, height });
    await page.screenshot({
      path: test.info().outputPath(`auth-prepare-${width}x${height}.png`),
      fullPage: true,
      animations: "disabled",
    });
  });
}

test("storage failure never issues R and public reading remains available", async ({
  page,
}) => {
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("blocked", "SecurityError");
      return setItem.call(this, name, value);
    };
  }, key);
  const issued = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/recovery-cookie")) issued.push(request.url());
  });
  await page.goto("/auth?mode=login");
  await expect(
    page.getByText(
      prepared
        ? "로그인 상태를 확인할 수 없어요"
        : "인증 기능은 아직 준비 중이에요",
    ),
  ).toBeVisible();
  expect(issued).toHaveLength(0);
  for (const [width, height] of sizes) {
    await prepareViewportCapture(page, { width, height });
    await page.screenshot({
      path: test
        .info()
        .outputPath(`auth-storage-failure-${width}x${height}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("link", { name: "EduVibe 아카이브 홈" }).click();
  await expect(
    page.getByRole("link", { name: /^둘째 공개 앱,/ }),
  ).toBeVisible();
});

test("unsupported Web Locks keeps public reading and denies preparation", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "locks", { value: undefined }),
  );
  const requests = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/auth/")) requests.push(request.url());
  });
  await page.goto("/auth?mode=login");
  await expect(
    page.getByText(
      prepared
        ? "로그인 상태를 확인할 수 없어요"
        : "인증 기능은 아직 준비 중이에요",
    ),
  ).toBeVisible();
  expect(requests).toHaveLength(0);
  for (const [width, height] of sizes) {
    await prepareViewportCapture(page, { width, height });
    await page.screenshot({
      path: test.info().outputPath(`auth-unsupported-${width}x${height}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.goto("/");
  await expect(
    page.getByRole("link", { name: /^둘째 공개 앱,/ }),
  ).toBeVisible();
});

if (prepared) {
  test("lost R rotates using actual S without changing S or its expiry", async ({
    page,
    context,
  }) => {
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    const before = await context.cookies();
    const session = before.find((cookie) =>
      cookie.name.startsWith("eduvibe_session_"),
    );
    const recovery = before.find((cookie) =>
      cookie.name.startsWith("eduvibe_recovery_"),
    );
    const expiry = await page.evaluate(async (key) => {
      const { flowId } = JSON.parse(localStorage.getItem(key));
      return fetch("/api/v1/auth/csrf", {
        headers: { "X-EduVibe-Flow-Id": flowId },
      })
        .then((response) => response.json())
        .then((body) => body.expires_at);
    }, key);
    await context.clearCookies({ name: /eduvibe_recovery_/ });
    await page.reload();
    await expect(page.locator("#login-id")).toBeVisible();
    const after = await context.cookies();
    expect(
      after.find((cookie) => cookie.name.startsWith("eduvibe_session_")).name,
    ).toBe(session.name);
    expect(
      after.find((cookie) => cookie.name.startsWith("eduvibe_recovery_")).name,
    ).not.toBe(recovery.name);
    expect(
      await page.evaluate(async (key) => {
        const { flowId } = JSON.parse(localStorage.getItem(key));
        return fetch("/api/v1/auth/csrf", {
          headers: { "X-EduVibe-Flow-Id": flowId },
        })
          .then((response) => response.json())
          .then((body) => body.expires_at);
      }, key),
    ).toBe(expiry);
  });

  test("ID only keeps the active flow and permits public reading", async ({
    page,
    context,
  }) => {
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    const before = await page.evaluate((key) => localStorage.getItem(key), key);
    await context.clearCookies();
    const created = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/auth/flows")) created.push(request.url());
    });
    await page.reload();
    await expect(
      page.getByText("로그인 상태를 확인할 수 없어요"),
    ).toBeVisible();
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      before,
    );
    expect(created).toHaveLength(0);
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /^둘째 공개 앱,/ }),
    ).toBeVisible();
  });

  test("lost ID discovers proof and resets only after an explicit choice", async ({
    page,
  }) => {
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    const original = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).flowId,
      key,
    );
    await page.evaluate((key) => localStorage.removeItem(key), key);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "브라우저 인증 초기화" }),
    ).toBeVisible();
    const targets = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).resetTargets,
      key,
    );
    expect(targets.map((item) => item.flowId)).toEqual([original]);
    await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
    await expect(page.locator("#login-id")).toBeVisible();
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).flowId,
        key,
      ),
    ).not.toBe(original);
  });

  test("unreceived successful S is discarded through the exact transition", async ({
    page,
    context,
  }) => {
    let transitionId;
    page.on("request", (request) => {
      if (request.url().endsWith("/auth/transitions"))
        transitionId = request.postDataJSON().transition_id;
    });
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    await page.evaluate(
      ({ key, transitionId }) => {
        const record = JSON.parse(localStorage.getItem(key));
        localStorage.setItem(
          key,
          JSON.stringify({ ...record, transitionId, progress: "executing" }),
        );
      },
      { key, transitionId },
    );
    await context.clearCookies({ name: /eduvibe_session_/ });
    await page.reload();
    await expect(
      page.getByRole("button", { name: "받지 못한 세션 버리기" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "받지 못한 세션 버리기" }).click();
    await expect(page.locator("#login-id")).toBeVisible();
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.startsWith("eduvibe_session_"),
      ),
    ).toHaveLength(1);
  });

  test("two real tabs serialize preparation and share one selected flow", async ({
    context,
    page,
  }) => {
    const second = await context.newPage();
    await blockExternalRequests(second);
    const created = [];
    for (const tab of [page, second])
      tab.on("request", (request) => {
        if (request.url().endsWith("/auth/flows")) created.push(request.url());
      });
    await Promise.all([
      page.goto("/auth?mode=login"),
      second.goto("/auth?mode=login"),
    ]);
    await expect(page.locator("#login-id")).toBeVisible();
    await expect(second.locator("#login-id")).toBeVisible();
    expect(created).toHaveLength(1);
    expect(
      (await context.cookies()).filter((cookie) =>
        cookie.name.startsWith("eduvibe_"),
      ).length,
    ).toBe(2);
    expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
      await second.evaluate((key) => localStorage.getItem(key), key),
    );
  });
}

if (prepared) {
  test("R loss before ready sends no transition and offers never-ready abandon", async ({
    page,
    context,
  }) => {
    let loseOnce = true;
    const admitted = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/auth/transitions"))
        admitted.push(request.url());
    });
    await page.route("**/api/v1/auth/flows/*/ready", async (route) => {
      if (loseOnce) {
        loseOnce = false;
        await context.clearCookies({ name: /eduvibe_recovery_/ });
      }
      await route.continue();
    });
    await page.goto("/auth?mode=login");
    await expect(
      page.getByRole("button", { name: "브라우저 인증 초기화" }),
    ).toBeVisible();
    expect(admitted).toHaveLength(0);
    const original = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).flowId,
      key,
    );
    await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
    await expect(page.locator("#login-id")).toBeVisible();
    expect(
      await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)).flowId,
        key,
      ),
    ).not.toBe(original);
  });

  test("partial reset keeps every original target after committed response loss", async ({
    page,
    context,
    browser,
  }) => {
    await page.goto("/auth?mode=login");
    await expect(page.locator("#login-id")).toBeVisible();
    const other = await browser.newContext({
      locale: "ko-KR",
      timezoneId: "Asia/Seoul",
    });
    const otherPage = await other.newPage();
    await blockExternalRequests(otherPage);
    await otherPage.goto("http://localhost:5174/auth?mode=login");
    await expect(otherPage.locator("#login-id")).toBeVisible();
    await context.addCookies(
      (await other.cookies()).filter((cookie) =>
        cookie.name.startsWith("eduvibe_"),
      ),
    );
    await other.close();
    await page.evaluate((key) => localStorage.removeItem(key), key);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "브라우저 인증 초기화" }),
    ).toBeVisible();
    const targets = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)).resetTargets,
      key,
    );
    expect(targets).toHaveLength(2);
    let loseOnce = true;
    await page.route("**/api/v1/auth/flows/*/reset", async (route) => {
      if (loseOnce) {
        loseOnce = false;
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
    await expect(
      page.getByRole("button", { name: "브라우저 인증 초기화" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key)).resetTargets,
          key,
        ),
      )
      .toEqual(targets);
    await page.getByRole("button", { name: "브라우저 인증 초기화" }).click();
    await expect(page.locator("#login-id")).toBeVisible();
    const next = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    expect(targets.map((target) => target.flowId)).not.toContain(next.flowId);
  });
}

if (prepared) {
  test("damaged numeric shared revisions are preserved and never authorize requests", async ({
    page,
  }) => {
    await page.goto("/auth?mode=login");
    await expect(
      page.getByRole("textbox", { name: "로그인 아이디", exact: true }),
    ).toBeVisible();
    const original = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)),
      key,
    );
    for (const damaged of [
      { ...original, revision: 5 },
      {
        resetTargets: [
          { flowId: original.flowId, revision: [5], proofKind: "recovery" },
        ],
      },
    ]) {
      const raw = JSON.stringify(damaged);
      await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
        key,
        raw,
      });
      let authRequests = 0;
      const count = (request) => {
        if (request.url().includes("/api/v1/auth/")) authRequests += 1;
      };
      page.on("request", count);
      await page.reload();
      await expect(
        page.getByText("저장된 인증 흐름이 손상됐어요.", { exact: false }),
      ).toBeVisible();
      expect(authRequests).toBe(0);
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        raw,
      );
      page.off("request", count);
    }
  });
}

if (prepared) {
  test("fresh public focus return keeps login available without authentication requests", async ({
    page,
  }) => {
    let requests = 0;
    page.on("request", (request) => {
      if (request.url().includes("/api/v1/auth/")) requests += 1;
    });
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    // Let the focus-triggered async observation finish before checking the stable header.
    await page.waitForTimeout(250);
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    expect(requests).toBe(0);
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "로그인 아이디", exact: true }),
    ).toBeVisible();
  });

  test("departure aborts an old auth GET and releases the browser lock for a new observation", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.__authReadAborted = 0;
      const nativeFetch = window.fetch;
      window.fetch = (input, options) => {
        if (String(input).includes("/recovery-csrf"))
          options?.signal?.addEventListener(
            "abort",
            () => {
              window.__authReadAborted += 1;
            },
            { once: true },
          );
        return nativeFetch(input, options);
      };
    });
    await page.goto("/auth?mode=login");
    await expect(
      page.getByRole("textbox", { name: "로그인 아이디", exact: true }),
    ).toBeVisible();
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    let held;
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    await page.route("**/recovery-csrf", async (route) => {
      if (!held) {
        held = route;
        await blocked;
      } else await route.continue();
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event("blur"));
      window.dispatchEvent(new Event("focus"));
    });
    await expect.poll(() => !!held).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect
      .poll(() => page.evaluate(() => window.__authReadAborted))
      .toBeGreaterThan(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(
      page.getByRole("button", { name: "로그인", exact: true }),
    ).toBeVisible();
    release();
    await held.abort().catch(() => {});
  });
}
