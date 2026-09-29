import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  Copy,
  RefreshCw,
} from "lucide-react";
import { Link } from "react-router-dom";
import { formatCheckedAt, formatDate } from "../../components/presentation";
import {
  Avatar,
  Btn,
  Chip,
  DeviceScreen,
  EmptyState,
} from "../../components/ui";
import { ServiceError } from "../../services/service-error";

const healthLabels = {
  unchecked: "미검사",
  healthy: "정상",
  http_error: "HTTP 오류",
  timeout: "응답 시간 초과",
  network_error: "네트워크 오류",
  blocked: "검사 제한",
  redirect_error: "리다이렉트 오류",
};

function HealthResultBadge({ state, stale }) {
  const label = stale
    ? state === "healthy"
      ? "이전 정상"
      : state === "blocked"
        ? "이전 검사 제한"
        : "이전 오류"
    : (healthLabels[state] ?? "미검사");
  const tone =
    state === "healthy"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : state === "unchecked"
        ? "border-neutral-200 bg-neutral-100 text-neutral-600"
        : state === "blocked"
          ? "border-amber-200 bg-amber-50 text-amber-800"
          : "border-red-200 bg-red-50 text-red-700";
  return (
    <span
      aria-label={`연결 결과: ${label}`}
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold ${tone}`}
    >
      {label}
    </span>
  );
}

function CopyButton({ text }) {
  const [result, setResult] = useState(null);
  const attempt = useRef(0);
  const state = result?.text === text ? result.copied : null;
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  const copy = async () => {
    const currentAttempt = ++attempt.current;
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      if (currentAttempt !== attempt.current) return;
      copied = copyWithFallback(text);
    }
    if (currentAttempt === attempt.current) {
      setResult({ text, copied });
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-neutral-300 transition-colors hover:bg-white/20"
      >
        {state === true ? (
          <Check size={13} className="text-[#3C7A72]" aria-hidden="true" />
        ) : (
          <Copy size={13} aria-hidden="true" />
        )}
        <span>{state === true ? "복사됨" : "복사하기"}</span>
      </button>
      {state === true ? (
        <span className="sr-only" role="status" aria-live="polite">
          복사됨
        </span>
      ) : null}
      {state === false ? (
        <span role="alert" className="text-[12px] text-red-300">
          복사하지 못했어요. 프롬프트를 선택해 직접 복사해 주세요.
        </span>
      ) : null}
    </div>
  );
}

function copyWithFallback(text) {
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  let inputSelection = null;
  if (
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLInputElement
  ) {
    try {
      if (activeElement.selectionStart !== null)
        inputSelection = [
          activeElement.selectionStart,
          activeElement.selectionEnd,
          activeElement.selectionDirection,
        ];
    } catch {
      // Some input types do not expose a text selection.
    }
  }
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("aria-hidden", "true");
  textarea.tabIndex = -1;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";
  document.body.append(textarea);

  let copied = false;
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    copied = document.execCommand("copy") === true;
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (activeElement?.isConnected) {
      activeElement.focus({ preventScroll: true });
      if (inputSelection) activeElement.setSelectionRange(...inputSelection);
    }
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) {
        if (range.startContainer.isConnected && range.endContainer.isConnected)
          selection.addRange(range);
      }
    }
  }
  return copied;
}

function SpecCell({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-neutral-200/70 py-3 last:border-0">
      <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">
        {label}
      </div>
      <div className="break-keep text-right text-[13px] font-semibold leading-snug text-neutral-700">
        {value || "—"}
      </div>
    </div>
  );
}

function objectParticle(value) {
  const last = String(value || "")
    .trim()
    .slice(-1)
    .charCodeAt(0);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0
    ? "을"
    : "를";
}

function StateView({
  loading,
  error,
  retry,
  authStatus,
  authError,
  concealed,
}) {
  if (concealed) {
    return (
      <div role="status" aria-live="polite">
        <EmptyState
          title="화면이 잠시 가려졌습니다"
          desc="로그인 상태를 확인한 뒤 보호된 정보를 다시 보여 드릴게요."
        />
      </div>
    );
  }
  if (authStatus === "checking") {
    return (
      <div role="status" aria-live="polite">
        <EmptyState title="로그인 상태를 확인하고 있습니다" />
      </div>
    );
  }
  if (authStatus === "error") {
    return (
      <div role="alert" aria-live="assertive">
        <EmptyState
          title="로그인 상태를 확인할 수 없습니다"
          desc={authError?.message || "연결을 확인하고 다시 시도해 주세요."}
        >
          <Btn onClick={retry}>다시 확인</Btn>
          {__DATA_MODE__ === "mock" &&
          authError instanceof ServiceError &&
          authError.code === "MOCK_STORAGE_ERROR" ? (
            <Link
              to="/__dev/mock-reset"
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              mock 저장 초기화
            </Link>
          ) : null}
        </EmptyState>
      </div>
    );
  }
  if (loading) {
    return (
      <div role="status" aria-live="polite">
        <EmptyState
          title="아카이브 앱을 불러오는 중이에요"
          desc="잠시만 기다려 주세요."
        />
      </div>
    );
  }
  if (!error) return null;
  const notFound = error instanceof ServiceError && error.code === "NOT_FOUND";
  const invalidCondition =
    error instanceof ServiceError && error.code === "VALIDATION_ERROR";
  const authRequired =
    error instanceof ServiceError && error.code === "AUTH_REQUIRED";
  const forbidden =
    error instanceof ServiceError &&
    [
      "FORBIDDEN",
      "PASSWORD_CHANGE_REQUIRED",
      "SESSION_KIND_NOT_ALLOWED",
    ].includes(error.code);
  const storage =
    error instanceof ServiceError && error.code === "MOCK_STORAGE_ERROR";
  return (
    <div role="alert" aria-live="assertive">
      <EmptyState
        title={
          invalidCondition
            ? "검색 조건을 확인할 수 없어요"
            : notFound
              ? "아카이브 앱을 찾을 수 없어요"
              : forbidden
                ? "이 화면을 볼 권한이 없어요"
                : authRequired
                  ? "로그인이 필요해요"
                  : "상세 정보를 불러오지 못했어요"
        }
        desc={error.message || "잠시 후 다시 시도해 주세요."}
      >
        <div className="flex flex-wrap justify-center gap-2">
          {invalidCondition ? (
            <Btn onClick={retry}>조건 초기화</Btn>
          ) : notFound ? (
            <Link
              to="/"
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              갤러리로
            </Link>
          ) : authRequired ? (
            <Link
              to={`/auth?mode=login&return_to=${encodeURIComponent(window.location.pathname)}`}
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              로그인
            </Link>
          ) : forbidden ? null : (
            <Btn onClick={retry}>다시 시도</Btn>
          )}
          {__DATA_MODE__ === "mock" && storage ? (
            <Link
              to="/__dev/mock-reset"
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              mock 저장 초기화
            </Link>
          ) : null}
        </div>
      </EmptyState>
    </div>
  );
}

export function AppDetailView({
  app,
  health,
  healthServerTime,
  healthStale = false,
  isAdmin = false,
  canCheckHealth = false,
  checkingHealth = false,
  checkHealthError,
  checkFeedback = "",
  checkCompleted = false,
  onCheckHealth,
  healthReadError,
  onRetryHealthRead,
  jobReadError,
  onRetryJobRead,
  meta,
  loading,
  error,
  retry,
  onBack,
  authStatus = "ready",
  authError,
  concealed = false,
  canEdit = false,
  canDelete = false,
  deleteState = null,
  onDelete,
  onCheckDeleteResult,
  onRetryDelete,
  onCancelDelete,
  fromGallery = false,
  fromAdmin = false,
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mainRef = useRef(null);
  const deleteTriggerRef = useRef(null);
  const deleteCancelRef = useRef(null);
  const deleteCheckRef = useRef(null);
  const deleteStatusRef = useRef(null);
  const priorDeleteFocus = useRef({ open: false, phase: "idle" });
  const deletePhase = deleteState?.phase ?? "idle";
  useEffect(() => {
    const prior = priorDeleteFocus.current;
    if (!prior.open && confirmDelete)
      (
        deleteCheckRef.current ??
        deleteStatusRef.current ??
        deleteCancelRef.current
      )?.focus();
    else if (prior.open && !confirmDelete) deleteTriggerRef.current?.focus();
    else if (confirmDelete && prior.phase !== deletePhase)
      (deletePhase === "pending" || deletePhase === "expired"
        ? deleteStatusRef.current
        : (deleteCheckRef.current ?? deleteCancelRef.current)
      )?.focus();
    priorDeleteFocus.current = { open: confirmDelete, phase: deletePhase };
  }, [confirmDelete, deletePhase]);
  useEffect(() => {
    if (deleteState?.phase && deleteState.phase !== "idle")
      setConfirmDelete(true);
  }, [app?.id, deleteState?.id, deleteState?.phase]);
  useEffect(() => {
    if (
      loading ||
      concealed ||
      authStatus === "checking" ||
      authStatus === "error"
    )
      mainRef.current?.focus({ preventScroll: true });
  }, [authStatus, concealed, loading]);
  const protectedScreen = app?.isPublic !== true;
  if (
    (protectedScreen && (concealed || authStatus !== "ready")) ||
    loading ||
    error
  ) {
    return (
      <main
        ref={mainRef}
        tabIndex={-1}
        className="mx-auto w-full max-w-[1280px] px-5 pb-24 pt-12 focus:outline-none sm:px-8"
      >
        <StateView
          loading={loading}
          error={error}
          retry={retry}
          authStatus={protectedScreen ? authStatus : "ready"}
          authError={protectedScreen ? authError : null}
          concealed={protectedScreen && concealed}
        />
      </main>
    );
  }
  if (!app || !meta) return null;
  const theme = meta.themes.find((item) => item.id === app.themeId);
  if (!theme) return null;
  const currentHealth = health ?? app.health;
  const result = currentHealth.result;
  const checkedAt = formatCheckedAt(
    result.checked_at,
    healthServerTime ?? app.serverTime,
  );
  const job = currentHealth.latestJob;
  const activeJob = job && ["queued", "running"].includes(job.status);
  const creationDate = formatDate(app.createdAt);

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      className="mx-auto w-full max-w-[1080px] px-5 pb-24 pt-8 focus:outline-none sm:px-8"
      data-screen-label={app.isPublic ? "공개 앱 상세" : "비공개 앱 상세"}
    >
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800"
        >
          <ChevronLeft size={15} aria-hidden="true" />
          {fromAdmin ? "앱 목록으로" : "갤러리로"}
        </button>
        {canEdit || canDelete ? (
          <div className="flex items-center gap-2">
            {canEdit ? (
              <Link
                to={`/apps/${app.id}/edit`}
                state={{ fromDetail: true, fromGallery, fromAdmin }}
                className="inline-flex h-9 items-center rounded-full border border-neutral-200 px-4 text-[12.5px] font-semibold text-neutral-700 hover:bg-neutral-100"
              >
                앱 수정
              </Link>
            ) : null}
            {canDelete ? (
              <button
                ref={deleteTriggerRef}
                type="button"
                aria-expanded={confirmDelete}
                onClick={() => setConfirmDelete(true)}
                className="inline-flex h-8 items-center rounded-full border border-neutral-300 bg-white px-3.5 text-[12.5px] font-semibold text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700"
              >
                삭제
              </button>
            ) : null}
          </div>
        ) : (
          <span aria-hidden="true" />
        )}
      </div>

      {canDelete && confirmDelete ? (
        <section
          className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-4"
          role="group"
          aria-labelledby="app-delete-confirmation-title"
        >
          <div className="min-w-[220px] flex-1">
            <div
              id="app-delete-confirmation-title"
              className="break-keep text-[13.5px] font-bold text-red-700"
            >
              ‘{app.name}’{objectParticle(app.name)} 아카이브에서 삭제할까요?
            </div>
            <p className="mt-0.5 break-keep text-[12px] leading-relaxed text-red-600/90">
              프롬프트와 활용 매뉴얼이 함께 삭제되며 되돌릴 수 없습니다.
            </p>
          </div>
          {deletePhase === "pending" ? (
            <span
              ref={deleteStatusRef}
              role="status"
              tabIndex={-1}
              className="text-[12px] font-semibold text-red-700"
            >
              삭제 요청 처리 중…
            </span>
          ) : null}
          {deletePhase === "unknown" ||
          deletePhase === "expired" ||
          deletePhase === "rejected" ? (
            <p
              ref={deletePhase === "expired" ? deleteStatusRef : undefined}
              role="alert"
              tabIndex={deletePhase === "expired" ? -1 : undefined}
              className="basis-full text-[12px] leading-relaxed text-red-700"
            >
              {deleteState.message}
            </p>
          ) : null}
          {deletePhase === "idle" ? (
            <>
              <Btn size="sm" variant="danger" onClick={onDelete}>
                삭제 확인
              </Btn>
              <button
                ref={deleteCancelRef}
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12.5px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
                onClick={() => {
                  onCancelDelete?.();
                  setConfirmDelete(false);
                }}
              >
                취소
              </button>
            </>
          ) : null}
          {deletePhase === "pending" ? (
            <>
              <Btn size="sm" variant="danger" disabled>
                삭제 중…
              </Btn>
              <Btn size="sm" variant="ghost" disabled>
                취소
              </Btn>
            </>
          ) : null}
          {deletePhase === "unknown" ? (
            <>
              <button
                ref={deleteCheckRef}
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-full border border-neutral-300 bg-white px-3 text-[12.5px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
                onClick={onCheckDeleteResult}
              >
                삭제 결과 확인
              </button>
              <Btn size="sm" variant="danger" onClick={onRetryDelete}>
                같은 삭제 요청 다시 보내기
              </Btn>
            </>
          ) : null}
          {deletePhase === "rejected" ? (
            <>
              {deleteState.operation ? (
                <button
                  ref={deleteCheckRef}
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-full border border-neutral-300 bg-white px-3 text-[12.5px] font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
                  onClick={onCheckDeleteResult}
                >
                  삭제 결과 확인
                </button>
              ) : (
                <Btn size="sm" variant="danger" onClick={onDelete}>
                  다시 시도
                </Btn>
              )}
              <button
                ref={deleteCancelRef}
                type="button"
                className="inline-flex h-8 items-center justify-center rounded-full px-3 text-[12.5px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-100"
                onClick={() => {
                  onCancelDelete?.();
                  setConfirmDelete(false);
                }}
              >
                취소
              </button>
            </>
          ) : null}
        </section>
      ) : null}

      <DeviceScreen
        app={app}
        theme={theme}
        big
        className="card-r aspect-[16/7] w-full ring-1 ring-black/[0.06] sm:aspect-[16/5.5]"
      />

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold tracking-tight text-neutral-900">
            {app.name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-600">
              <Avatar name={app.owner} size={20} />
              {app.owner}
            </span>
            <span className="text-neutral-300" aria-hidden="true">
              ·
            </span>
            <Chip tone="blue">{app.subject}</Chip>
            {app.grades.map((grade) => (
              <Chip key={grade}>{grade}</Chip>
            ))}
          </div>
        </div>
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="acc-bg inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-semibold text-white shadow-sm transition-all hover:brightness-110 hover:shadow-md active:scale-[0.97]"
        >
          <span>앱 열기</span>
          <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-6">
            <h2 className="mb-3 text-[15px] font-bold text-neutral-900">
              상세 설명 · 활용 매뉴얼
            </h2>
            <p className="break-keep whitespace-pre-line text-[14px] leading-[1.8] text-neutral-600">
              {app.description}
            </p>
          </section>
          <section className="overflow-hidden rounded-3xl bg-[#2B2724] shadow-[0_12px_36px_-14px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
              <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                핵심 프롬프트
              </div>
              <CopyButton key={app.id} text={app.prompt} />
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-keep px-5 py-5 font-mono text-[13px] leading-[1.85] text-neutral-300">
              {app.prompt}
            </pre>
          </section>
        </div>

        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="mb-3 px-1 text-[12px] font-bold uppercase tracking-wider text-neutral-400">
              기술 스택
            </h2>
            <div className="rounded-3xl border border-neutral-200/80 bg-white px-5 py-2">
              <SpecCell label="Database" value={app.stack.db} />
              <SpecCell label="Backend" value={app.stack.backend} />
              <SpecCell label="Frontend" value={app.stack.frontend} />
              <SpecCell label="Hosting" value={app.stack.hosting} />
            </div>
          </section>
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-neutral-900">
                연결 상태
              </h2>
              <HealthResultBadge state={result.state} stale={healthStale} />
            </div>
            <dl className="grid gap-2 text-[13px]">
              <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                <dt className="text-neutral-500">결과 구분</dt>
                <dd className="font-semibold text-neutral-800">
                  {healthLabels[result.state] ?? "미검사"}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                <dt className="text-neutral-500">마지막 판정 시각 (KST)</dt>
                <dd className="font-semibold text-neutral-800">{checkedAt}</dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                <dt className="text-neutral-500">결과 신선도</dt>
                <dd className="font-semibold text-neutral-800">
                  {result.state === "unchecked"
                    ? "검사 기록 없음"
                    : healthStale
                      ? "오래된 결과"
                      : "15분 이내"}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                <dt className="text-neutral-500">다음 검사 가능 시각</dt>
                <dd className="font-semibold text-neutral-800">
                  {currentHealth.nextCheckAt
                    ? formatCheckedAt(
                        currentHealth.nextCheckAt,
                        healthServerTime ?? app.serverTime,
                      )
                    : "—"}
                </dd>
              </div>
            </dl>
            {isAdmin ? (
              <dl className="mt-2 grid gap-2 text-[12px]">
                <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                  <dt className="text-neutral-500">HTTP 상태 코드</dt>
                  <dd className="font-mono font-semibold text-neutral-800">
                    {result.http_status ?? "—"}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                  <dt className="text-neutral-500">응답 시간</dt>
                  <dd className="font-mono font-semibold text-neutral-800">
                    {result.response_ms === null ||
                    result.response_ms === undefined
                      ? "—"
                      : `${result.response_ms} ms`}
                  </dd>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                  <dt className="text-neutral-500">오류 종류 / 단계</dt>
                  <dd className="font-mono text-right font-semibold text-neutral-800">
                    {result.error_kind || "—"} / {result.error_stage || "—"}
                  </dd>
                </div>
              </dl>
            ) : null}
            {__DATA_MODE__ === "mock" ? (
              <p className="mt-3 break-keep text-[11.5px] leading-relaxed text-neutral-500">
                합성 시연 결과입니다. 외부 사이트로 요청을 보내지 않았습니다.
              </p>
            ) : null}
            {healthReadError ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">
                <p role="alert">
                  최신 연결 결과를 읽지 못했어요. {healthReadError.message}
                </p>
                <button
                  type="button"
                  onClick={onRetryHealthRead}
                  className="mt-2 rounded-lg px-2 py-1 font-semibold underline underline-offset-2"
                >
                  결과 다시 조회
                </button>
              </div>
            ) : null}
            {job?.status === "queued" || job?.status === "running" ? (
              <p
                className="mt-3 rounded-xl bg-blue-50 px-3.5 py-2.5 text-[12px] font-semibold text-blue-800"
                role="status"
              >
                {job.status === "queued"
                  ? "검사 작업 대기 중"
                  : "연결 검사 진행 중"}
              </p>
            ) : job?.status === "failed" || job?.status === "cancelled" ? (
              <p
                className="mt-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900"
                role="alert"
              >
                {job.status === "failed"
                  ? "검사 작업에 실패했어요. 마지막 유효 연결 결과는 유지됩니다."
                  : "검사 작업이 취소됐어요. 마지막 유효 연결 결과는 유지됩니다."}
              </p>
            ) : job?.status === "completed" && checkCompleted ? (
              <p className="mt-3 text-[12px] text-neutral-600" role="status">
                검사 작업이 완료됐어요. 연결 상태는 위 결과 구분을 확인해
                주세요.
              </p>
            ) : null}
            {jobReadError ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-800">
                <p role="alert">
                  진행 상태를 확인하지 못했어요. 자동 조회를 멈췄습니다.
                </p>
                <button
                  type="button"
                  onClick={onRetryJobRead}
                  className="mt-2 rounded-lg px-2 py-1 font-semibold underline underline-offset-2"
                >
                  진행 다시 조회
                </button>
              </div>
            ) : null}
            {checkFeedback ? (
              <p className="mt-3 text-[12px] text-neutral-600" role="status">
                {checkFeedback}
              </p>
            ) : null}
            {checkHealthError ? (
              <p
                className="mt-3 text-[12px] leading-relaxed text-red-700"
                role="alert"
              >
                {checkHealthError.message}
                {checkHealthError.retryAt
                  ? ` 다시 요청할 수 있는 시각: ${formatCheckedAt(checkHealthError.retryAt, checkHealthError.serverTime ?? healthServerTime ?? app.serverTime)}.`
                  : ""}
              </p>
            ) : null}
            {canCheckHealth ? (
              <Btn
                variant="soft"
                className="mt-4 w-full"
                disabled={checkingHealth || Boolean(activeJob)}
                onClick={onCheckHealth}
              >
                <RefreshCw size={14} aria-hidden="true" />
                <span>
                  {checkingHealth
                    ? "검사 요청 중…"
                    : activeJob
                      ? "검사 진행 중"
                      : "연결 다시 확인"}
                </span>
              </Btn>
            ) : null}
          </section>
          <div className="px-1 text-[12px] leading-relaxed text-neutral-400">
            <div className="flex items-center justify-between border-b border-neutral-200/70 py-2">
              <span>공개 범위</span>
              <span className="font-semibold text-neutral-600">
                {app.isPublic ? "전체 공개" : "비공개"}
              </span>
            </div>
            {!app.isPublic ? (
              <p className="border-b border-neutral-200/70 py-2 text-[11px] leading-relaxed">
                이 설정은 EduVibe 내 열람 범위이며 외부 사이트를 보호하지
                않아요.
              </p>
            ) : null}
            <div className="flex items-center justify-between border-b border-neutral-200/70 py-2">
              <span>등록일</span>
              <span className="font-semibold text-neutral-600">
                {creationDate}
              </span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span>썸네일 테마</span>
              <span className="font-semibold text-neutral-600">
                Pantone {theme.pantone} {theme.name}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
