import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminService } from "@services/admin";
import { Btn, Chip } from "../../components/ui";
import { ServiceError } from "../../services/service-error";

// Only local completion is observable; remote transfer is never inferred.
const STATUS_LABEL = "로컬 완료 · 원격 미확인";
const NOT_CONFIGURED_NOTE =
  "백업 저장 위치와 수신자 설정이 확인되지 않아 백업을 실행할 수 없어요. 기존 목록은 확인할 수 있어요.";

function formatInstant(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function requestMessage(error) {
  if (!(error instanceof ServiceError)) return "백업 요청을 접수하지 못했어요.";
  if (error.code === "BACKUP_IN_PROGRESS")
    return "이미 백업이 실행 중이에요. 진행 상태를 확인해 주세요.";
  if (error.code === "BACKUP_NOT_CONFIGURED")
    return "백업이 구성되지 않아 실행할 수 없어요.";
  return error.message;
}

function currentNote(run) {
  if (!run) return "새 백업은 이 버튼을 눌렀을 때 시작합니다.";
  if (run.state === "running")
    return "백업을 실행하고 있어요. 완료되면 목록을 새로 고칩니다.";
  if (run.state === "local_only") return `최근 백업: ${STATUS_LABEL}`;
  if (run.state === "failed")
    return "최근 백업이 실패했어요. 서버 기록을 확인해 주세요.";
  return "최근 백업이 거부됐어요. 다른 백업이 실행 중이었거나 구성이 바뀌었을 수 있어요.";
}

export function BackupControls({ active, scopeKey, readContext }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const sending = useRef(false);
  const query = useQuery({
    queryKey: [__DATA_MODE__, "admin", "backups", scopeKey],
    enabled: Boolean(active),
    queryFn: ({ signal }) => adminService.listBackups({ signal, readContext }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (current) =>
      document.visibilityState === "visible" &&
      current.state.status !== "error" &&
      current.state.data?.current?.state === "running"
        ? 2000
        : false,
    refetchIntervalInBackground: false,
  });
  const data = query.data;
  const running = data?.current?.state === "running";
  const canRun = Boolean(data?.configured) && !running && !pending;

  async function run() {
    if (!canRun || sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      await adminService.createBackup();
      if (readContext && !readContext.isCurrent()) return;
      // Keep the button busy until the read reports the running state.
      await query.refetch();
    } catch (failure) {
      if (!readContext || readContext.isCurrent())
        setError(requestMessage(failure));
      if (
        failure instanceof ServiceError &&
        failure.code === "BACKUP_IN_PROGRESS"
      )
        void query.refetch();
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const note = query.isPending
    ? "백업 상태를 불러오고 있어요."
    : query.isError
      ? "백업 상태를 조회하지 못했어요."
      : !data.configured
        ? NOT_CONFIGURED_NOTE
        : pending
          ? "백업을 접수하고 있어요."
          : currentNote(data.current);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/70 px-6 py-4">
        <h2
          id="admin-backups-title"
          className="text-[14px] font-bold text-neutral-900"
        >
          데이터베이스 백업
        </h2>
        <Btn
          size="sm"
          variant="line"
          disabled={!canRun}
          aria-describedby="backup-note"
          onClick={() => void run()}
        >
          {pending ? "접수 중…" : "백업 실행"}
        </Btn>
      </div>
      <p
        id="backup-note"
        role="status"
        aria-live="polite"
        className="border-b border-neutral-200/70 px-6 py-3 text-[12px] text-neutral-500"
      >
        {note}
      </p>
      {__DATA_MODE__ === "mock" ? (
        <p className="border-b border-neutral-200/70 px-6 py-2 text-[11px] text-neutral-500">
          개발용 합성 시연이며 실제 백업 파일을 만들지 않습니다.
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="border-b border-neutral-200/70 px-6 py-3 text-[12px] text-rose-700"
        >
          {error}
        </p>
      ) : null}
      {query.isError ? (
        <div className="px-6 py-8" role="alert">
          <p className="text-[13px] text-rose-700">
            백업 목록을 불러오지 못했어요.
          </p>
          <Btn
            className="mt-3"
            size="sm"
            variant="line"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            다시 시도
          </Btn>
        </div>
      ) : data && data.items.length === 0 ? (
        <p className="px-6 py-8 text-[13px] text-neutral-500">
          백업 기록이 없어요.
        </p>
      ) : data ? (
        <div role="list" aria-label="백업 목록">
          {data.items.map((item) => (
            <div
              key={item.runId}
              role="listitem"
              className="border-b border-neutral-200/70 px-5 py-4 last:border-0 sm:px-6"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-600">
                <span className="whitespace-nowrap">
                  생성 {formatInstant(item.createdAt)}
                </span>
                <span className="whitespace-nowrap">
                  만료 {formatInstant(item.originalExpiresAt)}
                </span>
                <span className="whitespace-nowrap">
                  {formatBytes(item.ciphertextBytes)}
                </span>
                <span
                  className="min-w-0 max-w-full truncate font-mono text-[11.5px] text-neutral-400"
                  title={item.releaseId}
                >
                  릴리스 {item.releaseId}
                </span>
                <Chip tone="blue">{STATUS_LABEL}</Chip>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {data?.invalidCount > 0 ? (
        <p className="border-t border-neutral-200/70 px-6 py-3 text-[12px] text-neutral-500">
          검증되지 않은 항목 {data.invalidCount}개는 표시하지 않았어요.
        </p>
      ) : null}
    </>
  );
}
