import { publicOrigin } from "./helpers.js";
import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { expect } from "@playwright/test";
import { blockExternalRequests, query } from "./helpers.js";
import { approvalHeaders } from "./approval-helpers.js";
import { openMonitor, signIn, test } from "./admin-apps-helpers.js";

test.describe("connection checks over real API, queue and worker", () => {
  test.beforeEach(() => test.setTimeout(120000));
  test.skip(
    process.env.API_E2E_HEALTH !== "1",
    "requires the owned controlled-I/O worker",
  );

  test("anonymous inspection persists the observed result and reload creates no new job", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    const appId = owned.apps.find((app) => app.public).id;
    await page.goto(`/apps/${appId}`);
    const panel = page.locator("aside section").filter({
      has: page.getByRole("heading", { name: "연결 상태", exact: true }),
    });
    await expect(panel).toBeVisible();
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/apps/${appId}/health-checks`) &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    const admission = await response.json();
    expect(admission.disposition).toBe("created");
    await expect
      .poll(() =>
        query(
          "SELECT state,http_status FROM health_results WHERE app_id='" +
            appId +
            "'",
        ),
      )
      .toEqual([["healthy", 204]]);
    await expect(
      panel.getByText("검사 이력 없음", { exact: true }),
    ).toHaveCount(0);
    const job = admission.health.latest_job.id;
    expect(
      query("SELECT status,attempts FROM health_jobs WHERE id='" + job + "'"),
    ).toEqual([["completed", 1]]);
    await page.reload();
    await expect(panel).toBeVisible();
    await expect(
      panel.getByText("검사 이력 없음", { exact: true }),
    ).toHaveCount(0);
    expect(
      query("SELECT count(*) FROM health_jobs WHERE app_id='" + appId + "'"),
    ).toEqual([[1]]);
  });
  test("administrator batch persists results and refreshes the monitor rows", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    await openMonitor(page, owned.admin);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/admin/health-check-batches") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "전체 재검사", exact: true })
      .click();
    const response = await responsePromise;
    expect(response.status()).toBe(202);
    const admitted = await response.json();
    expect(admitted.disposition).toBe("created");
    const progress = page.getByRole("region", { name: "전체 검사 진행 상황" });
    await expect(progress).toContainText("전체 검사 완료");
    const batchId = admitted.batch.id;
    expect(
      query(
        "SELECT count(*) FROM health_batch_items WHERE batch_id='" +
          batchId +
          "' AND status<>'result_obtained'",
      ),
    ).toEqual([[0]]);
    expect(
      query(
        "SELECT count(*) FROM health_results WHERE state='healthy' AND http_status=204",
      )[0][0],
    ).toBeGreaterThan(0);
    const row = page
      .getByRole("list", { name: "전체 앱 목록" })
      .getByRole("listitem")
      .first();
    await expect(row).toContainText("정상");
    await page.reload();
    await expect(progress).toContainText("전체 검사 완료");
    expect(query("SELECT count(*) FROM health_batches")).toEqual([[1]]);
    await expect(
      page.getByText(
        "개발용 합성 시연이며 외부 사이트에 요청을 보내지 않습니다.",
        { exact: true },
      ),
    ).toHaveCount(0);
  });

  test("administrator row inspection updates in place", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    await openMonitor(page, owned.admin);
    const app = owned.apps.at(-1);
    const row = page
      .getByRole("list", { name: "전체 앱 목록" })
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", {
          name: `앱 관리: ${app.name}`,
          exact: true,
        }),
      });
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/apps/${app.id}/health-checks`) &&
        response.request().method() === "POST",
    );
    await row.getByRole("button", { name: "즉시 재검사", exact: true }).click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    await expect(row.getByRole("status")).toHaveText("검사 완료");
    expect(
      query(
        "SELECT state,http_status FROM health_results WHERE app_id='" +
          app.id +
          "'",
      ),
    ).toEqual([["healthy", 204]]);
    await expect(page).toHaveURL(/\/admin\?tab=health$/);
    await page.reload();
    await expect(row).toContainText("정상");
    expect(
      query("SELECT count(*) FROM health_jobs WHERE app_id='" + app.id + "'"),
    ).toEqual([[1]]);
  });

  test("administrator blocked result completes polling, refreshes the row and survives reload and reuse", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    const app = owned.apps[2];
    await signIn(page, owned.admin);
    await page.goto(`/apps/${app.id}/edit`);
    const form = page.getByRole("form", { name: "앱 수정 양식", exact: true });
    await form
      .getByRole("textbox", { name: "배포 URL", exact: true })
      .fill("https://health-blocked.example.test/app");
    await form
      .getByRole("button", { name: "변경사항 저장", exact: true })
      .click();
    await expect(page).toHaveURL(`/apps/${app.id}`);
    const [[urlVersion]] = query(
      `SELECT url_version FROM apps WHERE id='${app.id}'`,
    );
    await page.goto("/admin?tab=health");
    const row = page
      .getByRole("list", { name: "전체 앱 목록" })
      .getByRole("listitem")
      .filter({
        has: page.getByRole("button", {
          name: `앱 관리: ${app.name}`,
          exact: true,
        }),
      });
    await page.getByRole("button", { name: /추가 앱 불러오기/ }).click();
    await expect(row).toBeVisible();
    const accepted = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/apps/${app.id}/health-checks`) &&
        response.request().method() === "POST",
    );
    await row.getByRole("button", { name: "즉시 재검사", exact: true }).click();
    const response = await accepted;
    expect(response.status()).toBe(202);
    const admission = await response.json();
    expect(admission.disposition).toBe("created");
    await expect(row.getByRole("status")).toHaveText("검사 완료");
    await expect(row).toContainText("검사 제한");
    expect(
      query(
        `SELECT status,attempts FROM health_jobs WHERE id='${admission.health.latest_job.id}'`,
      ),
    ).toEqual([["completed", 1]]);
    expect(
      query(
        `SELECT url_version,state,http_status,response_ms,error_kind,error_stage FROM health_results WHERE app_id='${app.id}'`,
      ),
    ).toEqual([
      [urlVersion, "blocked", null, null, "DESTINATION_BLOCKED", "dns"],
    ]);
    await page.goto(`/apps/${app.id}`);
    const panel = page.locator("aside section").filter({
      has: page.getByRole("heading", { name: "연결 상태", exact: true }),
    });
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      const measurements = panel.locator("dl").nth(1).getByRole("definition");
      await expect(measurements).toHaveText([
        "—",
        "—",
        "DESTINATION_BLOCKED / dns",
      ]);
      await expect(panel.getByRole("alert")).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "결과 다시 조회", exact: true }),
      ).toHaveCount(0);
      await expect(
        panel.getByRole("button", { name: "진행 다시 조회", exact: true }),
      ).toHaveCount(0);
    }
    const reused = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/apps/${app.id}/health-checks`) &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    const reusedResponse = await reused;
    expect(reusedResponse.status()).toBe(200);
    expect(await reusedResponse.json()).toMatchObject({
      disposition: "result_reused",
      health: {
        result: { error_kind: "DESTINATION_BLOCKED", error_stage: "dns" },
      },
    });
    await expect(panel).toContainText("최근 연결 검사 결과를 다시 표시합니다.");
    await expect(panel.getByRole("alert")).toHaveCount(0);
    await expect(panel.locator("dl").nth(1).getByRole("definition")).toHaveText(
      ["—", "—", "DESTINATION_BLOCKED / dns"],
    );
    expect(
      query(`SELECT count(*) FROM health_jobs WHERE app_id='${app.id}'`),
    ).toEqual([[1]]);
  });
  test("disable cancels queued work, closes intake and retains results after synthetic re-enable", async ({
    page,
    context,
    owned,
  }) => {
    await blockExternalRequests(context);
    const appId = owned.apps.find((app) => app.public).id;
    await page.goto(`/apps/${appId}`);
    const accepted = page.waitForResponse(
      (r) =>
        r.url().endsWith(`/apps/${appId}/health-checks`) &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "연결 다시 확인", exact: true })
      .click();
    expect((await accepted).status()).toBe(202);
    await expect
      .poll(() =>
        query(
          `SELECT state,http_status FROM health_results WHERE app_id='${appId}'`,
        ),
      )
      .toEqual([["healthy", 204]]);
    const original = query(
      `SELECT * FROM health_results WHERE app_id='${appId}'`,
    );
    const job = randomUUID();
    query(
      `INSERT INTO health_jobs(id,app_id,url_version,status,individual,created_at) VALUES ('${job}','${appId}',1,'queued',1,strftime('%Y-%m-%dT%H:%M:%f000Z','now'))`,
    );
    const activation = path.join(
      path.dirname(process.env.DATABASE_PATH),
      "synthetic-health.json",
    );
    await writeFile(
      activation,
      JSON.stringify({ version: 1, synthetic: true }),
      { mode: 0o600, flag: "wx" },
    );
    const disabled = spawnSync(
      "uv",
      ["run", "--frozen", "python", "-m", "app.cli", "disable-health"],
      {
        cwd: "../backend",
        env: { ...process.env, HEALTH_ACTIVATION_PATH: activation },
        stdio: "pipe",
      },
    );
    expect(disabled.status).toBe(3);
    expect(disabled.stdout.toString().trim()).toBe("HEALTH_STOP_REQUIRED");
    // This worker belongs to this runner's private DB; never signal another process.
    const stopped = spawnSync(
      "uv",
      [
        "run",
        "--frozen",
        "python",
        "-c",
        String.raw`
import fcntl,os,signal,time
from pathlib import Path
lock = Path(os.environ['HEALTH_WORKER_LOCK_PATH'])
info = lock.stat()
identity = f"{os.major(info.st_dev):02x}:{os.minor(info.st_dev):02x}:{info.st_ino}"
owners = [int(line.split()[4]) for line in Path('/proc/locks').read_text().splitlines() if line.split()[5] == identity]
assert len(owners) == 1
pid = owners[0]
assert b'tests.health_e2e_worker' in Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
environment = Path(f'/proc/{pid}/environ').read_bytes().split(b'\0')
assert b'APP_ENV=test' in environment
assert ('DATABASE_PATH='+os.environ['DATABASE_PATH']).encode() in environment
os.kill(pid,signal.SIGTERM)
end = time.monotonic()+16
while Path(f'/proc/{pid}').exists():
    assert time.monotonic() < end
    time.sleep(.05)
with lock.open('rb') as fd:
    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
`,
      ],
      { cwd: "../backend", env: process.env, stdio: "pipe" },
    );
    expect(stopped.status, "owned worker OS termination").toBe(0);
    expect(query(`SELECT status FROM health_jobs WHERE id='${job}'`)).toEqual([
      ["cancelled"],
    ]);
    const unavailable = await page.request.post(
      `/api/v1/apps/${appId}/health-checks`,
      {
        headers: {
          ...(await approvalHeaders(page)),
          Origin: publicOrigin,
        },
      },
    );
    expect(unavailable.status()).toBe(503);
    expect((await unavailable.json()).error.code).toBe("FEATURE_UNAVAILABLE");
    expect(
      query(`SELECT * FROM health_results WHERE app_id='${appId}'`),
    ).toEqual(original);
    const replacement = spawn(
      "uv",
      ["run", "--frozen", "python", "-m", "tests.health_e2e_worker"],
      { cwd: "../backend", env: process.env, stdio: "ignore" },
    );
    try {
      await expect
        .poll(() => query("SELECT ready FROM health_worker"))
        .toEqual([[1]]);
      await page.waitForTimeout(300);
      expect(query(`SELECT status FROM health_jobs WHERE id='${job}'`)).toEqual(
        [["cancelled"]],
      );
      expect(
        query(`SELECT * FROM health_results WHERE app_id='${appId}'`),
      ).toEqual(original);
    } finally {
      if (replacement.exitCode === null && replacement.signalCode === null) {
        const exited = new Promise((resolve) =>
          replacement.once("exit", resolve),
        );
        replacement.kill("SIGTERM");
        await exited;
      }
    }
  });
});
