// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import net from "node:net";
import { EventEmitter } from "node:events";
import { control } from "../e2e-api/fault-control.mjs";
afterEach(() => vi.restoreAllMocks());
import {
  ProcessDrillFailure,
  cliProtocolToken,
  checkProcessResult,
  processOutcome,
  withProcessCleanup,
} from "../e2e-api/process-failure.mjs";

describe("private process drill diagnostics", () => {
  it("reports nonzero exit, signal and spawn failures without subprocess output", () => {
    for (const result of [
      { status: 2, signal: null },
      { status: null, signal: "SIGKILL" },
      {
        status: null,
        signal: null,
        error: { code: "ENOENT", message: "secret-key" },
      },
    ]) {
      const actual = {
        ...result,
        stdout: "cookie-secret",
        stderr: "SQL secret-key",
      };
      try {
        checkProcessResult("backup-db", actual, 3);
        throw new Error("Expected process failure");
      } catch (error) {
        expect(error).toBeInstanceOf(ProcessDrillFailure);
        expect(error.failure).toMatchObject({
          stage: "backup-db",
          ...processOutcome(result),
          reason: "unexpected-exit",
        });
        expect(error.message).not.toMatch(/cookie-secret|SQL|secret-key/);
      }
    }
    const success = { status: 3 };
    expect(checkProcessResult("backup-db", success, 3)).toBe(success);
  });

  it("allowlists fields crossing the private control socket", () => {
    const error = new ProcessDrillFailure("secret-stage", {
      status: "secret-status",
      signal: "secret-signal",
      spawnError: "secret-code",
      reason: "SQL secret-reason",
      stderr: "secret-stderr",
    });
    expect(error.failure).toEqual({
      stage: "control",
      status: null,
      signal: null,
      spawnError: "OTHER",
      reason: "operation-failed",
    });
    expect(error.message).not.toContain("secret");
    expect(
      new ProcessDrillFailure("restart", { reason: "readiness-timeout" })
        .failure.reason,
    ).toBe("readiness-timeout");
  });

  it("preserves the body failure and reports cleanup separately when both fail", async () => {
    const body = new ProcessDrillFailure("backup-db", { status: 2 });
    const cleanup = new ProcessDrillFailure("normal-target", {
      reason: "readiness-timeout",
    });
    try {
      await withProcessCleanup(
        () => {
          throw body;
        },
        () => {
          throw cleanup;
        },
      );
      throw new Error("Expected both failures");
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError);
      expect(error.errors).toEqual([body, cleanup]);
      expect(error.cause).toBe(body);
      expect(error.message).toMatch(
        /body=.*backup-db.*cleanup=.*normal-target/,
      );
    }
  });

  it("keeps one-sided failures and successful results unchanged", async () => {
    const failure = new Error("original assertion");
    await expect(
      withProcessCleanup(
        () => {
          throw failure;
        },
        () => {},
      ),
    ).rejects.toBe(failure);
    await expect(
      withProcessCleanup(
        () => {},
        () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    await expect(
      withProcessCleanup(
        () => 42,
        () => {},
      ),
    ).resolves.toBe(42);
  });

  it("does not copy arbitrary exception text into the combined diagnostic", async () => {
    await expect(
      withProcessCleanup(
        () => {
          throw new Error("cookie-secret");
        },
        () => {
          throw new Error("SQL secret-key");
        },
      ),
    ).rejects.toMatchObject({
      message:
        "private process drill failed; keep auth stopped; body=other test failure; cleanup=other test failure",
    });
  });
});

for (const diagnostic of [false, true]) {
  it(`preserves the control error protocol with diagnostics=${diagnostic}`, async () => {
    const socket = new EventEmitter();
    socket.setTimeout = vi.fn();
    vi.spyOn(net, "createConnection").mockReturnValue(socket);
    const pending = control("test-only.sock", {});
    socket.emit(
      "data",
      JSON.stringify({
        error: diagnostic ? "secret exception" : "invalid private command",
        ...(diagnostic
          ? {
              failure: {
                stage: "backup-db",
                status: 2,
                reason: "unexpected-exit",
                stderr: "secret-key",
              },
            }
          : {}),
      }),
    );
    socket.emit("end");
    if (diagnostic) {
      await expect(pending).rejects.toBeInstanceOf(ProcessDrillFailure);
      await expect(pending).rejects.toMatchObject({
        failure: { stage: "backup-db", status: 2 },
      });
      await expect(pending).rejects.not.toHaveProperty(
        "message",
        expect.stringContaining("secret"),
      );
    } else {
      await expect(pending).rejects.toThrow("invalid private command");
    }
  });
}

it("reads only fixed CLI protocol tokens, never raw output or safe-log metadata", () => {
  expect(
    cliProtocolToken({
      stdout: "secret-output",
      stderr: 'raw secret\n{"code":"CLI_FAILED","secret":"cookie-secret"}',
    }),
  ).toBe("CLI_FAILED");
  expect(
    cliProtocolToken({
      stdout: "HEALTH_STOP_REQUIRED\n",
      stderr: "secret-output",
    }),
  ).toBe("HEALTH_STOP_REQUIRED");
  expect(
    cliProtocolToken({
      stdout: "AUTH_COOKIE_SECRET",
      stderr: '{"code":"secret-code"}\ninvalid JSON',
    }),
  ).toBeNull();
  expect(cliProtocolToken({ stdout: null, stderr: null })).toBeNull();
});

it("reports independent health exit, signal and spawn-error channels", () => {
  expect(processOutcome({ status: 1, signal: null, stderr: "secret" })).toEqual(
    {
      status: 1,
      signal: null,
      spawnError: null,
    },
  );
  expect(
    processOutcome({
      status: null,
      signal: "SIGTERM",
      error: { code: "ENOENT", message: "secret" },
    }),
  ).toEqual({
    status: null,
    signal: "SIGTERM",
    spawnError: "ENOENT",
  });
});
