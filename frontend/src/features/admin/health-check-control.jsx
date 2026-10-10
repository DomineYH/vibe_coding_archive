import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { healthService } from "@services/health";
import { Btn } from "../../components/ui";

export function HealthCheckControl({
  app,
  canRequest,
  readContext,
  scopeKey,
  descriptionId = "health-row-check-note",
}) {
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const sending = useRef(false);
  const jobId = accepted?.health.latestJob?.id;
  const query = useQuery({
    queryKey: [
      __DATA_MODE__,
      "admin",
      "health-job",
      scopeKey,
      app.id,
      app.urlVersion,
      jobId,
    ],
    enabled: Boolean(jobId),
    queryFn: ({ signal }) =>
      healthService.getJob(jobId, { signal, readContext }),
    retry: false,
    refetchInterval: (state) =>
      document.visibilityState === "visible" &&
      state.state.status !== "error" &&
      ["queued", "running"].includes(state.state.data?.job.status ?? "queued")
        ? 2000
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: (state) => state.state.status !== "error",
  });
  const job = query.data?.job ?? accepted?.health.latestJob;
  const finished = job && !["queued", "running"].includes(job.status);
  useEffect(() => {
    if (!finished && accepted?.disposition !== "result_reused") return;
    void queryClient.invalidateQueries({
      queryKey: [__DATA_MODE__, "admin", "apps", scopeKey],
    });
    void queryClient.invalidateQueries({
      queryKey: [__DATA_MODE__, "admin", "users", scopeKey],
    });
  }, [finished, accepted?.disposition, scopeKey, queryClient]);
  async function requestCheck() {
    if (!canRequest || sending.current) return;
    sending.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await healthService.requestCheck(app.id);
      if (readContext && !readContext.isCurrent()) return;
      setAccepted(result);
    } catch (failure) {
      if (!readContext || readContext.isCurrent())
        setError(failure.message ?? "검사를 접수하지 못했어요.");
    } finally {
      sending.current = false;
      setPending(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Btn
        size="sm"
        variant="line"
        disabled={!canRequest || pending || Boolean(job && !finished)}
        onClick={() => void requestCheck()}
        aria-describedby={descriptionId}
      >
        {pending ? "접수 중…" : "즉시 재검사"}
      </Btn>
      {job ? (
        <span role="status" className="text-[11.5px] text-neutral-500">
          {job.status === "queued"
            ? "검사 대기 중"
            : job.status === "running"
              ? "검사 중"
              : job.status === "completed"
                ? "검사 완료"
                : job.status === "cancelled"
                  ? "검사 취소됨"
                  : "검사 작업 실패"}
        </span>
      ) : null}
      {query.isError ? (
        <Btn
          size="sm"
          variant="line"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          진행 다시 조회
        </Btn>
      ) : null}
      {error ? (
        <span role="alert" className="text-[11.5px] text-rose-700">
          {error}
        </span>
      ) : null}
    </div>
  );
}
