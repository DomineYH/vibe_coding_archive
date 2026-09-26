import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Avatar, Btn } from "../../components/ui";
import { adminService } from "@services/admin";
import { ServiceError } from "../../services/service-error";

const PAGE_SIZE = 24;

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
        승인 값: <strong>{nextApproved ? "승인" : "미승인"}</strong>
        <span className="mx-2" aria-hidden="true">
          ·
        </span>
        대상 버전: <strong>{target.accountVersion}</strong>
      </p>
      <p className="mt-1 text-[12px] leading-5 text-neutral-500">
        {nextApproved
          ? "승인 후 회원은 로그인할 수 있습니다. 자동 로그인은 되지 않습니다."
          : "승인을 해제하면 이 회원의 현재 접근이 차단됩니다."}
      </p>
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

export function AdminView({ scopeKey }) {
  const [selection, setSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [operationExpired, setOperationExpired] = useState(false);
  const alive = useRef(true);
  const detailRequest = useRef(0);
  const usersKey = [__DATA_MODE__, "admin", "users", scopeKey];
  const query = useInfiniteQuery({
    queryKey: usersKey,
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
  const pages = query.data?.pages ?? [];
  const users = pages.flatMap((page) => page.items);
  const stats = pages[0]?.stats;
  const total = pages[0]?.pagination.total ?? 0;
  const pending = stats?.pendingUsers ?? 0;

  function markExpired(error) {
    if (error instanceof ServiceError && error.code === "OPERATION_EXPIRED")
      setOperationExpired(true);
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function openApproval(user) {
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
        <div className="inline-flex rounded-full bg-neutral-200/70 p-1 text-[12px] font-semibold text-neutral-500">
          <span
            className="rounded-full bg-white px-4 py-2 text-neutral-900 shadow-sm"
            aria-current="page"
          >
            사용자 관리
          </span>
          <span className="px-4 py-2" aria-disabled="true">
            Health Monitor
          </span>
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
        className="mt-8 overflow-hidden rounded-[24px] border border-neutral-200/80 bg-white shadow-sm"
        aria-labelledby="admin-users-title"
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
                      </div>
                    </div>
                    {user.role === "admin" ? (
                      <span className="self-start rounded-full bg-neutral-100 px-3 py-2 text-[11px] font-semibold text-neutral-400 sm:self-center">
                        보호된 계정
                      </span>
                    ) : (
                      <div className="flex shrink-0 items-center gap-2 pl-[48px] sm:pl-0">
                        <span className="mr-1 hidden text-[11px] text-neutral-400 lg:inline">
                          버전 {user.accountVersion}
                        </span>
                        <Btn
                          size="sm"
                          variant={user.approved ? "line" : "primary"}
                          onClick={() => void openApproval(user)}
                          disabled={busy}
                        >
                          {user.approved ? "승인 해제" : "승인하기"}
                        </Btn>
                      </div>
                    )}
                  </div>
                  {selection?.id === user.id ? (
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
                  ) : null}
                </div>
              ))}
            </div>
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
    </main>
  );
}
