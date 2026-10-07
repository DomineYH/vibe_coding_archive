import { useCallback, useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { Avatar, Btn, StatusBadge } from "../../components/ui";
import { formatCheckedAt } from "../../components/presentation";
import catalog from "../../../../contracts/catalog.json";
import { adminService } from "@services/admin";
import { healthService } from "@services/health";
import { ServiceError } from "../../services/service-error";
import { HealthCheckControl } from "./health-check-control";

const PAGE_SIZE = 24;
const APPS_DENIED_CODES = new Set([
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "PASSWORD_CHANGE_REQUIRED",
  "SESSION_KIND_NOT_ALLOWED",
  "AUTH_STATE_CHANGED",
  "AUTH_TRANSITION_PENDING",
]);

function readAdminTab(search) {
  if (!search || search === "?") return { tab: "users", invalid: false };
  const params = new URLSearchParams(search);
  const keys = [...params.keys()];
  const value = params.get("tab");
  return keys.length === 1 &&
    keys[0] === "tab" &&
    ["users", "health"].includes(value)
    ? { tab: value, invalid: false }
    : { tab: "users", invalid: true };
}

function dateOnly(value) {
  return value.slice(0, 10);
}

function operationMessage(error) {
  if (!(error instanceof ServiceError))
    return "승인 요청 결과를 확인할 수 없어요. 결과를 먼저 확인해 주세요.";
  if (error.code === "ADMIN_ACCOUNT_PROTECTED")
    return "관리자 계정은 승인 상태를 변경할 수 없어요.";
  if (error.code === "USER_NOT_FOUND")
    return "회원을 찾을 수 없어요. 목록을 새로 확인해 주세요.";
  if (error.code === "USER_STATE_CONFLICT")
    return "회원 상태가 바뀌었어요. 현재 상태를 다시 확인해 주세요.";
  if (error.code === "OPERATION_KEY_MISMATCH")
    return "같은 작업 키의 입력이 달라 처리하지 않았어요.";
  if (error.code === "OPERATION_ALREADY_RESOLVED")
    return "이 작업은 이미 확정됐어요. 결과를 확인해 주세요.";
  return error.outcome === "unknown"
    ? "처리가 끝났을 수 있지만 응답이 확정되지 않았어요. 현재 상태로 성공을 추정하지 말고 결과를 확인해 주세요."
    : error.message;
}

function AdminStats({ stats }) {
  const cards = [
    {
      label: "전체 사용자",
      value: stats.totalUsers,
      tone: "border-l-[#4C7A96]",
    },
    {
      label: "승인 대기",
      value: stats.pendingUsers,
      tone: "border-l-[#B77A36]",
    },
    { label: "등록된 앱", value: stats.totalApps, tone: "border-l-[#4C7A96]" },
    {
      label: "정상 가동",
      value: `${stats.healthyApps} / ${stats.totalApps}`,
      tone: "border-l-[#A33C43]",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={`min-h-[92px] rounded-[22px] border-l-[3px] ${card.tone} bg-white px-5 py-4 shadow-sm`}
        >
          <dt className="text-[11px] tracking-[0.12em] text-neutral-500">
            {card.label}
          </dt>
          <dd className="mt-1 text-[25px] font-extrabold tracking-tight text-neutral-900">
            {card.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ApprovalPanel({
  target,
  loading,
  busy,
  error,
  operation,
  onConfirm,
  onClose,
  onRetryDetail,
  onReadResult,
  onResubmit,
  onCancelOperation,
  operationExpired,
}) {
  if (loading)
    return (
      <div className="mx-5 mb-4 rounded-2xl bg-neutral-100 px-4 py-3 text-[13px] text-neutral-600 sm:mx-6">
        승인 대상을 다시 확인하고 있어요.
      </div>
    );
  if (!target)
    return (
      <div className="mx-5 mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-[13px] text-rose-800 sm:mx-6">
        <p role="alert">{error || "회원을 다시 불러오지 못했어요."}</p>
        <Btn size="sm" variant="line" onClick={onRetryDetail}>
          대상 다시 확인
        </Btn>
      </div>
    );

  const nextApproved = !target.approved;
  const title = nextApproved ? "승인하기" : "승인 해제";
  const resultUnresolved = operation?.state === "unresolved";
  const resultRejected = operation?.state === "rejected";
  const resultSucceeded = operation?.state === "succeeded";
  const displayedApproved = resultSucceeded
    ? operation.appliedApproved
    : nextApproved;
  const displayedVersion = resultSucceeded
    ? operation.appliedAccountVersion
    : target.accountVersion;
  return (
    <section
      className="mx-5 mb-4 rounded-2xl border border-[#4C7A96]/20 bg-[#4C7A96]/[0.06] px-4 py-4 sm:mx-6 sm:px-5"
      aria-labelledby="approval-confirm-title"
      aria-busy={busy}
    >
      <h3
        id="approval-confirm-title"
        className="text-[14px] font-bold text-neutral-900"
      >
        회원 승인 확인 · {target.nickname}
      </h3>
      <p className="mt-1 text-[12px] leading-5 text-neutral-600">
        승인 값: <strong>{displayedApproved ? "승인" : "미승인"}</strong>
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        {resultSucceeded ? "반영 버전" : "대상 버전"}:{" "}
        <strong>{displayedVersion}</strong>
      </p>
      {!resultSucceeded ? (
        <p className="mt-1 text-[12px] leading-5 text-neutral-500">
          {nextApproved
            ? "승인 후 회원은 로그인할 수 있습니다. 자동 로그인은 되지 않습니다."
            : "승인을 해제하면 이 회원의 현재 접근이 차단됩니다."}
        </p>
      ) : null}
      {operation ? (
        <div className="mt-3 border-t border-[#4C7A96]/15 pt-3">
          {resultUnresolved ? (
            operationExpired ? (
              <>
                <p
                  role="status"
                  className="text-[13px] font-semibold text-amber-800"
                >
                  작업 키가 만료되어 과거 결과를 확인할 수 없어요. 현재 회원
                  상태를 다시 확인한 뒤 새 판단을 내려 주세요.
                </p>
                <Btn
                  className="mt-3"
                  size="sm"
                  variant="line"
                  onClick={onRetryDetail}
                  disabled={busy}
                >
                  현재 회원 상태 다시 확인
                </Btn>
              </>
            ) : (
              <>
                <p
                  role="status"
                  className="text-[13px] font-semibold text-amber-800"
                >
                  처리 결과가 아직 확정되지 않았어요. 회원 상태만으로 성공을
                  추정하지 않았습니다.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Btn
                    size="sm"
                    variant="line"
                    onClick={onReadResult}
                    disabled={busy}
                  >
                    결과 확인
                  </Btn>
                  <Btn
                    size="sm"
                    variant="line"
                    onClick={onResubmit}
                    disabled={busy}
                  >
                    같은 승인 요청 다시 제출
                  </Btn>
                  <Btn
                    size="sm"
                    variant="line"
                    onClick={onCancelOperation}
                    disabled={busy}
                  >
                    승인 요청 취소
                  </Btn>
                </div>
              </>
            )
          ) : resultRejected ? (
            <p
              role="status"
              className="text-[13px] font-semibold text-neutral-700"
            >
              {operation.rejectionCode === "OPERATION_CANCELLED"
                ? "승인 요청을 취소했어요."
                : operation.rejectionCode === "USER_STATE_CONFLICT"
                  ? "다른 변경이 먼저 확정되어 요청을 적용하지 않았어요."
                  : "승인 요청이 적용되지 않았어요."}
            </p>
          ) : operation.state === "succeeded" ? (
            <p
              role="status"
              className="text-[13px] font-semibold text-emerald-800"
            >
              요청한 승인 상태가 확정됐어요. 현재 상태와 통계를 다시
              확인했습니다.
            </p>
          ) : null}
          {error && !(operationExpired && resultUnresolved) ? (
            <p role="alert" className="mt-2 text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn onClick={onConfirm} disabled={busy}>
            {busy ? "처리 중…" : `${title} 확인`}
          </Btn>
          <Btn variant="line" onClick={onClose} disabled={busy}>
            취소
          </Btn>
          {error ? (
            <p role="alert" className="basis-full text-[12px] text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
      )}
      {operation?.state !== "unresolved" ? (
        <div className="mt-3">
          <Btn size="sm" variant="line" onClick={onClose} disabled={busy}>
            닫기
          </Btn>
        </div>
      ) : null}
    </section>
  );
}

function resetOperationMessage(error) {
  if (!(error instanceof ServiceError))
    return "초기화 결과를 확인할 수 없어요. 결과를 먼저 확인해 주세요.";
  if (error.code === "ADMIN_ACCOUNT_PROTECTED")
    return "관리자 계정은 비밀번호를 초기화할 수 없어요.";
  if (error.code === "USER_NOT_FOUND")
    return "회원을 찾을 수 없어요. 현재 상태를 다시 확인해 주세요.";
  if (error.code === "USER_STATE_CONFLICT")
    return "회원 상태가 바뀌었어요. 현재 상태를 다시 확인해 주세요.";
  if (error.code === "OPERATION_KEY_MISMATCH")
    return "같은 작업 키의 입력이 달라 초기화를 적용하지 않았어요.";
  if (error.code === "OPERATION_ALREADY_RESOLVED")
    return "이 작업은 이미 확정됐어요. 결과를 확인해 주세요.";
  return error.outcome === "unknown"
    ? "처리가 끝났을 수 있지만 응답이 확정되지 않았어요. 결과를 확인해 주세요."
    : error.message;
}

function deleteOperationMessage(error) {
  if (!(error instanceof ServiceError))
    return "삭제 결과를 확인할 수 없어요. 같은 작업 키의 결과를 확인해 주세요.";
  if (error.code === "ADMIN_ACCOUNT_PROTECTED")
    return "관리자 계정은 삭제할 수 없어요.";
  if (error.code === "APP_COUNT_CONFLICT")
    return "소유 앱 수가 바뀌었어요. 현재 회원과 앱 수를 다시 확인해 주세요.";
  if (error.code === "USER_NOT_FOUND")
    return "현재 회원을 찾을 수 없어요. 과거 삭제 결과는 작업 키로 확인해 주세요.";
  if (error.code === "OPERATION_KEY_MISMATCH")
    return "같은 작업 키의 삭제 조건이 달라 처리하지 않았어요.";
  if (error.code === "OPERATION_ALREADY_RESOLVED")
    return "이 삭제 작업은 이미 확정됐어요. 결과를 확인해 주세요.";
  return error.outcome === "unknown"
    ? "삭제 결과가 아직 확정되지 않았어요. 현재 대상이 없다는 사실만으로 성공을 추정하지 말고 작업 키로 확인해 주세요."
    : error.message;
}

function formatPasswordExpiry(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function batchRequestMessage(error) {
  if (!(error instanceof ServiceError))
    return "전체 검사 요청을 접수하지 못했어요.";
  if (error.code === "RATE_LIMITED")
    return error.retryAt
      ? `전체 검사 대기 시간입니다. ${formatPasswordExpiry(error.retryAt)} (KST) 이후 다시 요청해 주세요.`
      : error.message;
  if (error.code === "FEATURE_UNAVAILABLE")
    return "현재 전체 연결 검사를 사용할 수 없어요.";
  return error.message;
}

function HealthBatchControls({ stats, scopeKey, readContext, canRequest }) {
  const queryClient = useQueryClient();
  const [acceptedBatchId, setAcceptedBatchId] = useState(null);
  const [acceptedDisposition, setAcceptedDisposition] = useState(null);
  const [requestError, setRequestError] = useState(null);
  const [requestPending, setRequestPending] = useState(false);
  const [requeryPending, setRequeryPending] = useState(false);
  const requestPendingRef = useRef(false);
  const requeryPendingRef = useRef(false);
  const batchId =
    stats?.activeHealthBatchId ??
    acceptedBatchId ??
    stats?.latestHealthBatchId ??
    null;
  const batchKey = [
    __DATA_MODE__,
    "admin",
    "health-batch",
    batchId ?? "",
    scopeKey,
  ];
  const batchQuery = useQuery({
    queryKey: batchKey,
    enabled: Boolean(batchId),
    queryFn: ({ signal }) =>
      healthService.getBatch(batchId, { signal, readContext }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      document.visibilityState === "visible" &&
      query.state.status !== "error" &&
      !query.state.data?.isFinished
        ? 2000
        : false,
    refetchIntervalInBackground: false,
  });

  const refreshDashboard = useCallback(() => {
    return Promise.all([
      queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "admin", "users", scopeKey],
      }),
      queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "admin", "apps", scopeKey],
      }),
    ]);
  }, [queryClient, scopeKey]);

  useEffect(() => {
    if (!batchQuery.data?.id) return;
    void refreshDashboard();
  }, [
    batchQuery.data?.id,
    batchQuery.data?.processedCount,
    batchQuery.data?.isFinished,
    refreshDashboard,
  ]);

  async function requestBatch() {
    if (requestPendingRef.current || !canRequest) return;
    requestPendingRef.current = true;
    setRequestPending(true);
    setRequestError(null);
    try {
      const accepted = await healthService.requestBatch();
      if (readContext && !readContext.isCurrent()) return;
      setAcceptedBatchId(accepted.batch.id);
      setAcceptedDisposition(accepted.disposition);
      void refreshDashboard();
    } catch (error) {
      setRequestError(batchRequestMessage(error));
    } finally {
      requestPendingRef.current = false;
      setRequestPending(false);
    }
  }

  async function requeryBatch() {
    if (!batchId || requeryPendingRef.current) return;
    requeryPendingRef.current = true;
    setRequeryPending(true);
    try {
      const batch = await healthService.getBatch(batchId, { readContext });
      queryClient.setQueryData(batchKey, batch);
    } catch {
      // Keep the read error visible and stop automatic polling.
    } finally {
      requeryPendingRef.current = false;
      setRequeryPending(false);
    }
  }

  const batch = batchQuery.data;
  const note = batchQuery.isError
    ? "전체 검사 진행 조회를 멈췄어요. 검사 작업 결과에는 영향을 주지 않았습니다."
    : requestPending
      ? "전체 검사를 접수하고 있어요."
      : batch?.isFinished
        ? "최근 전체 검사가 완료됐어요."
        : batch
          ? "전체 검사를 진행하고 있어요."
          : batchId
            ? "최근 전체 검사 진행 상태를 불러오고 있어요."
            : "새 전체 검사는 이 버튼을 눌렀을 때 시작합니다.";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/70 px-6 py-4">
        <h2
          id="admin-health-title"
          className="text-[14px] font-bold text-neutral-900"
        >
          네트워크 활성 상태 모니터링
        </h2>
        <Btn
          size="sm"
          variant="line"
          onClick={() => void requestBatch()}
          disabled={requestPending || !canRequest}
          aria-describedby="health-check-note"
        >
          {requestPending ? "접수 중…" : "전체 재검사"}
        </Btn>
      </div>
      <p
        id="health-check-note"
        role="status"
        aria-live="polite"
        className="border-b border-neutral-200/70 px-6 py-3 text-[12px] text-neutral-500"
      >
        {canRequest ? note : "현재 전체 연결 검사를 사용할 수 없어요."}
      </p>
      {__DATA_MODE__ === "mock" ? (
        <p className="border-b border-neutral-200/70 px-6 py-2 text-[11px] text-neutral-500">
          개발용 합성 시연이며 외부 사이트에 요청을 보내지 않습니다.
        </p>
      ) : null}
      {requestError ? (
        <p
          role="alert"
          className="border-b border-neutral-200/70 px-6 py-3 text-[12px] text-rose-700"
        >
          {requestError}
        </p>
      ) : null}
      {batchQuery.isError ? (
        <div className="border-b border-neutral-200/70 px-6 py-3 text-[12px] text-rose-700">
          <p role="alert">전체 검사 진행 상태를 불러오지 못했어요.</p>
          <Btn
            className="mt-2"
            size="sm"
            variant="line"
            onClick={() => void requeryBatch()}
            disabled={requeryPending}
          >
            {requeryPending ? "조회 중…" : "진행 다시 조회"}
          </Btn>
        </div>
      ) : null}
      {batch ? (
        <section
          aria-label="전체 검사 진행 상황"
          aria-live="off"
          className="border-b border-neutral-200/70 bg-neutral-50/70 px-6 py-3 text-[12px] text-neutral-600"
        >
          <p className="font-semibold text-neutral-800">
            {batch.isFinished ? "전체 검사 완료" : "전체 검사 진행 중"}
            {!batch.isFinished &&
            acceptedBatchId === batch.id &&
            acceptedDisposition === "active_reused"
              ? " · 진행 중인 검사 재사용"
              : acceptedBatchId !== batch.id
                ? " · 최근 검사 기록"
                : ""}
          </p>
          <p className="mt-1">
            처리 {batch.processedCount}/{batch.targetCount} · 결과 확보{" "}
            {batch.counts.resultObtained} · 실패 {batch.counts.failed} · 취소{" "}
            {batch.counts.cancelled}
          </p>
          <p className="mt-0.5">
            이전 결과 재사용 {batch.counts.reused}건 (결과 확보에 포함)
          </p>
        </section>
      ) : null}
    </>
  );
}

function PasswordResetPanel({
  target,
  loading,
  busy,
  error,
  operation,
  operationKey,
  expectedAccountVersion,
  operationExpired,
  onSubmit,
  onReadResult,
  onCancelOperation,
  onRetryTarget,
  onFreshTarget,
  onClose,
}) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const hasPendingKey = Boolean(operationKey && !operation);
  const unresolved = operation?.state === "unresolved" || hasPendingKey;
  const versionMatches =
    (!operation && !operationKey) ||
    expectedAccountVersion === target?.accountVersion;
  const canEnterPassword =
    !loading &&
    target?.role === "user" &&
    !operationExpired &&
    (!operation || operation.state === "unresolved") &&
    !hasPendingKey &&
    versionMatches;

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const normalized = password.normalize("NFC");
    const confirmation = passwordConfirm.normalize("NFC");
    const errors = {};
    const length = Array.from(normalized).length;
    if (length < 15 || length > 128)
      errors.password = "비밀번호는 15~128자로 입력해 주세요.";
    if (!confirmation)
      errors.passwordConfirm = "비밀번호를 한 번 더 입력해 주세요.";
    else if (normalized !== confirmation)
      errors.passwordConfirm = "비밀번호 확인이 일치하지 않습니다.";
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setPassword("");
    setPasswordConfirm("");
    await onSubmit(normalized);
  }

  return (
    <section
      className="mx-5 mb-4 rounded-2xl border border-[#4C7A96]/20 bg-[#4C7A96]/[0.06] px-4 py-4 sm:mx-6 sm:px-5"
      aria-labelledby="password-reset-title"
      aria-busy={busy || loading}
    >
      <h3
        id="password-reset-title"
        className="text-[14px] font-bold text-neutral-900"
      >
        임시 비밀번호 초기화 확인
        {target ? ` · ${target.nickname}` : ""}
      </h3>
      {loading ? (
        <p role="status" className="mt-2 text-[13px] text-neutral-600">
          초기화 대상과 현재 상태를 다시 확인하고 있어요.
        </p>
      ) : null}
      {target ? (
        <>
          <p className="mt-1 text-[12px] leading-5 text-neutral-600">
            로그인 아이디: <strong>{target.loginId}</strong>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            대상 버전: <strong>{target.accountVersion}</strong>
            <span className="mx-2" aria-hidden="true">
              ·
            </span>
            승인 상태: <strong>{target.approved ? "승인" : "미승인"}</strong>
          </p>
          <p className="mt-1 text-[12px] leading-5 text-neutral-500">
            승인은 바뀌지 않습니다. 기존 로그인 세션을 무효화하고 24시간 안에
            본인 비밀번호를 바꿔야 하는 임시 비밀번호를 설정합니다.
          </p>
        </>
      ) : null}
      {operation?.state === "succeeded" ? (
        <div className="mt-3 border-t border-[#4C7A96]/15 pt-3">
          <p
            role="status"
            className="text-[13px] font-semibold text-emerald-800"
          >
            임시 비밀번호 설정이 확정됐어요. 승인 상태는 그대로 유지됩니다.
          </p>
          {operation.temporaryPasswordExpiresAt ? (
            <p className="mt-2 text-[12px] leading-5 text-neutral-600">
              본인 비밀번호 변경 기한:{" "}
              <strong>
                {formatPasswordExpiry(operation.temporaryPasswordExpiresAt)}
              </strong>
              (KST)
            </p>
          ) : null}
          <p className="mt-2 text-[12px] leading-5 text-neutral-500">
            회원 로그인·본인 확인·비밀번호 전달은 확인하지 않았어요. 비밀번호는
            이 화면에 다시 표시되지 않습니다.
          </p>
        </div>
      ) : operation?.state === "rejected" ? (
        <p
          role="status"
          className="mt-3 text-[13px] font-semibold text-neutral-700"
        >
          {operation.rejectionCode === "OPERATION_CANCELLED"
            ? "초기화 요청 취소가 확정됐어요."
            : operation.rejectionCode === "USER_STATE_CONFLICT"
              ? "다른 변경이 먼저 확정되어 초기화를 적용하지 않았어요. 현재 상태를 다시 확인해 주세요."
              : operation.rejectionCode === "ADMIN_ACCOUNT_PROTECTED"
                ? "관리자 계정은 초기화할 수 없어요."
                : operation.rejectionCode === "USER_NOT_FOUND"
                  ? "회원을 찾을 수 없어 초기화를 적용하지 않았어요."
                  : "초기화 요청을 적용하지 않았어요."}
        </p>
      ) : unresolved ? (
        <div className="mt-3 border-t border-[#4C7A96]/15 pt-3">
          <p role="status" className="text-[13px] font-semibold text-amber-800">
            처리 결과가 아직 확정되지 않았어요. 현재 계정 상태로 성공을 추정하지
            않았습니다.
          </p>
          {operationExpired ? (
            <p className="mt-1 text-[12px] text-neutral-600">
              작업 키가 만료되어 과거 결과를 확인할 수 없어요.
            </p>
          ) : null}
          {operation && !operationExpired && !versionMatches ? (
            <p className="mt-1 text-[12px] text-neutral-600">
              대상 버전이 바뀌어 같은 요청을 다시 제출할 수 없어요. 결과를
              확인하거나 요청을 취소한 뒤 새 판단을 내려 주세요.
            </p>
          ) : null}
        </div>
      ) : null}
      {target?.role === "admin" ? (
        <p role="alert" className="mt-2 text-[12px] text-rose-700">
          관리자 계정은 비밀번호 초기화 대상이 아닙니다.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-rose-700">
          {error}
        </p>
      ) : null}
      {operation?.state === "rejected" ? (
        <Btn
          className="mt-3"
          size="sm"
          variant="line"
          onClick={onFreshTarget}
          disabled={busy}
        >
          현재 회원 확인 후 새 초기화 판단
        </Btn>
      ) : null}
      {operationExpired ? (
        <Btn
          className="mt-3"
          size="sm"
          variant="line"
          onClick={onRetryTarget}
          disabled={busy}
        >
          현재 회원 상태 다시 확인
        </Btn>
      ) : null}
      {!target && !loading && !operationExpired ? (
        <Btn
          className="mt-3"
          size="sm"
          variant="line"
          onClick={onRetryTarget}
          disabled={busy}
        >
          대상 다시 확인
        </Btn>
      ) : null}
      {canEnterPassword ? (
        <form
          onSubmit={submit}
          aria-busy={busy}
          className="mt-4 flex flex-col gap-3 border-t border-[#4C7A96]/15 pt-4"
        >
          <div>
            <label
              htmlFor="temporary-password"
              className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
            >
              임시 비밀번호
            </label>
            <input
              id="temporary-password"
              type="password"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
              autoComplete="new-password"
              aria-required="true"
              aria-invalid={fieldErrors.password ? "true" : undefined}
              aria-describedby={
                fieldErrors.password ? "temporary-password-error" : undefined
              }
            />
            {fieldErrors.password ? (
              <p
                id="temporary-password-error"
                className="mt-1 text-[12px] text-red-700"
              >
                {fieldErrors.password}
              </p>
            ) : null}
          </div>
          <div>
            <label
              htmlFor="temporary-password-confirm"
              className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
            >
              임시 비밀번호 확인
            </label>
            <input
              id="temporary-password-confirm"
              type="password"
              className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              disabled={busy}
              autoComplete="new-password"
              aria-required="true"
              aria-invalid={fieldErrors.passwordConfirm ? "true" : undefined}
              aria-describedby={
                fieldErrors.passwordConfirm
                  ? "temporary-password-confirm-error"
                  : undefined
              }
            />
            {fieldErrors.passwordConfirm ? (
              <p
                id="temporary-password-confirm-error"
                className="mt-1 text-[12px] text-red-700"
              >
                {fieldErrors.passwordConfirm}
              </p>
            ) : null}
          </div>
          <p className="text-[11px] leading-relaxed text-neutral-500">
            15~128자 · 공백은 유지되며 NFC로 정규화됩니다. 확인 후 입력은
            지워지고 결과 확인이나 재제출 때 다시 입력해야 합니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Btn type="submit" size="sm" disabled={busy}>
              {busy
                ? "처리 중…"
                : operation
                  ? "같은 초기화 요청 다시 제출"
                  : "초기화 확인"}
            </Btn>
            {!operation ? (
              <Btn
                type="button"
                size="sm"
                variant="line"
                onClick={onClose}
                disabled={busy}
              >
                취소
              </Btn>
            ) : null}
          </div>
        </form>
      ) : null}
      {unresolved && !operationExpired ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn size="sm" variant="line" onClick={onReadResult} disabled={busy}>
            결과 확인
          </Btn>
          {operation?.state === "unresolved" || hasPendingKey ? (
            <Btn
              size="sm"
              variant="line"
              onClick={onCancelOperation}
              disabled={busy}
            >
              초기화 요청 취소
            </Btn>
          ) : null}
        </div>
      ) : null}
      {operationExpired ||
      (operation?.state !== "unresolved" && !hasPendingKey) ? (
        <div className="mt-3">
          <Btn size="sm" variant="line" onClick={onClose} disabled={busy}>
            닫기
          </Btn>
        </div>
      ) : null}
    </section>
  );
}

function UserDeletePanel({
  outcome,
  target,
  loading,
  busy,
  error,
  operation,
  operationKey,
  expectedAppCount,
  operationExpired,
  refreshRequired,
  onConfirm,
  onReadResult,
  onRetrySame,
  onRetryTarget,
  onClose,
}) {
  const succeeded = outcome === "succeeded" || operation?.state === "succeeded";
  const hasPendingKey = Boolean(operationKey && !operation);
  const unresolved = operation?.state === "unresolved";
  const confirming =
    outcome === "pending" || operation?.state === "confirming_deletion";
  const expectedCount = expectedAppCount ?? target?.appCount;
  const canConfirm =
    !loading &&
    !busy &&
    target?.role === "user" &&
    !outcome &&
    !operation &&
    !operationKey &&
    !refreshRequired;

  return (
    <section
      className="mx-5 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 sm:mx-6"
      role="region"
      aria-labelledby="admin-user-delete-title"
      aria-busy={busy || loading}
    >
      <div className="min-w-[220px] flex-1">
        <h3
          id="admin-user-delete-title"
          className="break-keep text-[13.5px] font-bold text-red-700"
        >
          {target
            ? `${target.nickname} 계정을 삭제할까요?`
            : "회원 계정 삭제 확인"}
        </h3>
        {target ? (
          <>
            <p className="mt-0.5 break-keep text-[12px] leading-relaxed text-red-600/90">
              이 사용자가 등록한 앱 {target.appCount}개도 함께 삭제되며 되돌릴
              수 없습니다.
            </p>
            <p className="mt-1 break-keep text-[12px] leading-relaxed text-neutral-600">
              로그인 아이디: <strong>{target.loginId}</strong>
              <span className="mx-2" aria-hidden="true">
                ·
              </span>
              승인 상태: <strong>{target.approved ? "승인" : "미승인"}</strong>
              <span className="mx-2" aria-hidden="true">
                ·
              </span>
              가입 신청 {dateOnly(target.createdAt)}
            </p>
          </>
        ) : null}
        {loading ? (
          <p role="status" className="mt-1 text-[12px] text-neutral-600">
            현재 회원 정보와 소유 앱 수를 다시 확인하고 있어요.
          </p>
        ) : null}
        {succeeded ? (
          <p
            role="status"
            className="mt-2 text-[12px] font-semibold text-emerald-800"
          >
            {expectedCount === null || expectedCount === undefined
              ? "회원 계정과 소유 앱 삭제가 확정됐어요."
              : `회원 계정과 소유 앱 ${expectedCount}개 삭제가 확정됐어요.`}
          </p>
        ) : operation?.state === "rejected" ? (
          <p
            role="status"
            className="mt-2 text-[12px] font-semibold text-red-700"
          >
            {operation.rejectionCode === "APP_COUNT_CONFLICT"
              ? "소유 앱 수가 달라 삭제하지 않았어요. 현재 회원 정보를 다시 확인한 뒤 재확인해 주세요."
              : operation.rejectionCode === "ADMIN_ACCOUNT_PROTECTED"
                ? "관리자 계정은 삭제할 수 없어요."
                : operation.rejectionCode === "USER_NOT_FOUND"
                  ? "현재 회원이 없어 이 작업으로 삭제하지 않았어요. 과거 삭제 여부는 이 결과와 별개예요."
                  : "삭제를 적용하지 않았어요. 현재 상태를 다시 확인해 주세요."}
          </p>
        ) : confirming ? (
          <p
            role="status"
            className="mt-2 text-[12px] font-semibold text-amber-800"
          >
            삭제는 반영됐고 별도 확인을 기다리고 있어요. 이 상태는 삭제 실패나
            롤백이 아니며 계정과 앱을 되살리지 않습니다.
          </p>
        ) : !busy && (unresolved || hasPendingKey) ? (
          <p
            role="status"
            className="mt-2 text-[12px] font-semibold text-amber-800"
          >
            삭제 결과가 아직 확정되지 않았어요. 현재 회원 상태로 성공을 추정하지
            않았습니다.
          </p>
        ) : target?.role === "admin" ? (
          <p role="alert" className="mt-2 text-[12px] text-red-700">
            관리자 계정은 삭제 대상이 아닙니다.
          </p>
        ) : null}
        {operationExpired ? (
          <p role="status" className="mt-1 text-[12px] text-neutral-600">
            작업 키가 만료되어 과거 결과를 확인할 수 없어요. 현재 회원 조회는
            이전 작업의 성공 여부를 증명하지 않습니다.
          </p>
        ) : null}
        {!target && !loading && !operation && !succeeded ? (
          <p role="alert" className="mt-1 text-[12px] text-red-700">
            현재 대상을 불러오지 못했어요. 대상이 없다는 이유만으로 삭제 성공을
            추정하지 않습니다.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-1 text-[12px] text-red-700">
            {error}
          </p>
        ) : null}
      </div>
      {canConfirm ? (
        <>
          <Btn size="sm" variant="danger" onClick={onConfirm}>
            삭제 확인
          </Btn>
          <Btn size="sm" variant="ghost" onClick={onClose}>
            취소
          </Btn>
        </>
      ) : null}
      {operationKey && outcome !== "succeeded" && !operationExpired && !busy ? (
        <Btn size="sm" variant="line" onClick={onReadResult}>
          결과 확인
        </Btn>
      ) : null}
      {unresolved &&
      !outcome &&
      !confirming &&
      !refreshRequired &&
      target &&
      expectedAppCount !== null &&
      expectedAppCount !== undefined &&
      !operationExpired ? (
        <Btn size="sm" variant="line" onClick={onRetrySame} disabled={busy}>
          같은 삭제 요청 다시 제출
        </Btn>
      ) : null}
      {(operationExpired ||
        operation?.rejectionCode === "APP_COUNT_CONFLICT" ||
        refreshRequired ||
        (!target && !loading && !operationKey)) && (
        <Btn size="sm" variant="line" onClick={onRetryTarget} disabled={busy}>
          현재 회원 정보 다시 확인
        </Btn>
      )}
      {(outcome === "succeeded" ||
        operation?.state === "succeeded" ||
        operation?.state === "rejected") && (
        <Btn size="sm" variant="line" onClick={onClose} disabled={busy}>
          닫기
        </Btn>
      )}
    </section>
  );
}

export function AdminView({
  scopeKey,
  meta,
  active = true,
  resumeState,
  onConsumeResume,
  onSaveResume,
  onRememberDelete,
  readContext,
  onAuthRecheck,
}) {
  const canReset =
    __DATA_MODE__ === "mock" ||
    meta?.capabilities.admin_password_reset.enabled === true;
  const canDelete =
    __DATA_MODE__ === "mock" ||
    meta?.capabilities.admin_user_delete.enabled === true;
  const canReadApps =
    __DATA_MODE__ === "mock" ||
    meta?.capabilities.admin_apps_read.enabled === true;
  const canApprove =
    __DATA_MODE__ === "mock" ||
    meta?.capabilities.admin_approval.enabled === true;
  const canCheckHealth = meta?.capabilities.health_check.enabled === true;
  const canRequestBatch = meta?.capabilities.health_batch.enabled === true;
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const route = readAdminTab(location.search);
  const tab = route.tab;
  const [selection, setSelection] = useState(null);
  const [resetSelection, setResetSelection] = useState(null);
  const [deleteSelection, setDeleteSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [resetError, setResetError] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [operationExpired, setOperationExpired] = useState(false);
  const [resetOperationExpired, setResetOperationExpired] = useState(false);
  const [deleteOperationExpired, setDeleteOperationExpired] = useState(false);
  const alive = useRef(true);
  const detailRequest = useRef(0);
  const pendingSelection = useRef(selection);
  pendingSelection.current = selection;
  const resetDetailRequest = useRef(0);
  const resetOwner = useRef({ active, scopeKey });
  resetOwner.current = {
    active: active && !route.invalid && tab === "users",
    scopeKey,
  };
  function ownsReset(request, owner) {
    return (
      alive.current &&
      resetOwner.current.active &&
      resetOwner.current.scopeKey === owner &&
      request === resetDetailRequest.current
    );
  }
  useEffect(() => {
    ++resetDetailRequest.current;
    setResetSelection(null);
    setResetBusy(false);
    setResetError("");
  }, [active, scopeKey, route.invalid, tab]);
  const retiredUserIds = useRef(new Set());
  const deleteDetailRequest = useRef(0);
  const deleteOwner = useRef(null);
  const deleteSubmitting = useRef(false);
  useEffect(() => {
    if (!active || !deleteSelection) return;
    onRememberDelete?.(
      deleteSelection?.operationKey
        ? {
            targetId: deleteSelection.id,
            operationKey: deleteSelection.operationKey,
            expectedAppCount: deleteSelection.expectedAppCount,
          }
        : null,
    );
  }, [active, deleteSelection, onRememberDelete]);
  deleteOwner.current = {
    active: active && !route.invalid && tab === "users",
    scopeKey,
    id: deleteSelection?.id,
  };
  const ownsDelete = useCallback(
    (request, owner, id = deleteOwner.current.id) => {
      return (
        alive.current &&
        deleteOwner.current.active &&
        deleteOwner.current.scopeKey === owner &&
        request === deleteDetailRequest.current &&
        deleteOwner.current.id === id
      );
    },
    [],
  );
  useEffect(() => {
    ++deleteDetailRequest.current;
    deleteSubmitting.current = false;
    setDeleteBusy(false);
  }, [active, scopeKey, route.invalid, tab]);
  useEffect(() => {
    const request = ++detailRequest.current;
    const current = pendingSelection.current;
    if (!active || !current) return;
    setSelection({ ...current, loading: true, error: "" });
    void adminService
      .getUser(current.id)
      .then((target) => {
        if (!alive.current || request !== detailRequest.current) return;
        const changed =
          current.target &&
          target.accountVersion !== current.target.accountVersion;
        setSelection({
          ...current,
          target: changed ? null : target,
          loading: false,
          error: changed
            ? "회원 상태가 바뀌었어요. 현재 상태를 다시 확인해 주세요."
            : "",
        });
      })
      .catch((error) => {
        if (!alive.current || request !== detailRequest.current) return;
        if (["NOT_FOUND", "FORBIDDEN", "AUTH_REQUIRED"].includes(error?.code))
          setSelection(null);
        else
          setSelection({
            ...current,
            target: null,
            loading: false,
            error: "대상을 확인할 수 없어요. 다시 확인해 주세요.",
          });
      });
  }, [active, scopeKey]);
  const usersKey = [__DATA_MODE__, "admin", "users", scopeKey];
  const query = useInfiniteQuery({
    queryKey: usersKey,
    enabled: active && !route.invalid,
    queryFn: ({ pageParam, signal }) =>
      adminService.listUsers(
        { limit: PAGE_SIZE, offset: pageParam },
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const appsKey = [__DATA_MODE__, "admin", "apps", scopeKey];
  const [deniedScope, setDeniedScope] = useState(null);
  const appsOwner = useRef(null);
  appsOwner.current = { active: active && canReadApps, scopeKey };
  const authRecheck = useRef(onAuthRecheck);
  authRecheck.current = onAuthRecheck;
  const retireApps = useCallback(
    (scope) => {
      const key = [__DATA_MODE__, "admin", "apps", scope];
      void queryClient
        .cancelQueries({ queryKey: key, exact: true })
        .then(() => queryClient.removeQueries({ queryKey: key, exact: true }));
    },
    [queryClient],
  );
  const appsQuery = useInfiniteQuery({
    queryKey: appsKey,
    enabled:
      active &&
      !route.invalid &&
      tab === "health" &&
      canReadApps &&
      deniedScope !== scopeKey,
    queryFn: async ({ pageParam, signal }) => {
      const owns = () =>
        alive.current &&
        appsOwner.current.active &&
        appsOwner.current.scopeKey === scopeKey;
      const stale = () =>
        new DOMException("Admin app read ownership changed", "AbortError");
      try {
        const result = await adminService.listApps(
          { limit: PAGE_SIZE, offset: pageParam },
          { signal, readContext },
        );
        if (!owns()) throw stale();
        return result;
      } catch (error) {
        if (!owns()) throw stale();
        throw error;
      }
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasMore
        ? lastPage.pagination.offset + lastPage.pagination.limit
        : undefined,
  });
  const appsAuthDenied =
    appsQuery.isError && APPS_DENIED_CODES.has(appsQuery.error?.code);
  const appsDenied = deniedScope === scopeKey || appsAuthDenied;
  const appsScope = useRef(null);
  useEffect(() => {
    const next = active && canReadApps ? scopeKey : null;
    const previous = appsScope.current;
    appsScope.current = next;
    if (previous !== null && previous !== next) retireApps(previous);
  }, [active, canReadApps, retireApps, scopeKey]);
  useEffect(() => {
    if (!appsAuthDenied) return;
    setDeniedScope(scopeKey);
    retireApps(scopeKey);
    authRecheck.current?.();
  }, [appsAuthDenied, retireApps, scopeKey]);
  const refetchResetList = query.refetch;
  const pages = query.data?.pages ?? [];
  const users = pages
    .flatMap((page) => page.items)
    .filter((user) => !retiredUserIds.current.has(user.id));
  const stats = pages[0]?.stats;
  const statsServerTime = pages[0]?.serverTime;
  const total = pages[0]?.pagination.total ?? 0;
  const pending = stats?.pendingUsers ?? 0;
  const appPages = appsDenied ? [] : (appsQuery.data?.pages ?? []);
  const appTotal = appPages[0]?.pagination.total ?? 0;
  const seenAppIds = new Set();
  const apps = [];
  let duplicateOnlyPage = false;
  appPages.forEach((page, index) => {
    const countBeforePage = apps.length;
    for (const app of page.items) {
      if (seenAppIds.has(app.id)) continue;
      seenAppIds.add(app.id);
      apps.push(app);
    }
    if (
      index === appPages.length - 1 &&
      page.items.length > 0 &&
      apps.length === countBeforePage
    )
      duplicateOnlyPage = true;
  });

  useEffect(() => {
    if (!stats?.nextHealthExpiryAt || !statsServerTime) return undefined;
    const expiresAt =
      query.dataUpdatedAt +
      Date.parse(stats.nextHealthExpiryAt) -
      Date.parse(statsServerTime);
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: [__DATA_MODE__, "admin", "users", scopeKey],
        }),
        queryClient.invalidateQueries({
          queryKey: [__DATA_MODE__, "admin", "apps", scopeKey],
        }),
      ]);
    };
    const timer = window.setTimeout(
      refresh,
      Math.max(0, expiresAt - Date.now()),
    );
    const onVisibilityChange = () => {
      if (Date.now() >= expiresAt) refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    query.dataUpdatedAt,
    queryClient,
    scopeKey,
    stats?.nextHealthExpiryAt,
    statsServerTime,
  ]);
  const resetPending = Boolean(
    resetSelection &&
    (resetSelection.operation?.state === "unresolved" ||
      (resetSelection.operationKey && !resetSelection.operation)),
  );
  const deletePending = Boolean(
    deleteSelection &&
    deleteSelection.outcome !== "succeeded" &&
    (["unresolved", "confirming_deletion"].includes(
      deleteSelection.operation?.state,
    ) ||
      (deleteSelection.operationKey && !deleteSelection.operation)),
  );

  function changeTab(nextTab) {
    if (deletePending || deleteBusy) return;
    ++resetDetailRequest.current;
    setSelection(null);
    setResetSelection(null);
    onRememberDelete?.(null);
    setDeleteSelection(null);
    setResetError("");
    setDeleteError("");
    navigate(nextTab === "health" ? "/admin?tab=health" : "/admin");
  }

  function handleTabKeyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextTab = tab === "users" ? "health" : "users";
    event.currentTarget.parentElement
      ?.querySelector(`[role="tab"][data-admin-tab="${nextTab}"]`)
      ?.focus();
    changeTab(nextTab);
  }

  function markExpired(error) {
    if (error instanceof ServiceError && error.code === "OPERATION_EXPIRED")
      setOperationExpired(true);
  }

  function markDeleteExpired(error) {
    if (error instanceof ServiceError && error.code === "OPERATION_EXPIRED")
      setDeleteOperationExpired(true);
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active) ++resetDetailRequest.current;
    const resume =
      active && !route.invalid && tab === "users"
        ? resumeState?.adminReset
        : null;
    if (!resume || typeof resume.targetId !== "string") return;
    const targetId = resume.targetId;
    const operationKey =
      typeof resume.operationKey === "string" ? resume.operationKey : null;
    const expectedAccountVersion = Number.isSafeInteger(
      resume.expectedAccountVersion,
    )
      ? resume.expectedAccountVersion
      : null;
    const request = ++resetDetailRequest.current;
    setSelection(null);
    setResetError("");
    setResetBusy(false);
    setResetOperationExpired(false);
    setResetSelection({
      id: targetId,
      target: null,
      loading: true,
      operationKey,
      expectedAccountVersion,
      operation: null,
    });

    void (async () => {
      let operation = null;
      let operationError = null;
      if (operationKey) {
        try {
          operation =
            await adminService.getPasswordResetOperation(operationKey);
        } catch (error) {
          operationError = error;
        }
      }
      if (!alive.current || request !== resetDetailRequest.current) return;
      try {
        const target = await adminService.getUser(targetId);
        if (!alive.current || request !== resetDetailRequest.current) return;
        onConsumeResume?.();
        setResetSelection({
          id: targetId,
          target,
          loading: false,
          operationKey,
          expectedAccountVersion,
          operation,
        });
        if (operation?.state === "succeeded") await refetchResetList();
        if (!alive.current || request !== resetDetailRequest.current) return;
        if (operationError) {
          if (
            operationError instanceof ServiceError &&
            operationError.code === "OPERATION_EXPIRED"
          )
            setResetOperationExpired(true);
          setResetError(resetOperationMessage(operationError));
        }
      } catch (error) {
        if (!alive.current || request !== resetDetailRequest.current) return;
        onConsumeResume?.();
        setResetSelection({
          id: targetId,
          target: null,
          loading: false,
          operationKey,
          expectedAccountVersion,
          operation,
          error:
            error instanceof Error ? error.message : "대상을 확인할 수 없어요.",
        });
        if (operation?.state === "succeeded") await refetchResetList();
        if (!alive.current || request !== resetDetailRequest.current) return;
        if (operationError) {
          if (
            operationError instanceof ServiceError &&
            operationError.code === "OPERATION_EXPIRED"
          )
            setResetOperationExpired(true);
          setResetError(resetOperationMessage(operationError));
        }
      }
    })();
  }, [
    active,
    resumeState,
    onConsumeResume,
    refetchResetList,
    route.invalid,
    tab,
  ]);

  const refreshAfterDelete = useCallback(
    async (request, owner, id) => {
      if (!ownsDelete(request, owner, id)) return;
      retiredUserIds.current.add(id);
      setDeleteSelection((current) => ({
        ...current,
        target: null,
        error: "",
      }));
      const affected = (query) =>
        query.queryKey[0] === __DATA_MODE__ &&
        ["apps", "admin", "health"].includes(query.queryKey[1]);
      await queryClient.cancelQueries({ predicate: affected });
      if (!ownsDelete(request, owner, id)) return;
      queryClient.removeQueries({
        predicate: (query) =>
          affected(query) &&
          (query.queryKey[1] === "health" ||
            query.queryKey[2] === "detail" ||
            query.queryKey[2] === "edit" ||
            // The monitor's pages may still list the deleted owner's apps;
            // the invalidation below re-reads them from offset 0.
            (query.queryKey[1] === "admin" && query.queryKey[2] === "apps")),
      });
      queryClient.setQueryData(
        [__DATA_MODE__, "admin", "users", scopeKey],
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  items: page.items.filter((user) => user.id !== id),
                })),
              }
            : data,
      );
      await queryClient.invalidateQueries({ predicate: affected });
    },
    [ownsDelete, queryClient, scopeKey],
  );

  useEffect(() => {
    if (!active || route.invalid || tab !== "users")
      ++deleteDetailRequest.current;
    const resume =
      active && !route.invalid && tab === "users"
        ? resumeState?.adminDelete
        : null;
    if (!resume || typeof resume.targetId !== "string") return;
    const targetId = resume.targetId;
    const operationKey =
      typeof resume.operationKey === "string" ? resume.operationKey : null;
    const expectedAppCount = Number.isSafeInteger(resume.expectedAppCount)
      ? resume.expectedAppCount
      : null;
    const request = ++deleteDetailRequest.current;
    const owner = scopeKey;
    deleteOwner.current.id = targetId;
    setSelection(null);
    setResetSelection(null);
    setDeleteError("");
    setDeleteBusy(false);
    setDeleteOperationExpired(false);
    setDeleteSelection({
      id: targetId,
      target: null,
      loading: true,
      operationKey,
      expectedAppCount,
      operation: null,
    });

    void (async () => {
      let operation = null;
      let operationError = null;
      if (operationKey) {
        try {
          operation = checkedDeleteResult(
            await adminService.getUserDeleteOperation(operationKey),
            operationKey,
            targetId,
          );
        } catch (error) {
          operationError = error;
        }
      }
      if (!ownsDelete(request, owner)) return;
      try {
        const target = await adminService.getUser(targetId);
        if (!ownsDelete(request, owner, targetId)) return;
        onConsumeResume?.();
        setDeleteSelection({
          id: targetId,
          target,
          loading: false,
          operationKey,
          expectedAppCount:
            expectedAppCount ?? (operationKey ? null : target.appCount),
          refreshRequired: Boolean(
            operationKey && expectedAppCount !== target.appCount,
          ),
          operation,
        });
      } catch (error) {
        if (!ownsDelete(request, owner, targetId)) return;
        onConsumeResume?.();
        setDeleteSelection({
          id: targetId,
          target: null,
          loading: false,
          operationKey,
          expectedAppCount,
          operation,
          error:
            error instanceof Error ? error.message : "대상을 확인할 수 없어요.",
        });
      }
      if (!ownsDelete(request, owner, targetId)) return;
      if (["succeeded", "confirming_deletion"].includes(operation?.state))
        await refreshAfterDelete(request, owner, targetId);
      if (!ownsDelete(request, owner, targetId)) return;
      if (operationError) {
        markDeleteExpired(operationError);
        setDeleteError(deleteOperationMessage(operationError));
      }
    })();
  }, [
    active,
    resumeState,
    onConsumeResume,
    scopeKey,
    route.invalid,
    tab,
    ownsDelete,
    refreshAfterDelete,
  ]);

  async function openApproval(user) {
    if (resetPending) return;
    ++resetDetailRequest.current;
    setResetSelection(null);
    const request = ++detailRequest.current;
    setActionError("");
    setBusy(false);
    setOperationExpired(false);
    setSelection({ id: user.id, target: null, loading: true, operation: null });
    try {
      const target = await adminService.getUser(user.id);
      if (alive.current && request === detailRequest.current)
        setSelection({
          id: target.id,
          target,
          loading: false,
          operation: null,
        });
    } catch (error) {
      if (alive.current && request === detailRequest.current)
        setSelection({
          id: user.id,
          target: null,
          loading: false,
          operation: null,
          error:
            error instanceof Error ? error.message : "대상을 확인할 수 없어요.",
        });
    }
  }

  function startResetReauthentication(
    targetId,
    operationKey = null,
    expectedAccountVersion = null,
  ) {
    ++resetDetailRequest.current;
    ++detailRequest.current;
    setBusy(false);
    setResetBusy(false);
    setSelection(null);
    setResetSelection(null);
    setResetError("");
    setResetOperationExpired(false);
    onSaveResume?.({
      tab,
      adminReset: {
        targetId,
        ...(operationKey ? { operationKey, expectedAccountVersion } : {}),
      },
    });
    navigate("/auth?mode=reauth&return_to=%2Fadmin");
  }

  function startDeleteReauthentication(
    targetId,
    operationKey = null,
    expectedAppCount = null,
  ) {
    ++deleteDetailRequest.current;
    ++detailRequest.current;
    ++resetDetailRequest.current;
    setBusy(false);
    setResetBusy(false);
    setDeleteBusy(false);
    setSelection(null);
    setResetSelection(null);
    setDeleteSelection(null);
    setDeleteError("");
    setDeleteOperationExpired(false);
    onSaveResume?.({
      tab,
      adminDelete: {
        targetId,
        ...(operationKey ? { operationKey, expectedAppCount } : {}),
      },
    });
    navigate("/auth?mode=reauth&return_to=%2Fadmin");
  }

  function beginPasswordReset(targetId) {
    if (!resetPending) startResetReauthentication(targetId);
  }

  function beginUserDelete(targetId) {
    if (!busy && !resetBusy && !resetPending && !deletePending && !deleteBusy)
      startDeleteReauthentication(targetId);
  }

  function checkedDeleteResult(operation, key, id) {
    if (operation.key !== key || operation.targetId !== id)
      throw new Error("삭제 작업 결과가 요청과 일치하지 않아요.");
    return operation;
  }

  async function readDeleteResult() {
    const key = deleteSelection?.operationKey;
    if (!key || deleteBusy || deleteSubmitting.current) return;
    const { id } = deleteSelection;
    const request = deleteDetailRequest.current;
    const owner = scopeKey;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const operation = checkedDeleteResult(
        await adminService.getUserDeleteOperation(key),
        key,
        id,
      );
      if (!ownsDelete(request, owner, id)) return;
      setDeleteSelection((current) => ({
        ...current,
        operation,
        outcome:
          operation.state === "succeeded"
            ? "succeeded"
            : operation.state === "confirming_deletion"
              ? "pending"
              : current.outcome,
        refreshRequired: operation.state === "unresolved",
      }));
      if (["succeeded", "confirming_deletion"].includes(operation.state))
        await refreshAfterDelete(request, owner, id);
    } catch (error) {
      if (!ownsDelete(request, owner, id)) return;
      markDeleteExpired(error);
      setDeleteError(deleteOperationMessage(error));
      setDeleteSelection((current) => ({
        ...current,
        operation: ["succeeded", "confirming_deletion"].includes(
          current.operation?.state,
        )
          ? current.operation
          : null,
      }));
    } finally {
      if (ownsDelete(request, owner, id)) setDeleteBusy(false);
    }
  }

  async function refreshDeleteTarget() {
    if (!deleteSelection || deleteBusy) return;
    const current = deleteSelection;
    const { id } = current;
    const request = ++deleteDetailRequest.current;
    const owner = scopeKey;
    const fresh = current.operation?.state === "rejected";
    setDeleteError("");
    setDeleteSelection({ ...current, loading: true, error: "" });
    try {
      const target = await adminService.getUser(id);
      if (!ownsDelete(request, owner, id)) return;
      const sameCount =
        !current.operationKey || current.expectedAppCount === target.appCount;
      setDeleteSelection({
        ...current,
        target,
        loading: false,
        refreshRequired: !sameCount,
        ...(fresh
          ? {
              operationKey: null,
              operation: null,
              outcome: null,
              expectedAppCount: target.appCount,
              refreshRequired: false,
            }
          : {
              expectedAppCount: current.operationKey
                ? current.expectedAppCount
                : target.appCount,
            }),
      });
      if (fresh) setDeleteOperationExpired(false);
      if (!sameCount && !fresh)
        setDeleteError(
          "소유 앱 수가 달라졌어요. 기존 작업 결과를 먼저 확인해 주세요.",
        );
    } catch (error) {
      if (ownsDelete(request, owner, id))
        setDeleteSelection({
          ...current,
          target: null,
          loading: false,
          error: error.message,
        });
    }
  }

  async function executeUserDelete(retry = false) {
    if (
      !deleteSelection?.target ||
      deleteBusy ||
      deleteSubmitting.current ||
      deleteSelection.refreshRequired ||
      deleteSelection.outcome
    )
      return;
    if (
      retry
        ? deleteSelection.operation?.state !== "unresolved"
        : Boolean(deleteSelection.operationKey || deleteSelection.operation)
    )
      return;
    const { id, target } = deleteSelection;
    const expectedAppCount =
      deleteSelection.expectedAppCount ?? target.appCount;
    const request = deleteDetailRequest.current;
    const owner = scopeKey;
    let key = retry ? deleteSelection.operationKey : null;
    deleteSubmitting.current = true;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      if (!retry) {
        const operation = await adminService.createUserDeleteOperation({
          targetId: id,
          expectedAppCount,
        });
        if (!ownsDelete(request, owner, id)) return;
        key = operation.key;
        checkedDeleteResult(operation, key, id);
        setDeleteSelection((current) => ({
          ...current,
          operationKey: key,
          operation,
          expectedAppCount,
        }));
      }
      if (!ownsDelete(request, owner, id)) return;
      await adminService.deleteUser(id, expectedAppCount, key);
      if (!ownsDelete(request, owner, id)) return;
      setDeleteSelection((current) => ({
        ...current,
        outcome: "succeeded",
        operation: null,
      }));
      await refreshAfterDelete(request, owner, id);
    } catch (error) {
      if (!ownsDelete(request, owner, id)) return;
      if (error instanceof ServiceError && error.code === "REAUTH_REQUIRED") {
        startDeleteReauthentication(id, key, key ? expectedAppCount : null);
        return;
      }
      if (key) {
        setDeleteSelection((current) => ({
          ...current,
          operationKey: key,
          expectedAppCount,
          operation: null,
          ...(error.code === "DELETION_CONFIRMATION_PENDING"
            ? { outcome: "pending" }
            : {}),
        }));
        if (error.code === "DELETION_CONFIRMATION_PENDING")
          await refreshAfterDelete(request, owner, id);
        if (!ownsDelete(request, owner, id)) return;
        try {
          const operation = checkedDeleteResult(
            await adminService.getUserDeleteOperation(key),
            key,
            id,
          );
          if (!ownsDelete(request, owner, id)) return;
          setDeleteSelection((current) => ({
            ...current,
            operation,
            outcome:
              operation.state === "succeeded"
                ? "succeeded"
                : operation.state === "confirming_deletion"
                  ? "pending"
                  : current.outcome,
            refreshRequired: operation.state === "unresolved",
          }));
          if (["succeeded", "confirming_deletion"].includes(operation.state)) {
            await refreshAfterDelete(request, owner, id);
            return;
          }
        } catch (readError) {
          if (!ownsDelete(request, owner, id)) return;
          markDeleteExpired(readError);
        }
      } else if (
        ["APP_COUNT_CONFLICT", "USER_NOT_FOUND"].includes(error.code)
      ) {
        setDeleteSelection((current) => ({
          ...current,
          refreshRequired: true,
        }));
      }
      if (!ownsDelete(request, owner, id)) return;
      markDeleteExpired(error);
      setDeleteError(deleteOperationMessage(error));
    } finally {
      if (ownsDelete(request, owner, id)) {
        deleteSubmitting.current = false;
        setDeleteBusy(false);
      }
    }
  }

  function submitUserDelete() {
    return executeUserDelete();
  }
  function retryUserDelete() {
    return executeUserDelete(true);
  }

  async function retryResetTarget(fresh = false) {
    if (!resetSelection || resetBusy) return;
    const request = ++resetDetailRequest.current;
    const owner = scopeKey;
    const { id } = resetSelection;
    setResetSelection({ ...resetSelection, loading: true, error: "" });
    try {
      const target = await adminService.getUser(id);
      if (!ownsReset(request, owner)) return;
      setResetSelection({
        ...resetSelection,
        target,
        loading: false,
        ...(fresh
          ? {
              operationKey: null,
              operation: null,
              expectedAccountVersion: target.accountVersion,
            }
          : {}),
      });
      if (fresh) {
        setResetOperationExpired(false);
        setResetError("");
      }
    } catch (error) {
      if (ownsReset(request, owner))
        setResetSelection({
          ...resetSelection,
          target: null,
          loading: false,
          error:
            error instanceof Error ? error.message : "대상을 확인할 수 없어요.",
        });
    }
  }

  async function refreshResetCurrent(targetId, operation, request, owner) {
    let target = null;
    let failed = false;
    try {
      target = await adminService.getUser(targetId);
    } catch {
      failed = true;
    }
    if (!ownsReset(request, owner)) return;
    setResetSelection((current) => ({
      ...current,
      target,
      loading: false,
      operationKey: operation.key,
      operation,
    }));
    try {
      await query.refetch({ throwOnError: true });
    } catch {
      failed = true;
    }
    if (ownsReset(request, owner) && failed)
      setResetError(
        "임시 비밀번호 설정 결과는 확정됐지만 회원 정보를 다시 불러오지 못했어요.",
      );
  }

  async function installResetResult(operation, targetId, request, owner) {
    if (!ownsReset(request, owner)) return;
    if (operation.state === "succeeded")
      await refreshResetCurrent(targetId, operation, request, owner);
    else
      setResetSelection((current) => ({
        ...current,
        operationKey: operation.key,
        operation,
      }));
  }

  async function readResetResult() {
    const key = resetSelection?.operation?.key ?? resetSelection?.operationKey;
    if (!key || resetBusy) return;
    const request = ++resetDetailRequest.current;
    const owner = scopeKey;
    const id = resetSelection.id;
    setResetBusy(true);
    setResetError("");
    try {
      const operation = await adminService.getPasswordResetOperation(key);
      await installResetResult(operation, id, request, owner);
    } catch (error) {
      if (ownsReset(request, owner)) {
        if (error instanceof ServiceError && error.code === "OPERATION_EXPIRED")
          setResetOperationExpired(true);
        setResetSelection((current) => ({
          ...current,
          operationKey: key,
          operation: null,
        }));
        setResetError(resetOperationMessage(error));
      }
    } finally {
      if (ownsReset(request, owner)) setResetBusy(false);
    }
  }

  async function submitPasswordReset(newPassword) {
    if (
      !resetSelection?.target ||
      resetBusy ||
      (resetSelection.operationKey && !resetSelection.operation)
    )
      return;
    const { target } = resetSelection;
    const expectedAccountVersion =
      resetSelection.expectedAccountVersion ?? target.accountVersion;
    const request = ++resetDetailRequest.current;
    const owner = scopeKey;
    setResetBusy(true);
    setResetError("");
    let operation = resetSelection.operation;
    try {
      if (!operation) {
        operation = await adminService.createPasswordResetOperation({
          targetId: target.id,
          expectedAccountVersion,
          newPassword,
        });
        if (!ownsReset(request, owner)) return;
        setResetSelection((current) => ({
          ...current,
          operationKey: operation.key,
          expectedAccountVersion,
          operation,
        }));
      }
      if (!ownsReset(request, owner)) return;
      await adminService.setPasswordReset(
        target.id,
        newPassword,
        expectedAccountVersion,
        operation.key,
      );
      if (!ownsReset(request, owner)) return;
      const result = await adminService.getPasswordResetOperation(
        operation.key,
      );
      await installResetResult(result, target.id, request, owner);
    } catch (error) {
      if (!ownsReset(request, owner)) return;
      if (error instanceof ServiceError && error.code === "REAUTH_REQUIRED") {
        startResetReauthentication(
          target.id,
          operation?.key ?? null,
          operation ? expectedAccountVersion : null,
        );
        return;
      }
      if (
        operation &&
        error instanceof ServiceError &&
        (error.code === "OPERATION_ALREADY_RESOLVED" ||
          error.outcome === "rejected")
      ) {
        try {
          const result = await adminService.getPasswordResetOperation(
            operation.key,
          );
          if (!ownsReset(request, owner)) return;
          await installResetResult(result, target.id, request, owner);
          if (result.state === "succeeded") return;
        } catch (resultError) {
          if (!ownsReset(request, owner)) return;
          if (
            resultError instanceof ServiceError &&
            resultError.code === "OPERATION_EXPIRED"
          )
            setResetOperationExpired(true);
        }
      }
      if (!ownsReset(request, owner)) return;
      if (error instanceof ServiceError && error.code === "OPERATION_EXPIRED")
        setResetOperationExpired(true);
      if (
        operation &&
        (!(error instanceof ServiceError) || error.outcome === "unknown")
      )
        setResetSelection((current) => ({
          ...current,
          operationKey: operation.key,
          operation: null,
        }));
      setResetError(
        operation ||
          (error instanceof ServiceError && error.outcome === "rejected")
          ? resetOperationMessage(error)
          : "작업 키 발급 결과를 확인하지 못했어요. 초기화 실행은 제출하지 않았습니다. 다시 확인한 뒤 직접 제출해 주세요.",
      );
    } finally {
      if (ownsReset(request, owner)) setResetBusy(false);
    }
  }

  async function cancelResetOperation() {
    const key = resetSelection?.operation?.key ?? resetSelection?.operationKey;
    if (!key || resetBusy) return;
    const request = ++resetDetailRequest.current;
    const owner = scopeKey;
    const id = resetSelection.id;
    setResetBusy(true);
    setResetError("");
    try {
      const operation = await adminService.cancelPasswordResetOperation(key);
      await installResetResult(operation, id, request, owner);
    } catch (error) {
      if (ownsReset(request, owner)) {
        if (error instanceof ServiceError && error.code === "OPERATION_EXPIRED")
          setResetOperationExpired(true);
        setResetSelection((current) => ({
          ...current,
          operationKey: key,
          operation: null,
        }));
        setResetError(resetOperationMessage(error));
      }
    } finally {
      if (ownsReset(request, owner)) setResetBusy(false);
    }
  }

  async function retryTarget() {
    if (!selection) return;
    const request = ++detailRequest.current;
    const id = selection.id;
    setSelection({ ...selection, loading: true, error: "" });
    try {
      const target = await adminService.getUser(id);
      if (alive.current && request === detailRequest.current) {
        setOperationExpired(false);
        setSelection({ id, target, loading: false, operation: null });
      }
    } catch (error) {
      if (alive.current && request === detailRequest.current)
        setSelection({
          id,
          target: null,
          loading: false,
          operation: null,
          error:
            error instanceof Error ? error.message : "대상을 확인할 수 없어요.",
        });
    }
  }

  async function refreshCurrent(targetId, operation) {
    try {
      const target = await adminService.getUser(targetId);
      if (!alive.current) return;
      setSelection({ id: targetId, target, loading: false, operation });
      await query.refetch();
    } catch {
      if (alive.current) {
        setSelection((current) => ({ ...current, operation }));
        setActionError(
          "승인 요청은 확정됐지만 현재 회원 목록과 통계를 다시 불러오지 못했어요.",
        );
      }
    }
  }

  async function submitApproval() {
    if (!selection?.target || busy) return;
    const target = selection.target;
    const approved = !target.approved;
    setBusy(true);
    setActionError("");
    setOperationExpired(false);
    let activeOperation = null;
    let appliedUser = null;
    let confirmedOperation = null;
    try {
      const operation = await adminService.createApprovalOperation({
        targetId: target.id,
        expectedAccountVersion: target.accountVersion,
        approved,
      });
      if (!alive.current) return;
      activeOperation = operation;
      setSelection({ ...selection, operation });
      const updated = await adminService.setApproval(
        target.id,
        approved,
        target.accountVersion,
        operation.key,
      );
      if (!alive.current) return;
      appliedUser = updated;
      confirmedOperation = {
        ...operation,
        state: "succeeded",
        appliedAccountVersion: updated.accountVersion,
        appliedApproved: updated.approved,
      };
      setSelection({ ...selection, operation: confirmedOperation });
      const result = await adminService.getApprovalOperation(operation.key);
      if (!alive.current) return;
      if (
        result.state === "succeeded" &&
        result.appliedAccountVersion === updated.accountVersion &&
        result.appliedApproved === approved
      ) {
        await refreshCurrent(target.id, result);
      } else {
        setSelection({ ...selection, operation: result });
      }
    } catch (error) {
      if (!alive.current) return;
      if (appliedUser && confirmedOperation) {
        await refreshCurrent(selection.id, confirmedOperation);
        setActionError(
          "승인 요청의 성공 응답을 받았지만 작업 결과 기록을 다시 읽지 못했어요.",
        );
      } else if (error instanceof ServiceError && error.outcome === "unknown") {
        setSelection((current) => ({
          ...current,
          operation: activeOperation ?? current?.operation,
        }));
      } else if (
        activeOperation &&
        error instanceof ServiceError &&
        (error.code === "OPERATION_ALREADY_RESOLVED" ||
          error.outcome === "rejected")
      ) {
        try {
          const result = await adminService.getApprovalOperation(
            activeOperation.key,
          );
          if (alive.current)
            setSelection((current) => ({ ...current, operation: result }));
        } catch (resultError) {
          if (alive.current) {
            markExpired(resultError);
            setActionError(operationMessage(resultError));
          }
        }
      }
      markExpired(error);
      setActionError(operationMessage(error));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function readResult() {
    if (!selection?.operation || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await adminService.getApprovalOperation(
        selection.operation.key,
      );
      if (!alive.current) return;
      if (result.state === "succeeded")
        await refreshCurrent(selection.id, result);
      else setSelection((current) => ({ ...current, operation: result }));
    } catch (error) {
      if (alive.current) {
        markExpired(error);
        setActionError(operationMessage(error));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function resubmit() {
    if (!selection?.target || !selection.operation || busy) return;
    const { target, operation } = selection;
    setBusy(true);
    setActionError("");
    try {
      await adminService.setApproval(
        target.id,
        operation.appliedApproved ?? !target.approved,
        target.accountVersion,
        operation.key,
      );
      const result = await adminService.getApprovalOperation(operation.key);
      if (!alive.current) return;
      if (result.state === "succeeded") await refreshCurrent(target.id, result);
      else setSelection((current) => ({ ...current, operation: result }));
    } catch (error) {
      if (alive.current) {
        markExpired(error);
        if (error instanceof ServiceError && error.outcome === "unknown") {
          setActionError(operationMessage(error));
        } else if (
          error instanceof ServiceError &&
          error.code === "OPERATION_ALREADY_RESOLVED"
        ) {
          try {
            const result = await adminService.getApprovalOperation(
              operation.key,
            );
            if (alive.current)
              setSelection((current) => ({ ...current, operation: result }));
          } catch (resultError) {
            markExpired(resultError);
            setActionError(operationMessage(resultError));
          }
        } else setActionError(operationMessage(error));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function cancelOperation() {
    if (!selection?.operation || busy) return;
    setBusy(true);
    setActionError("");
    try {
      const result = await adminService.cancelApprovalOperation(
        selection.operation.key,
      );
      if (!alive.current) return;
      if (result.state === "succeeded")
        await refreshCurrent(selection.id, result);
      else setSelection((current) => ({ ...current, operation: result }));
    } catch (error) {
      if (alive.current) {
        markExpired(error);
        setActionError(operationMessage(error));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const resetPanel =
    active && resetSelection ? (
      <PasswordResetPanel
        // Secret inputs belong to this attempt, including lookup/cancel/refresh boundaries.
        key={`${scopeKey}:${resetSelection.id}:${resetDetailRequest.current}`}
        target={resetSelection.target}
        loading={resetSelection.loading}
        busy={resetBusy}
        error={resetError || resetSelection.error}
        operation={resetSelection.operation}
        operationKey={resetSelection.operationKey}
        expectedAccountVersion={resetSelection.expectedAccountVersion}
        operationExpired={resetOperationExpired}
        onSubmit={(password) => submitPasswordReset(password)}
        onReadResult={() => void readResetResult()}
        onCancelOperation={() => void cancelResetOperation()}
        onRetryTarget={() => void retryResetTarget()}
        onFreshTarget={() => void retryResetTarget(true)}
        onClose={() => {
          ++resetDetailRequest.current;
          setResetSelection(null);
          setResetError("");
        }}
      />
    ) : null;

  const approvalPanel = selection ? (
    <ApprovalPanel
      target={selection.target}
      loading={selection.loading}
      busy={busy}
      error={actionError || selection.error}
      operation={selection.operation}
      onConfirm={() => void submitApproval()}
      onClose={() => setSelection(null)}
      onRetryDetail={() => void retryTarget()}
      onReadResult={() => void readResult()}
      onResubmit={() => void resubmit()}
      onCancelOperation={() => void cancelOperation()}
      operationExpired={operationExpired}
    />
  ) : null;

  if (route.invalid)
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="alert" aria-live="assertive">
          <p className="font-bold text-neutral-900">
            관리자 탭 주소를 확인해 주세요.
          </p>
          <Btn
            className="mt-4"
            onClick={() => navigate("/admin", { replace: true })}
          >
            조건 초기화
          </Btn>
        </div>
      </main>
    );

  return (
    <main className="mx-auto w-full max-w-[1016px] px-5 pb-24 pt-12 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
            관리자 대시보드
          </h1>
          <p className="mt-2 text-[14px] text-neutral-500">
            사용자 승인과 플랫폼 상태를 관리해요.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="관리자 메뉴"
          className="inline-flex rounded-full bg-neutral-200/70 p-1 text-[12px] font-semibold text-neutral-500"
        >
          <button
            type="button"
            role="tab"
            id="admin-users-tab"
            data-admin-tab="users"
            aria-selected={tab === "users"}
            aria-current={tab === "users" ? "page" : undefined}
            aria-controls="admin-users-panel"
            tabIndex={tab === "users" ? 0 : -1}
            className={`rounded-full px-4 py-2 ${tab === "users" ? "bg-white text-neutral-900 shadow-sm" : "hover:text-neutral-700"}`}
            onClick={() => changeTab("users")}
            onKeyDown={handleTabKeyDown}
          >
            사용자 관리
          </button>
          <button
            type="button"
            role="tab"
            id="admin-health-tab"
            data-admin-tab="health"
            aria-selected={tab === "health"}
            aria-current={tab === "health" ? "page" : undefined}
            aria-controls="admin-health-panel"
            disabled={!canReadApps}
            tabIndex={tab === "health" ? 0 : -1}
            className={`rounded-full px-4 py-2 ${tab === "health" ? "bg-white text-neutral-900 shadow-sm" : "hover:text-neutral-700"}`}
            onClick={() => changeTab("health")}
            onKeyDown={handleTabKeyDown}
          >
            Health Monitor
          </button>
        </div>
      </div>

      {stats ? (
        <section className="mt-7" aria-label="전체 통계">
          <AdminStats stats={stats} />
        </section>
      ) : query.isPending ? (
        <p role="status" className="mt-7 text-[13px] text-neutral-500">
          통계를 불러오고 있어요.
        </p>
      ) : null}

      <section
        id="admin-users-panel"
        role="tabpanel"
        aria-labelledby="admin-users-tab"
        tabIndex={0}
        hidden={tab !== "users"}
        className="mt-8 overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white shadow-sm"
      >
        <div className="flex items-center justify-between border-b border-neutral-200/70 px-6 py-4">
          <h2
            id="admin-users-title"
            className="text-[14px] font-bold text-neutral-900"
          >
            사용자 승인·계정 관리
          </h2>
          {stats ? (
            <span className="rounded-full border border-[#B77A36]/25 bg-[#B77A36]/[0.07] px-3 py-1 text-[11px] font-semibold text-[#8B5E29]">
              대기 {pending}명
            </span>
          ) : null}
        </div>

        {selection &&
        !query.isPending &&
        !users.some((user) => user.id === selection.id)
          ? approvalPanel
          : null}

        {deleteSelection &&
        !query.isPending &&
        !users.some((user) => user.id === deleteSelection.id) ? (
          <UserDeletePanel
            outcome={deleteSelection.outcome}
            target={deleteSelection.target}
            loading={deleteSelection.loading}
            busy={deleteBusy}
            error={deleteError || deleteSelection.error}
            operation={deleteSelection.operation}
            operationKey={deleteSelection.operationKey}
            expectedAppCount={deleteSelection.expectedAppCount}
            operationExpired={deleteOperationExpired}
            refreshRequired={deleteSelection.refreshRequired}
            onConfirm={() => void submitUserDelete()}
            onReadResult={() => void readDeleteResult()}
            onRetrySame={() => void retryUserDelete()}
            onRetryTarget={() => void refreshDeleteTarget()}
            onClose={() => {
              ++deleteDetailRequest.current;
              onRememberDelete?.(null);
              setDeleteSelection(null);
              setDeleteError("");
            }}
          />
        ) : null}

        {query.isPending ? (
          <p role="status" className="px-6 py-8 text-[13px] text-neutral-500">
            사용자 목록을 불러오고 있어요.
          </p>
        ) : query.isError && users.length === 0 ? (
          <div className="px-6 py-8" role="alert">
            <p className="text-[13px] text-rose-700">
              사용자 목록과 통계를 불러오지 못했어요.
            </p>
            <Btn
              className="mt-3"
              size="sm"
              variant="line"
              onClick={() => void query.refetch()}
            >
              다시 시도
            </Btn>
          </div>
        ) : users.length === 0 ? (
          <p className="px-6 py-8 text-[13px] text-neutral-500">
            표시할 회원이 없어요.
          </p>
        ) : (
          <>
            <div role="list" aria-label="회원 목록">
              {users.map((user) => (
                <div
                  key={user.id}
                  role="listitem"
                  className={`border-b border-neutral-200/70 last:border-0 ${!user.approved ? "bg-[#B77A36]/[0.025]" : ""}`}
                >
                  <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="flex min-w-0 items-start gap-3">
                      <Avatar name={user.nickname} size={36} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-[14px] font-bold text-neutral-900">
                            {user.nickname}
                          </span>
                          {user.role === "admin" ? (
                            <span className="rounded-full border border-[#4C7A96]/20 bg-[#4C7A96]/[0.08] px-2 py-0.5 text-[10px] font-semibold text-[#355E76]">
                              관리자
                            </span>
                          ) : user.approved ? (
                            <span className="rounded-full border border-emerald-700/15 bg-emerald-700/[0.06] px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                              활동 중
                            </span>
                          ) : (
                            <span className="rounded-full border border-[#B77A36]/25 bg-[#B77A36]/[0.07] px-2 py-0.5 text-[10px] font-semibold text-[#8B5E29]">
                              승인 대기
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-[12px] text-neutral-500">
                          로그인 아이디: {user.loginId}
                        </p>
                        <p className="mt-0.5 text-[12px] text-neutral-400">
                          가입 신청 {dateOnly(user.createdAt)}
                        </p>
                        <p className="mt-0.5 text-[12px] text-neutral-400">
                          등록 앱 {user.appCount}개
                        </p>
                      </div>
                    </div>
                    {user.role === "admin" ? (
                      <span className="self-start rounded-full bg-neutral-100 px-3 py-2 text-[11px] font-semibold text-neutral-400 sm:self-center">
                        보호된 계정
                      </span>
                    ) : (
                      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-[48px] sm:pl-0">
                        <span className="mr-1 hidden text-[11px] text-neutral-400 lg:inline">
                          버전 {user.accountVersion}
                        </span>
                        <Btn
                          size="sm"
                          variant="line"
                          onClick={() => beginPasswordReset(user.id)}
                          disabled={
                            !canReset ||
                            busy ||
                            resetBusy ||
                            resetPending ||
                            deleteBusy ||
                            deletePending
                          }
                        >
                          임시 비밀번호 설정
                        </Btn>
                        <Btn
                          size="sm"
                          variant="line"
                          onClick={() => beginUserDelete(user.id)}
                          disabled={
                            !canDelete ||
                            busy ||
                            resetBusy ||
                            resetPending ||
                            deleteBusy ||
                            deletePending
                          }
                        >
                          삭제
                        </Btn>
                        <Btn
                          size="sm"
                          variant={user.approved ? "line" : "primary"}
                          onClick={() => void openApproval(user)}
                          disabled={
                            !canApprove ||
                            busy ||
                            resetBusy ||
                            resetPending ||
                            deleteBusy ||
                            deletePending
                          }
                        >
                          {user.approved ? "승인 해제" : "승인하기"}
                        </Btn>
                      </div>
                    )}
                  </div>
                  {selection?.id === user.id ? approvalPanel : null}
                  {resetSelection?.id === user.id ? resetPanel : null}
                  {deleteSelection?.id === user.id ? (
                    <UserDeletePanel
                      outcome={deleteSelection.outcome}
                      target={deleteSelection.target}
                      loading={deleteSelection.loading}
                      busy={deleteBusy}
                      error={deleteError || deleteSelection.error}
                      operation={deleteSelection.operation}
                      operationKey={deleteSelection.operationKey}
                      expectedAppCount={deleteSelection.expectedAppCount}
                      operationExpired={deleteOperationExpired}
                      refreshRequired={deleteSelection.refreshRequired}
                      onConfirm={() => void submitUserDelete()}
                      onReadResult={() => void readDeleteResult()}
                      onRetrySame={() => void retryUserDelete()}
                      onRetryTarget={() => void refreshDeleteTarget()}
                      onClose={() => {
                        ++deleteDetailRequest.current;
                        onRememberDelete?.(null);
                        setDeleteSelection(null);
                        setDeleteError("");
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
            {resetSelection &&
            !users.some((user) => user.id === resetSelection.id)
              ? resetPanel
              : null}
            {query.isFetchNextPageError ? (
              <div className="px-6 py-4" role="alert">
                <p className="text-[13px] text-rose-700">
                  추가 회원을 불러오지 못했어요. 표시된 목록은 유지됩니다.
                </p>
                <Btn
                  className="mt-2"
                  size="sm"
                  variant="line"
                  onClick={() => void query.fetchNextPage()}
                >
                  추가 회원 다시 불러오기
                </Btn>
              </div>
            ) : query.hasNextPage ? (
              <div className="border-t border-neutral-200/70 px-6 py-4 text-center">
                <Btn
                  size="sm"
                  variant="line"
                  onClick={() => void query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                >
                  {query.isFetchingNextPage
                    ? "불러오는 중…"
                    : `추가 회원 불러오기 (${users.length}/${total})`}
                </Btn>
              </div>
            ) : null}
          </>
        )}
      </section>
      {tab === "health" ? (
        <section
          id="admin-health-panel"
          role="tabpanel"
          aria-labelledby="admin-health-tab"
          tabIndex={0}
          className="mt-8 overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white shadow-sm"
        >
          <HealthBatchControls
            key={scopeKey}
            stats={stats}
            scopeKey={scopeKey}
            readContext={readContext}
            canRequest={canRequestBatch}
          />
          <p id="health-row-check-note" className="sr-only">
            {canCheckHealth
              ? "검사 접수 후 이 행에서 진행 상태를 확인합니다."
              : "현재 개별 연결 검사를 사용할 수 없어요."}
          </p>

          {!canReadApps ? (
            <p role="status" className="px-6 py-8 text-[13px] text-neutral-500">
              앱 목록을 지금은 불러올 수 없어요.
            </p>
          ) : appsDenied ? (
            <p role="alert" className="px-6 py-8 text-[13px] text-rose-700">
              권한을 다시 확인하고 있어요. 확인이 끝나면 앱 목록을 다시 불러와
              주세요.
            </p>
          ) : appsQuery.isPending ? (
            <p role="status" className="px-6 py-8 text-[13px] text-neutral-500">
              앱 목록을 불러오고 있어요.
            </p>
          ) : appsQuery.isError && apps.length === 0 ? (
            <div className="px-6 py-8" role="alert">
              <p className="text-[13px] text-rose-700">
                앱 목록을 불러오지 못했어요.
              </p>
              <Btn
                className="mt-3"
                size="sm"
                variant="line"
                onClick={() => void appsQuery.refetch()}
                disabled={appsQuery.isFetching}
              >
                다시 시도
              </Btn>
            </div>
          ) : apps.length === 0 ? (
            <p className="px-6 py-8 text-[13px] text-neutral-500">
              표시할 앱이 없어요.
            </p>
          ) : (
            <>
              {appsQuery.isRefetchError ? (
                <div className="px-6 py-4" role="alert">
                  <p className="text-[13px] text-rose-700">
                    목록을 새로 고치지 못했어요. 이전에 불러온 목록을 보여 주고
                    있어요.
                  </p>
                  <Btn
                    className="mt-2"
                    size="sm"
                    variant="line"
                    onClick={() => void appsQuery.refetch()}
                    disabled={appsQuery.isFetching}
                  >
                    다시 시도
                  </Btn>
                </div>
              ) : null}
              <div role="list" aria-label="전체 앱 목록">
                {apps.map((app) => {
                  const theme = catalog.themes.find(
                    (item) => item.id === app.themeId,
                  );
                  const stale =
                    app.health.fresh_until !== null &&
                    app.health.fresh_until <= appPages[0]?.serverTime;
                  const unhealthy =
                    app.health.state !== "healthy" &&
                    app.health.state !== "unchecked";
                  return (
                    <div
                      key={app.id}
                      role="listitem"
                      className={`border-b border-neutral-200/70 px-5 py-4 last:border-0 sm:px-6 ${unhealthy ? "bg-red-50/40" : ""}`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        <span
                          aria-hidden="true"
                          className="h-9 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/[0.06]"
                          style={
                            theme
                              ? {
                                  background: `linear-gradient(135deg, ${theme.from}, ${theme.to})`,
                                }
                              : undefined
                          }
                        />
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            aria-label={`앱 관리: ${app.name}`}
                            onClick={() =>
                              navigate(`/apps/${app.id}`, {
                                state: { fromAdmin: true },
                              })
                            }
                            className="block max-w-full truncate text-left text-[14px] font-bold text-neutral-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C7A96]"
                          >
                            {app.name}
                          </button>
                          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11.5px] text-neutral-400">
                            <span className="min-w-0 truncate" title={app.url}>
                              {app.url}
                            </span>
                            <span className="whitespace-nowrap">
                              작성자 {app.owner}
                            </span>
                            <span className="whitespace-nowrap">
                              버전 {app.version}
                            </span>
                            <span className="whitespace-nowrap">
                              {app.isPublic ? "공개" : "비공개"}
                            </span>
                          </div>
                        </div>
                        <div className="flex w-full items-center gap-2 text-[11.5px] text-neutral-500 sm:w-auto">
                          <StatusBadge state={app.health.state} />
                          {stale ? (
                            <span className="font-semibold text-amber-800">
                              오래된 결과
                            </span>
                          ) : null}
                          <span>
                            확인{" "}
                            {formatCheckedAt(
                              app.health.checked_at,
                              appPages[0]?.serverTime,
                            )}
                          </span>
                        </div>
                        <HealthCheckControl
                          key={`${scopeKey}:${app.id}:${app.urlVersion}`}
                          app={app}
                          canRequest={canCheckHealth}
                          readContext={readContext}
                          scopeKey={scopeKey}
                        />
                        <Btn
                          size="sm"
                          variant="line"
                          onClick={() =>
                            navigate(`/apps/${app.id}`, {
                              state: { fromAdmin: true },
                            })
                          }
                        >
                          앱 관리
                        </Btn>
                      </div>
                    </div>
                  );
                })}
              </div>
              {appsQuery.isFetchNextPageError ? (
                <div className="px-6 py-4" role="alert">
                  <p className="text-[13px] text-rose-700">
                    추가 앱을 불러오지 못했어요. 표시된 목록은 유지됩니다.
                  </p>
                  <Btn
                    className="mt-2"
                    size="sm"
                    variant="line"
                    onClick={() => void appsQuery.fetchNextPage()}
                    disabled={appsQuery.isFetchingNextPage}
                  >
                    추가 앱 다시 불러오기
                  </Btn>
                </div>
              ) : appsQuery.hasNextPage ? (
                <div className="border-t border-neutral-200/70 px-6 py-4 text-center">
                  <Btn
                    size="sm"
                    variant="line"
                    onClick={() => void appsQuery.fetchNextPage()}
                    disabled={appsQuery.isFetchingNextPage}
                  >
                    {appsQuery.isFetchingNextPage
                      ? "불러오는 중…"
                      : duplicateOnlyPage
                        ? "계속 불러오기"
                        : `추가 앱 불러오기 (${apps.length}/${appTotal})`}
                  </Btn>
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </main>
  );
}
