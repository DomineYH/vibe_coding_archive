import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { blockExternalRequests, query } from "./helpers.js";

if (process.env.API_E2E_SUPPORT_MODE === "configured")
  test("configured support metadata reaches the existing auth notices", async ({
    page,
    request,
    context,
  }) => {
    test.setTimeout(120000);
    const before = {
      rates: query("SELECT id FROM rate_limit_events").flat(),
      flows: query("SELECT id FROM auth_flows").flat(),
      members: query("SELECT id FROM members").flat(),
    };
    async function links() {
      const email = page.getByRole("link", {
        name: "이메일 문의",
        exact: true,
      });
      await expect(email).toHaveAttribute(
        "href",
        "mailto:support@example.test",
      );
      await expect(
        page.getByRole("link", { name: "서비스 문의" }),
      ).toHaveAttribute("href", "https://service.example.test/help");
      await expect(
        page.getByRole("link", { name: "공지사항" }),
      ).toHaveAttribute("href", "https://notice.example.test/updates");
      await email.focus();
      await page.keyboard.press("Tab");
      await expect(
        page.getByRole("link", { name: "서비스 문의" }),
      ).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(email).toBeFocused();
    }
    try {
      await blockExternalRequests(context);
      const response = await request.get("/api/v1/meta");
      expect(response.status()).toBe(200);
      const meta = await response.json();
      expect(meta.support).toEqual({
        email: "support@example.test",
        service_url: "https://service.example.test/help",
        announcement_url: "https://notice.example.test/updates",
      });
      for (const key of [
        "email_collection",
        "phone_collection",
        "health_check",
        "health_batch",
      ])
        expect(meta.capabilities[key].enabled).toBe(false);
      await page.goto("/auth?mode=login");
      await links();
      if (process.env.API_E2E_AUTH_BOUNDARY !== "prepared") {
        await expect(
          page.getByText("인증 기능은 아직 준비 중이에요"),
        ).toBeVisible();
        await expect(page.locator("form")).toHaveCount(0);
        return;
      }
      await page.goto("/auth?mode=signup");
      await links();
      await expect(page.locator("#contact-hint")).toContainText(
        "공개 화면에 표시되지 않습니다",
      );
      await page
        .getByLabel("로그인 아이디 (필수)", { exact: true })
        .fill("support-registration");
      await page
        .getByLabel("비밀번호 (필수)", { exact: true })
        .fill("Synthetic support password 202!");
      await page
        .getByLabel("비밀번호 확인 (필수)", { exact: true })
        .fill("Synthetic support password 202!");
      await page.getByLabel("별명 (필수)", { exact: true }).fill("안내 시험");
      const registration = page.waitForRequest("**/api/v1/auth/register");
      await page
        .getByRole("button", { name: "가입 신청하기", exact: true })
        .click();
      expect((await registration).postDataJSON()).toEqual({
        login_id: "support-registration",
        password: "Synthetic support password 202!",
        nickname: "안내 시험",
      });
      await expect(
        page.getByRole("heading", { name: "가입 신청이 접수되었어요" }),
      ).toBeVisible();
      await links();
      await expect(
        page.getByText(/운영 문의 주소는 현재 설정되지/),
      ).toHaveCount(0);
    } finally {
      await context.close();
      const cleanup = spawnSync(
        "uv",
        [
          "run",
          "--frozen",
          "python",
          "-c",
          `
import json, os, sqlite3, sys
before = json.load(sys.stdin)
with sqlite3.connect(os.environ['DATABASE_PATH']) as db:
    db.execute('PRAGMA foreign_keys=ON')
    for row in db.execute('SELECT id FROM auth_flows').fetchall():
        if row[0] not in before['flows']:
            for table in ('auth_transitions', 'recovery_credentials', 'auth_retired_credentials', 'sessions'):
                db.execute(f'DELETE FROM {table} WHERE flow_id=?', row)
            db.execute('DELETE FROM auth_flows WHERE id=?', row)
    for table, snapshot in [('members', 'members'), ('rate_limit_events', 'rates')]:
        for row in db.execute(f'SELECT id FROM {table}').fetchall():
            if row[0] not in before[snapshot]:
                db.execute(f'DELETE FROM {table} WHERE id=?', row)
    assert not db.execute('PRAGMA foreign_key_check').fetchall()
`,
        ],
        {
          cwd: "../backend",
          env: process.env,
          input: JSON.stringify(before),
          encoding: "utf8",
        },
      );
      expect(cleanup.status, "support-owned rows and rate events cleaned").toBe(
        0,
      );
    }
  });
