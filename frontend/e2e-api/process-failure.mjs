const stages = new Set([
  "control",
  "migration-status",
  "migration-block",
  "maintenance-block",
  "encrypted-backup",
  "encrypted-restore",
  "backup-db",
  "restore-db",
  "verify-restore",
  "restore-status",
  "normal-target",
  "snapshot",
  "cli",
  "sweep-pending",
  "stop",
  "restore",
  "restore-snapshot",
  "invalidate-restored-auth",
  "restart",
  "start",
  "migration-resume",
  "age-keygen-identity",
  "age-keygen-recipient",
]);
const signals = new Set([
  "SIGINT",
  "SIGTERM",
  "SIGKILL",
  "SIGABRT",
  "SIGSEGV",
  "SIGBUS",
  "SIGILL",
  "SIGFPE",
  "SIGHUP",
  "SIGQUIT",
  "SIGPIPE",
  "SIGTRAP",
  "SIGXCPU",
  "SIGXFSZ",
  "SIGSYS",
]);
const spawnErrors = new Set([
  "ENOENT",
  "EACCES",
  "EPERM",
  "ENOMEM",
  "EAGAIN",
  "ENOEXEC",
  "ENOTDIR",
  "EMFILE",
  "ENFILE",
  "E2BIG",
  "ETIMEDOUT",
  "ENOBUFS",
  "EINVAL",
]);
const reasons = new Set([
  "unexpected-exit",
  "operation-failed",
  "readiness-timeout",
]);
const status = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
const spawnError = (value) =>
  value ? (spawnErrors.has(value) ? value : "OTHER") : null;

export function processOutcome(result) {
  return {
    status: status(result.status),
    signal: signals.has(result.signal) ? result.signal : null,
    spawnError: spawnError(result.error?.code),
  };
}

export class ProcessDrillFailure extends Error {
  constructor(stage, outcome = {}) {
    const failure = {
      stage: stages.has(stage) ? stage : "control",
      status: status(outcome.status),
      signal: signals.has(outcome.signal) ? outcome.signal : null,
      spawnError: spawnError(outcome.spawnError),
      reason: reasons.has(outcome.reason) ? outcome.reason : "operation-failed",
    };
    super(
      "private process drill failed; keep auth stopped: " +
        JSON.stringify(failure),
    );
    this.failure = failure;
  }
}

export function checkProcessResult(stage, result, expected) {
  if (result.status !== expected)
    throw new ProcessDrillFailure(stage, {
      ...processOutcome(result),
      reason: "unexpected-exit",
    });
  return result;
}

export async function withProcessCleanup(body, cleanup) {
  let value;
  let bodyError;
  let bodyFailed = false;
  try {
    value = await body();
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!bodyFailed) throw cleanupError;
    const describe = (error) =>
      error instanceof ProcessDrillFailure
        ? JSON.stringify(error.failure)
        : "other test failure";
    throw new AggregateError(
      [bodyError, cleanupError],
      `private process drill failed; keep auth stopped; body=${describe(bodyError)}; cleanup=${describe(cleanupError)}`,
      { cause: bodyError },
    );
  }
  if (bodyFailed) throw bodyError;
  return value;
}

const cliTokens = new Set([
  "CLI_FAILED",
  "CLI_USAGE_INVALID",
  "CLI_COMPLETED",
  "DIAGNOSTIC_SUPPRESSED",
  "HEALTH_STOP_REQUIRED",
  "HEALTH_DISABLED",
]);
export function cliProtocolToken(result) {
  for (const output of [result.stdout, result.stderr]) {
    for (const line of String(output ?? "").split("\n")) {
      if (cliTokens.has(line.trim())) return line.trim();
      try {
        const code = JSON.parse(line)?.code;
        if (cliTokens.has(code)) return code;
      } catch {
        continue;
      }
    }
  }
  return null;
}
