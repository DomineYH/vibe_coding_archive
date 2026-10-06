import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import catalog from "../../../contracts/catalog.json";
import { isUuid } from "../contracts/uuid";
import { appsService } from "@services/apps";
import { authService } from "@services/auth";
import { prepareApiAuth, recoverApiAuth } from "../services/api/auth";
import { healthService } from "@services/health";
import { isSearchTooLong } from "../services/apps-service";
import MockResetPage from "@services/mock-reset";
import { reconcileMockReset } from "../services/mock/state";
import { isMockHealthStorageUpdate } from "../services/mock/storage-events";
import { contractError, ServiceError } from "../services/service-error";
import { AppDetailView } from "../features/detail/view-detail";
import { GalleryView } from "../features/gallery/view-gallery";
import { Avatar, Btn, EmptyState } from "../components/ui";
import { AuthView } from "../features/auth/view-auth";
import { readAuthRoute } from "../features/auth/auth-route";
import { recheckReturnDestination } from "../features/auth/return-destination";
import {
  assertAuthObservation,
  captureAuthObservation,
  draftContinuityScope,
  memberCacheScope,
} from "../services/auth-state";
import { AdminView } from "../features/admin/view-admin";
import { SubmitView } from "../features/submit/view-submit";

const galleryQueryKeys = new Set(["q", "subject", "grade"]);

function readGalleryFilters(search) {
  if (!search || search === "?") return { filters: {}, invalid: false };
  const values = {};
  const seen = new Set();
  for (const pair of search.slice(1).split("&")) {
    if (!pair) return { filters: {}, invalid: true };
    const separator = pair.indexOf("=");
    if (separator < 0) return { filters: {}, invalid: true };
    let key;
    let value;
    try {
      key = decodeURIComponent(pair.slice(0, separator).replace(/\+/g, " "));
      value = decodeURIComponent(pair.slice(separator + 1).replace(/\+/g, " "));
    } catch {
      return { filters: {}, invalid: true };
    }
    if (!galleryQueryKeys.has(key) || seen.has(key))
      return { filters: {}, invalid: true };
    seen.add(key);
    if (key === "q") {
      const normalized = value.trim().normalize("NFC");
      if (isSearchTooLong(value)) values.q = value;
      else if (normalized) values.q = normalized;
    } else if (value) {
      values[key] = value;
    }
  }
  if (
    (values.subject && !catalog.subjects.includes(values.subject)) ||
    (values.grade && !catalog.grades.includes(values.grade))
  )
    return { filters: {}, invalid: true };
  return { filters: values, invalid: false };
}

function assertThemeIds(meta, items) {
  const themes = new Set(meta.themes.map((theme) => theme.id));
  const subjects = new Set(meta.subjects);
  const grades = new Set(meta.grades);
  for (const item of items) {
    if (
      !themes.has(item.themeId) ||
      !subjects.has(item.subject) ||
      item.grades.some((grade) => !grades.has(grade))
    ) {
      throw contractError();
    }
  }
  return items;
}

function isApprovedFullAppCreator(auth) {
  return (
    auth.status === "ready" &&
    !auth.concealed &&
    (auth.user?.role === "user" || auth.user?.role === "admin") &&
    auth.user.approved &&
    auth.user.sessionKind === "full" &&
    !auth.user.mustChangePassword
  );
}

function canCreateApp(auth, access) {
  return (
    isApprovedFullAppCreator(auth) &&
    !access.error &&
    access.meta?.capabilities.apps_create.enabled === true
  );
}

function isNotImplemented(capability) {
  return (
    capability?.enabled === false &&
    capability.reasons.includes("not_implemented")
  );
}

function Header({
  active,
  auth,
  access,
  onLogin,
  onLogout,
  onRetryAuth,
  logoutPending,
}) {
  const navButton = (isActive) =>
    `h-9 rounded-full px-4 text-[13px] font-semibold transition-all ${isActive ? "bg-neutral-900/[0.06] text-neutral-900" : "text-neutral-500 hover:bg-neutral-900/[0.04] hover:text-neutral-900"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-[57px] w-full max-w-[1280px] items-center gap-2 px-5 sm:px-8">
        <Link
          to="/"
          className="flex shrink-0 items-center gap-2.5 whitespace-nowrap"
          aria-label="EduVibe 아카이브 홈"
        >
          <span className="acc-bg inline-flex h-8 w-8 items-center justify-center rounded-[10px] text-white shadow-sm">
            <span className="text-[12.5px] font-extrabold tracking-tight">
              EV
            </span>
          </span>
          <span className="text-[15.5px] font-extrabold tracking-tight text-neutral-900">
            EduVibe<span className="acc-text"> 아카이브</span>
          </span>
        </Link>
        <nav
          className="ml-4 hidden items-center gap-1 sm:flex"
          aria-label="주 메뉴"
        >
          <Link
            to="/"
            aria-current={active === "gallery" ? "page" : undefined}
            className={`inline-flex items-center justify-center ${navButton(active === "gallery" || active === "detail")}`}
          >
            갤러리
          </Link>
          {canCreateApp(auth, access) ? (
            <Link
              to="/apps/new"
              aria-current={active === "submit" ? "page" : undefined}
              className={`inline-flex items-center justify-center ${navButton(active === "submit")}`}
            >
              앱 등록
            </Link>
          ) : null}
          {auth.status === "ready" &&
          !auth.concealed &&
          auth.user?.role === "admin" &&
          auth.user.sessionKind === "full" &&
          !auth.user.mustChangePassword ? (
            <Link
              to="/admin"
              aria-current={active === "admin" ? "page" : undefined}
              className={`inline-flex items-center justify-center ${navButton(active === "admin")}`}
            >
              관리자
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-2">
          {auth.status === "unavailable" ? (
            <span className="text-[12px] text-neutral-500" role="status">
              인증 기능 준비 중
            </span>
          ) : auth.concealed || auth.status === "checking" ? (
            <>
              <span className="text-[12px] text-neutral-500" role="status">
                {auth.concealed
                  ? "화면이 잠시 가려졌습니다"
                  : "로그인 상태 확인 중"}
              </span>
              <Btn size="sm" variant="line" onClick={onRetryAuth}>
                다시 확인
              </Btn>
            </>
          ) : auth.status === "error" ? (
            <Btn size="sm" variant="line" onClick={onRetryAuth}>
              다시 확인
            </Btn>
          ) : auth.status === "unresolved" ? (
            <Btn size="sm" variant="line" onClick={onLogin}>
              인증 복구
            </Btn>
          ) : auth.user ? (
            <>
              <span className="inline-flex min-w-0 flex-1 items-center gap-1.5 truncate text-[11.5px] font-semibold text-neutral-700 sm:gap-2 sm:rounded-full sm:bg-neutral-100 sm:py-1 sm:pl-1 sm:pr-3 sm:text-[13px]">
                <Avatar name={auth.user.nickname} size={24} />
                <span className="min-w-0 truncate">{auth.user.nickname}</span>
              </span>
              <Btn
                size="sm"
                variant="line"
                onClick={onLogout}
                disabled={logoutPending}
                className="shrink-0 whitespace-nowrap"
              >
                {logoutPending ? "로그아웃 중…" : "로그아웃"}
              </Btn>
            </>
          ) : (
            <Btn size="sm" variant="primary" onClick={onLogin}>
              로그인
            </Btn>
          )}
        </div>
      </div>
    </header>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-[toastIn_0.25s_ease-out]"
      role="status"
    >
      <div className="flex items-center gap-2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-[13px] font-semibold text-white shadow-xl backdrop-blur">
        {message}
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-neutral-200/70 py-8 text-center text-[12px] text-neutral-400">
      EduVibe 아카이브 — 교사 에이전틱 코딩 공유 플랫폼 · Pantone 11-4201 Cloud
      Dancer, Color of the Year 2026
    </footer>
  );
}

function usePublicMetadata() {
  const query = useQuery({
    queryKey: [__DATA_MODE__, "meta"],
    queryFn: ({ signal }) => appsService.getMeta({ signal }),
    retry: false,
  });
  const canRead = query.data?.capabilities.apps_read.enabled === true;
  const unavailable =
    query.data && !canRead
      ? new ServiceError(
          "FEATURE_UNAVAILABLE",
          "공개 아카이브를 현재 사용할 수 없어요.",
        )
      : null;
  return {
    meta: query.data,
    canRead,
    loading: query.isPending || query.isFetching,
    error: query.error ?? unavailable,
    retry(refetch) {
      void (query.isError || !canRead ? query.refetch() : refetch());
    },
  };
}

function adminReauthResumeState(value) {
  const pendingReset = value?.adminReset;
  if (isUuid(pendingReset?.targetId)) {
    const operationKey = pendingReset.operationKey;
    const expectedAccountVersion = pendingReset.expectedAccountVersion;
    return {
      tab: value.tab === "health" ? "health" : "users",
      adminReset: {
        targetId: pendingReset.targetId,
        ...(isUuid(operationKey) &&
        Number.isSafeInteger(expectedAccountVersion) &&
        expectedAccountVersion >= 1
          ? { operationKey, expectedAccountVersion }
          : {}),
      },
    };
  }

  const pendingDelete = value?.adminDelete;
  if (!isUuid(pendingDelete?.targetId)) return null;
  const operationKey = pendingDelete.operationKey;
  const expectedAppCount = pendingDelete.expectedAppCount;
  return {
    tab: value.tab === "health" ? "health" : "users",
    adminDelete: {
      targetId: pendingDelete.targetId,
      ...(isUuid(operationKey) &&
      Number.isSafeInteger(expectedAppCount) &&
      expectedAppCount >= 0
        ? { operationKey, expectedAppCount }
        : {}),
    },
  };
}

function GalleryRoute({ auth, galleryReturnPosition }) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();
  const query = readGalleryFilters(location.search);
  const filters = query.filters;
  const overLimitSearch = isSearchTooLong(filters.q ?? "");
  const access = usePublicMetadata();
  const onQueryChange = useCallback(
    (patch, { replace = true } = {}) => {
      const currentSearch = window.location.search;
      const current = readGalleryFilters(currentSearch);
      if (current.invalid) return;
      const next = { ...current.filters, ...patch };
      const params = new URLSearchParams();
      if (next.q) params.set("q", next.q);
      if (next.subject) params.set("subject", next.subject);
      if (next.grade) params.set("grade", next.grade);
      if (params.toString() !== currentSearch.slice(1))
        setSearchParams(params, { replace });
    },
    [setSearchParams],
  );
  const resetQuery = useCallback(() => {
    void queryClient.resetQueries({
      queryKey: [__DATA_MODE__, "apps", "list", "", null, null, 24],
      exact: true,
    });
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [queryClient, setSearchParams]);
  useEffect(() => {
    if (query.invalid) return;
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.subject) params.set("subject", filters.subject);
    if (filters.grade) params.set("grade", filters.grade);
    if (params.toString() !== location.search.slice(1))
      setSearchParams(params, { replace: true });
  }, [
    filters.grade,
    filters.q,
    filters.subject,
    location.search,
    query.invalid,
    setSearchParams,
  ]);
  const list = useInfiniteQuery({
    queryKey: [
      __DATA_MODE__,
      "apps",
      "list",
      filters.q ?? "",
      filters.subject ?? null,
      filters.grade ?? null,
      24,
    ],
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      if (!lastPage.pagination.hasMore) return undefined;
      const nextOffset = lastPage.pagination.offset + lastPage.pagination.limit;
      return Number.isSafeInteger(nextOffset) &&
        nextOffset > lastPage.pagination.offset
        ? nextOffset
        : undefined;
    },
    retry: false,
    enabled: access.canRead && !query.invalid && !overLimitSearch,
    queryFn: async ({ pageParam, signal }) => {
      const page = await appsService.list(
        { ...filters, limit: 24, offset: pageParam },
        { signal },
      );
      if (
        page.pagination.offset !== pageParam ||
        page.pagination.limit !== 24 ||
        (page.pagination.hasMore && page.items.length === 0)
      )
        throw contractError();
      assertThemeIds(access.meta, page.items);
      return page;
    },
  });
  const queryStartedSinceReturn = useRef(false);
  useEffect(() => {
    if (galleryReturnPosition.current === null) return;
    if (list.isFetching) {
      queryStartedSinceReturn.current = true;
      return;
    }
    if (queryStartedSinceReturn.current && list.isSuccess) {
      window.scrollTo({ top: galleryReturnPosition.current });
      galleryReturnPosition.current = null;
      queryStartedSinceReturn.current = false;
    }
  }, [
    galleryReturnPosition,
    list.dataUpdatedAt,
    list.isFetching,
    list.isSuccess,
  ]);
  const pages = list.data?.pages ?? [];
  const lastPage = pages.at(-1);
  const seen = new Set();
  const items = pages.flatMap((page) =>
    page.items.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    }),
  );
  const page = lastPage ? { ...lastPage, items } : undefined;
  const previousIds = new Set(
    pages
      .slice(0, -1)
      .flatMap((currentPage) => currentPage.items.map((item) => item.id)),
  );
  const duplicateOnlyPage = Boolean(
    lastPage?.pagination.hasMore &&
    lastPage.items.length > 0 &&
    lastPage.items.every((item) => previousIds.has(item.id)),
  );
  return (
    <GalleryView
      meta={access.meta}
      page={page}
      canCreate={canCreateApp(auth, access)}
      onCreate={() => navigate("/apps/new")}
      onQueryChange={onQueryChange}
      initialFilters={filters}
      detailLinkState={{ fromGallery: true }}
      onDetailClick={(event) => {
        if (
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        galleryReturnPosition.current = window.scrollY;
      }}
      error={
        query.invalid
          ? new ServiceError(
              "VALIDATION_ERROR",
              "검색 조건을 확인할 수 없어요.",
            )
          : (access.error ??
            (list.isRefetchError || pages.length === 0
              ? list.error
              : undefined))
      }
      loading={
        !query.invalid &&
        (access.loading ||
          (access.canRead &&
            !overLimitSearch &&
            (list.isPending || list.isRefetching)))
      }
      retry={() => access.retry(() => list.refetch())}
      resetQuery={resetQuery}
      loadMore={() => list.fetchNextPage()}
      loadingMore={list.isFetchingNextPage}
      nextPageError={list.isFetchNextPageError ? list.error : undefined}
      hasNextPage={list.hasNextPage}
      duplicateOnlyPage={duplicateOnlyPage}
    />
  );
}

function DetailRoute({
  auth,
  isCurrentObservation,
  onRetryAuth,
  onDeleted,
  onDbDeleted,
  isAppRetired,
  deletionState,
  setDeletionState,
  deletionBusy,
  captureDeletionContext,
  settleDeletion,
}) {
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const access = usePublicMetadata();
  const invalidId = !isUuid(id);
  const invalidQuery = location.search !== "";
  const routeError = invalidId
    ? new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
        outcome: "rejected",
        httpStatus: 404,
      })
    : invalidQuery
      ? new ServiceError("VALIDATION_ERROR", "검색 조건을 확인할 수 없어요.", {
          outcome: "rejected",
        })
      : null;
  const retired = isAppRetired(id);
  const eligible =
    auth.status === "ready" &&
    !auth.concealed &&
    auth.user?.approved &&
    auth.user.sessionKind === "full" &&
    !auth.user.mustChangePassword;
  const publicDetail = useQuery({
    queryKey: [__DATA_MODE__, "apps", "detail", id, "public"],
    enabled: !routeError && access.canRead && !retired,
    queryFn: async ({ signal }) => {
      const app = await appsService.get(id, { signal });
      if (!app.isPublic)
        throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
          httpStatus: 404,
        });
      if (isAppRetired(id)) throw new DOMException("App deleted", "AbortError");
      assertThemeIds(access.meta, [app]);
      return app;
    },
    retry: false,
  });
  const publicApp =
    publicDetail.error?.code === "NOT_FOUND" ? undefined : publicDetail.data;
  const memberDetail = useQuery({
    queryKey: [
      __DATA_MODE__,
      "apps",
      "detail",
      id,
      "member",
      memberCacheScope(auth),
    ],
    enabled:
      !routeError && access.canRead && eligible && !publicApp && !retired,
    queryFn: async ({ signal }) => {
      const context = captureAuthObservation(auth, () =>
        isCurrentObservation(auth.observationId),
      );
      const app = await appsService.get(id, { signal, readContext: context });
      assertAuthObservation(context);
      if (
        !app.isPublic &&
        auth.user.role !== "admin" &&
        app.ownerId !== auth.user.id
      )
        throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
          httpStatus: 404,
        });
      if (isAppRetired(id)) throw new DOMException("App deleted", "AbortError");
      assertThemeIds(access.meta, [app]);
      return app;
    },
    retry: false,
  });
  const detail = publicApp
    ? publicDetail
    : eligible
      ? memberDetail
      : publicDetail;
  const app = retired
    ? undefined
    : (publicApp ??
      (eligible && memberDetail.error?.code !== "NOT_FOUND"
        ? memberDetail.data
        : undefined));
  const healthReadEnabled =
    access.meta?.capabilities.health_read.enabled === true;
  const healthCheckEnabled =
    access.meta?.capabilities.health_check.enabled === true;
  const healthKey = [__DATA_MODE__, "health", "app", id, app?.urlVersion ?? 0];
  const healthQuery = useQuery({
    queryKey: healthKey,
    enabled: Boolean(app && healthReadEnabled),
    queryFn: ({ signal }) => healthService.getAppHealth(id, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const healthSnapshot =
    healthQuery.data?.urlVersion === app?.urlVersion ? healthQuery.data : null;
  const detailHealth = healthSnapshot?.health ?? app?.health;
  const activeJobId = ["queued", "running"].includes(
    detailHealth?.latestJob?.status ?? "",
  )
    ? detailHealth.latestJob.id
    : null;
  const jobKey = [
    __DATA_MODE__,
    "health",
    "job",
    activeJobId ?? "",
    id,
    app?.urlVersion ?? 0,
  ];
  const jobQuery = useQuery({
    queryKey: jobKey,
    enabled: Boolean(activeJobId && healthReadEnabled),
    queryFn: ({ signal }) => healthService.getJob(activeJobId, { signal }),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      activeJobId &&
      document.visibilityState === "visible" &&
      query.state.status !== "error" &&
      ["queued", "running"].includes(
        query.state.data?.job.status ?? detailHealth?.latestJob?.status ?? "",
      )
        ? 2000
        : false,
    refetchIntervalInBackground: false,
  });
  const refetchJob = jobQuery.refetch;
  const jobQueryError = jobQuery.isError;
  const jobSnapshot =
    jobQuery.data?.urlVersion === app?.urlVersion ? jobQuery.data : null;
  const currentHealthSnapshot = jobSnapshot ?? healthSnapshot;
  const displayedHealth =
    currentHealthSnapshot?.health ?? app?.health ?? detailHealth;
  const jobIsActive = ["queued", "running"].includes(
    displayedHealth?.latestJob?.status ?? "",
  );
  const healthServerTime = currentHealthSnapshot?.serverTime ?? app?.serverTime;
  const healthReceivedAt = jobSnapshot
    ? jobQuery.dataUpdatedAt
    : healthSnapshot
      ? healthQuery.dataUpdatedAt
      : detail.dataUpdatedAt;
  const checkMutation = useMutation({
    mutationFn: () => healthService.requestCheck(id),
    retry: false,
    onMutate: () =>
      queryClient.cancelQueries({ queryKey: healthKey, exact: true }),
    onSuccess: (accepted) => {
      if (accepted.urlVersion !== app?.urlVersion) return;
      queryClient.setQueryData(healthKey, accepted);
    },
  });
  const latestResult = displayedHealth?.result;
  const staleAt = latestResult?.fresh_until
    ? healthReceivedAt +
      Date.parse(latestResult.fresh_until) -
      Date.parse(healthServerTime)
    : null;
  const [freshnessNow, setFreshnessNow] = useState(() => Date.now());
  const staleReadKey = useRef("");
  const freshnessKey = latestResult?.fresh_until
    ? `${id}:${app?.urlVersion}:${latestResult.fresh_until}`
    : "";
  const refetchHealth = healthQuery.refetch;
  const refreshStaleHealth = useCallback(() => {
    if (
      !healthReadEnabled ||
      !healthSnapshot ||
      !freshnessKey ||
      staleAt === null ||
      Date.now() < staleAt ||
      document.visibilityState !== "visible" ||
      staleReadKey.current === freshnessKey
    )
      return;
    staleReadKey.current = freshnessKey;
    void refetchHealth();
  }, [freshnessKey, healthReadEnabled, healthSnapshot, staleAt, refetchHealth]);
  useEffect(() => {
    if (staleAt === null) return undefined;
    const delay = staleAt - Date.now();
    if (delay <= 0) {
      setFreshnessNow(Date.now());
      refreshStaleHealth();
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setFreshnessNow(Date.now());
      refreshStaleHealth();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [staleAt, refreshStaleHealth]);
  useEffect(() => {
    let wasHidden = document.visibilityState === "hidden";
    const onVisibilityChange = () => {
      const isHidden = document.visibilityState === "hidden";
      if (wasHidden && !isHidden) {
        refreshStaleHealth();
        if (jobIsActive && !jobQueryError) void refetchJob();
      }
      wasHidden = isHidden;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [jobIsActive, jobQueryError, refetchJob, refreshStaleHealth]);
  const canCheckHealth =
    healthCheckEnabled &&
    auth.status === "ready" &&
    !auth.concealed &&
    (!auth.user ||
      (auth.user.sessionKind === "full" && !auth.user.mustChangePassword));
  const isHealthStale = staleAt !== null && freshnessNow >= staleAt;
  const checkFeedback = checkMutation.data
    ? {
        created: "연결 검사 작업을 접수했어요.",
        active_reused: "진행 중인 연결 검사를 이어서 확인합니다.",
        result_reused: "최근 연결 검사 결과를 다시 표시합니다.",
      }[checkMutation.data.disposition]
    : "";
  const protectedDetail = app?.isPublic !== true;
  const adminCanManage =
    auth.user?.role === "admin" &&
    access.meta?.capabilities.admin_apps_manage.enabled === true;
  const ownsApp = auth.user?.id === app?.ownerId;
  const canEdit =
    Boolean(app) &&
    auth.status === "ready" &&
    !auth.concealed &&
    (ownsApp || adminCanManage) &&
    auth.user.approved &&
    auth.user.sessionKind === "full" &&
    !auth.user.mustChangePassword &&
    (ownsApp
      ? access.meta?.capabilities.apps_update_own.enabled === true
      : adminCanManage);
  const canDelete =
    Boolean(app) &&
    auth.status === "ready" &&
    !auth.concealed &&
    ((ownsApp && access.meta?.capabilities.apps_delete_own.enabled === true) ||
      adminCanManage) &&
    auth.user.approved &&
    auth.user.sessionKind === "full" &&
    !auth.user.mustChangePassword;
  const fromAdmin = location.state?.fromAdmin === true;
  const currentDeletion =
    deletionState?.id === id && deletionState.actorId === auth.user?.id
      ? deletionState
      : null;
  useEffect(() => {
    if (
      !eligible ||
      currentDeletion?.phase !== "pending" ||
      currentDeletion.authObservationId === auth.observationId
    )
      return;
    setDeletionState((current) => {
      if (
        current?.id !== id ||
        current.actorId !== auth.user.id ||
        current.phase !== "pending" ||
        current.authObservationId === auth.observationId
      )
        return current;
      return {
        ...current,
        authObservationId: auth.observationId,
        phase: current.dbApplied
          ? "confirming"
          : current.operation
            ? "unknown"
            : "rejected",
        message: current.operation
          ? "인증 상태가 바뀌었어요. 기존 작업 키로 삭제 결과를 확인해 주세요."
          : "인증 상태가 바뀌어 삭제를 실행하지 않았어요. 다시 확인해 주세요.",
      };
    });
  }, [
    auth.observationId,
    auth.user?.id,
    currentDeletion,
    eligible,
    id,
    setDeletionState,
  ]);
  const canRecover = eligible && Boolean(currentDeletion?.operation);
  const deletionContext = () => captureDeletionContext(id, auth);
  const setCurrentDeletion = (next, context) => {
    assertAuthObservation(context);
    setDeletionState(next);
  };
  const runDelete = async () => {
    if ((!canDelete && !canRecover) || deletionBusy.current) return;
    if (currentDeletion?.phase === "rejected" && currentDeletion.operation)
      return;
    const request = deletionContext();
    let context = request;
    const actorId = auth.user.id;
    const existing = currentDeletion;
    const expectedVersion = existing?.operation
      ? existing.expectedVersion
      : app.version;
    let operation = existing?.operation ?? null;
    let deleteStarted = false;
    deletionBusy.current = true;
    const state = () => ({
      id,
      actorId,
      expectedVersion,
      operation,
      dbApplied: existing?.dbApplied ?? false,
      authObservationId: auth.observationId,
    });
    setCurrentDeletion(
      { ...state(), phase: "pending", message: null },
      context,
    );
    try {
      operation ??= await appsService.issueDeleteOperation(id, expectedVersion);
      assertAuthObservation(context);
      setCurrentDeletion(
        { ...state(), phase: "pending", message: null },
        context,
      );
      deleteStarted = true;
      await appsService.delete(id, expectedVersion, operation.key);
      context = await settleDeletion(request);
      if (!context) return;
      assertAuthObservation(context);
      await onDeleted(id, context, fromAdmin);
    } catch (error) {
      if (deleteStarted) context = await settleDeletion(request);
      if (!context) return;
      if (!context.isCurrent()) return;
      const expired = error?.code === "OPERATION_EXPIRED";
      const applied =
        existing?.dbApplied || error?.code === "DELETION_CONFIRMATION_PENDING";
      if (applied || error?.code === "NOT_FOUND") {
        await onDbDeleted(id, context);
        if (!context.isCurrent()) return;
      }
      setCurrentDeletion(
        {
          ...state(),
          dbApplied: Boolean(applied),
          phase: applied
            ? "confirming"
            : expired
              ? "expired"
              : error?.outcome === "unknown" ||
                  error?.code === "OPERATION_ALREADY_RESOLVED"
                ? "unknown"
                : "rejected",
          rejectionCode: error?.code,
          message: expired
            ? "삭제 결과 확인 기간이 지나 확인할 수 없어요. 앱이 없는 상태만으로 삭제 성공을 판단할 수 없습니다."
            : (error?.message ??
              "삭제 결과를 확인하지 못했어요. 작업 결과를 확인해 주세요."),
        },
        context,
      );
    } finally {
      deletionBusy.current = false;
    }
  };
  const checkDeleteResult = async () => {
    const existing = currentDeletion;
    if (!canRecover || deletionBusy.current) return;
    const request = deletionContext();
    let context = request;
    deletionBusy.current = true;
    setCurrentDeletion(
      {
        ...existing,
        phase: "pending",
        message: "삭제 결과를 확인하고 있어요.",
        authObservationId: auth.observationId,
      },
      context,
    );
    try {
      const operation = await appsService.getDeleteOperation(
        existing.operation.key,
      );
      context = await settleDeletion(request);
      if (!context) return;
      assertAuthObservation(context);
      if (
        operation.key !== existing.operation.key ||
        operation.kind !== "app_delete" ||
        operation.targetId !== id
      )
        throw contractError();
      if (operation.state === "succeeded") {
        await onDeleted(id, context, fromAdmin);
      } else {
        const applied =
          existing.dbApplied ||
          operation.state === "confirming_deletion" ||
          Boolean(operation.dbAppliedAt);
        if (applied || operation.rejectionCode === "NOT_FOUND") {
          await onDbDeleted(id, context);
          assertAuthObservation(context);
        }
        setCurrentDeletion(
          {
            ...existing,
            operation,
            dbApplied: Boolean(applied),
            phase: applied
              ? "confirming"
              : operation.state === "rejected"
                ? "rejected"
                : "unknown",
            rejectionCode: operation.rejectionCode,
            message: applied
              ? "앱 삭제가 반영되었고 삭제 결과 확인을 기다리고 있어요."
              : operation.rejectionCode === "VERSION_CONFLICT"
                ? "앱 정보가 바뀌어 삭제하지 않았어요. 최신 상태를 확인해 주세요."
                : operation.state === "rejected"
                  ? "삭제 요청이 거절되었어요."
                  : "삭제 결과가 아직 확정되지 않았어요. 같은 작업 키로 결과를 확인하거나 다시 요청해 주세요.",
          },
          context,
        );
      }
    } catch (error) {
      context = await settleDeletion(request);
      if (!context) return;
      if (!context.isCurrent()) return;
      const expired = error?.code === "OPERATION_EXPIRED";
      setCurrentDeletion(
        {
          ...existing,
          phase: existing.dbApplied
            ? "confirming"
            : expired
              ? "expired"
              : "unknown",
          message: expired
            ? "삭제 결과 확인 기간이 지나 확인할 수 없어요. 앱이 없는 상태만으로 삭제 성공을 판단할 수 없습니다."
            : `삭제 결과를 확인할 수 없어요. ${error?.message ?? "같은 작업 키로 다시 확인해 주세요."}`,
        },
        context,
      );
    } finally {
      deletionBusy.current = false;
    }
  };
  const loadLatestForDelete = async () => {
    if (
      !eligible ||
      deletionBusy.current ||
      currentDeletion?.rejectionCode !== "VERSION_CONFLICT"
    )
      return;
    const context = deletionContext();
    deletionBusy.current = true;
    const existing = currentDeletion;
    setCurrentDeletion(
      {
        ...existing,
        phase: "pending",
        message: "최신 앱을 확인하고 있어요.",
        authObservationId: auth.observationId,
      },
      context,
    );
    try {
      const latest = await queryClient.fetchQuery({
        queryKey: [
          __DATA_MODE__,
          "apps",
          "detail",
          id,
          "member",
          memberCacheScope(auth),
        ],
        staleTime: 0,
        queryFn: ({ signal }) =>
          appsService.get(id, { signal, readContext: context }),
      });
      assertAuthObservation(context);
      if (isAppRetired(id)) throw new DOMException("App deleted", "AbortError");
      if (latest.isPublic)
        queryClient.setQueryData(
          [__DATA_MODE__, "apps", "detail", id, "public"],
          latest,
        );
      else
        queryClient.removeQueries({
          queryKey: [__DATA_MODE__, "apps", "detail", id, "public"],
        });
      setCurrentDeletion(
        {
          id,
          actorId: auth.user.id,
          expectedVersion: latest.version,
          operation: null,
          phase: "idle",
          message: null,
        },
        context,
      );
    } catch (error) {
      if (!context.isCurrent()) return;
      if (error?.code === "NOT_FOUND") {
        await onDbDeleted(id, context);
        if (!context.isCurrent()) return;
      }
      setCurrentDeletion(
        {
          ...existing,
          phase: "rejected",
          rejectionCode:
            error?.code === "NOT_FOUND" ? "NOT_FOUND" : existing.rejectionCode,
          message: `최신 앱을 확인하지 못했어요. ${error?.message ?? "다시 확인해 주세요."}`,
        },
        context,
      );
    } finally {
      deletionBusy.current = false;
    }
  };
  const cancelDelete = () => {
    if (
      currentDeletion?.phase === "pending" ||
      currentDeletion?.phase === "unknown" ||
      currentDeletion?.phase === "expired" ||
      currentDeletion?.phase === "confirming"
    )
      return;
    setDeletionState(null);
  };
  const authError = protectedDetail && auth.status === "error";
  return (
    <AppDetailView
      app={app}
      meta={access.meta}
      authStatus={protectedDetail ? auth.status : "ready"}
      authError={authError ? auth.error : null}
      concealed={protectedDetail && auth.concealed}
      loading={
        !retired &&
        !routeError &&
        (access.loading || (!authError && detail.isPending))
      }
      error={
        retired && !currentDeletion
          ? new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.")
          : (routeError ?? access.error ?? detail.error)
      }
      retry={
        invalidQuery && !invalidId
          ? () => navigate(location.pathname, { replace: true })
          : authError
            ? async () => {
                await onRetryAuth();
                access.retry(publicDetail.refetch);
              }
            : () => access.retry(detail.refetch)
      }
      canEdit={canEdit}
      canDelete={canDelete}
      deleteState={eligible ? currentDeletion : null}
      onDelete={runDelete}
      onCheckDeleteResult={checkDeleteResult}
      onRetryDelete={runDelete}
      onCancelDelete={cancelDelete}
      onLoadLatestDelete={loadLatestForDelete}
      fromGallery={location.state?.fromGallery === true}
      fromAdmin={fromAdmin}
      health={displayedHealth}
      healthServerTime={healthServerTime}
      healthStale={isHealthStale}
      isAdmin={
        auth.user?.role === "admin" &&
        auth.user.approved &&
        auth.user.sessionKind === "full" &&
        !auth.user.mustChangePassword
      }
      canCheckHealth={canCheckHealth}
      checkingHealth={checkMutation.isPending}
      checkHealthError={checkMutation.error}
      checkFeedback={checkFeedback}
      checkCompleted={Boolean(checkMutation.data)}
      onCheckHealth={() => checkMutation.mutate()}
      healthReadError={healthQuery.error}
      onRetryHealthRead={() => healthQuery.refetch()}
      jobReadError={jobQueryError ? jobQuery.error : null}
      onRetryJobRead={refetchJob}
      onBack={() => {
        if (
          ["pending", "unknown", "expired", "confirming"].includes(
            currentDeletion?.phase,
          ) &&
          !window.confirm(
            "삭제 결과가 아직 확정되지 않았어요. 이 화면을 떠날까요?",
          )
        )
          return;
        if (fromAdmin) navigate("/admin?tab=health");
        else
          navigate(
            location.state?.fromEdit === true &&
              location.state?.fromGallery === true
              ? -2
              : location.state?.fromGallery === true
                ? -1
                : "/",
          );
      }}
    />
  );
}

function EditRoute({
  auth,
  isCurrentObservation,
  isAppRetired,
  onRetryAuth,
  onSaved,
}) {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const access = usePublicMetadata();
  const member = auth.user;
  const adminCanManage =
    member?.role === "admin" &&
    access.meta?.capabilities.admin_apps_manage.enabled === true;
  const readyMember =
    auth.status === "ready" &&
    !auth.concealed &&
    member?.approved &&
    member.sessionKind === "full" &&
    !member.mustChangePassword &&
    (member.role === "user" || member.role === "admin");
  const detail = useQuery({
    queryKey: [
      __DATA_MODE__,
      "apps",
      "detail",
      id,
      "member",
      memberCacheScope(auth),
    ],
    enabled: access.canRead && readyMember && !isAppRetired(id),
    queryFn: async ({ signal }) => {
      const context = captureAuthObservation(auth, () =>
        isCurrentObservation(auth.observationId),
      );
      const app = await appsService.get(id, { signal, readContext: context });
      assertAuthObservation(context);
      const canManageOther =
        member?.role === "admin" &&
        access.meta?.capabilities.admin_apps_manage.enabled === true;
      if (app.ownerId !== member?.id && !canManageOther)
        throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.");
      assertThemeIds(access.meta, [app]);
      return app;
    },
  });
  const ownsApp = detail.data?.ownerId === member?.id;
  const canEdit =
    readyMember &&
    !isAppRetired(id) &&
    Boolean(detail.data) &&
    (ownsApp
      ? access.meta?.capabilities.apps_update_own.enabled === true
      : adminCanManage);
  const [wasEditable, setWasEditable] = useState(false);
  const continuity = draftContinuityScope(auth);
  const ownerScope = useRef(null);
  const lastApp = useRef(null);
  if (detail.data) lastApp.current = detail.data;
  if (canEdit) ownerScope.current = continuity;
  if (
    isAppRetired(id) ||
    (readyMember &&
      ([
        "NOT_FOUND",
        "FORBIDDEN",
        "AUTH_REQUIRED",
        "PASSWORD_CHANGE_REQUIRED",
      ].includes(detail.error?.code) ||
        (detail.data && !ownsApp && !adminCanManage)))
  ) {
    ownerScope.current = null;
    lastApp.current = null;
  }
  const formApp =
    detail.data ?? (lastApp.current?.id === id ? lastApp.current : null);
  useEffect(() => {
    if (canEdit) setWasEditable(true);
  }, [canEdit]);
  const keepDraft =
    !isAppRetired(id) &&
    (canEdit ||
      (wasEditable &&
        continuity &&
        continuity === ownerScope.current &&
        (access.meta?.capabilities.apps_update_own.enabled === true ||
          adminCanManage)));
  const form = keepDraft ? (
    <div
      hidden={!canEdit}
      inert={!canEdit ? "" : undefined}
      aria-hidden={!canEdit}
    >
      <SubmitView
        key={`${continuity}:${id}`}
        app={formApp}
        meta={access.meta}
        onSaved={onSaved}
        readLatest={async (appId) => {
          const context = captureAuthObservation(auth, () =>
            isCurrentObservation(auth.observationId),
          );
          const latest = await queryClient.fetchQuery({
            queryKey: [
              __DATA_MODE__,
              "apps",
              "detail",
              appId,
              "member",
              memberCacheScope(auth),
            ],
            staleTime: 0,
            queryFn: ({ signal }) =>
              appsService.get(appId, { signal, readContext: context }),
          });
          if (isAppRetired(appId))
            throw new DOMException("App deleted", "AbortError");
          assertAuthObservation(context);
          return latest;
        }}
        onLatest={(app) =>
          queryClient.setQueryData(
            [
              __DATA_MODE__,
              "apps",
              "detail",
              id,
              "member",
              memberCacheScope(auth),
            ],
            app,
          )
        }
        onCancel={() =>
          location.state?.fromDetail === true
            ? navigate(-1)
            : navigate(`/apps/${id}`, { replace: true })
        }
      />
    </div>
  ) : null;
  const message = (
    title,
    description,
    action,
    role = action ? "alert" : "status",
  ) => (
    <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
      <div role={role} aria-live={role === "alert" ? "assertive" : "polite"}>
        <EmptyState title={title} desc={description}>
          {action}
        </EmptyState>
      </div>
    </main>
  );

  if (auth.status === "unavailable")
    return message(
      "앱 수정 기능은 아직 준비 중이에요",
      "API 모드에서는 인증과 앱 쓰기를 사용할 수 없어요.",
    );
  if (auth.concealed || auth.status === "checking")
    return (
      <>
        {form}
        {message("로그인 상태를 확인하고 있어요")}
      </>
    );
  if (auth.status === "error")
    return (
      <>
        {form}
        {message(
          "로그인 상태를 확인할 수 없어요",
          auth.error?.message,
          <Btn onClick={onRetryAuth}>다시 확인</Btn>,
        )}
      </>
    );
  if (!member)
    return (
      <Navigate
        to={`/auth?mode=login&return_to=${encodeURIComponent(`/apps/${id}/edit`)}`}
        replace
      />
    );
  if (!readyMember)
    return message(
      "승인된 회원만 앱을 수정할 수 있어요",
      "앱 등록·수정에는 전체 회원 권한이 필요해요.",
    );
  if (isAppRetired(id))
    return message(
      "아카이브 앱을 찾을 수 없어요",
      "삭제된 앱은 수정할 수 없습니다.",
    );
  if (access.loading || detail.isPending)
    return (
      <>
        {form}
        {message("앱 정보를 확인하고 있어요")}
      </>
    );
  if (access.error)
    return (
      <>
        {form}
        {message(
          "앱 수정 기능을 확인할 수 없어요",
          access.error.message,
          <Btn onClick={() => access.retry(detail.refetch)}>다시 확인</Btn>,
        )}
      </>
    );
  if (detail.error || !detail.data)
    return (
      <>
        {form}
        {message(
          "앱을 수정할 수 없어요",
          detail.error?.message ?? "앱을 찾을 수 없어요.",
          <Btn onClick={() => void detail.refetch()}>다시 확인</Btn>,
        )}
      </>
    );
  if (detail.data.ownerId !== member.id && !adminCanManage)
    return message(
      "본인 앱만 수정할 수 있어요",
      "다른 회원의 앱은 수정할 수 없습니다.",
    );
  if (
    detail.data.ownerId === member.id &&
    !access.meta?.capabilities.apps_update_own.enabled
  ) {
    const preparing = isNotImplemented(
      access.meta?.capabilities.apps_update_own,
    );
    return message(
      preparing
        ? "앱 수정 기능은 아직 준비 중이에요"
        : "앱 수정 기능을 사용할 수 없어요",
      preparing
        ? "갤러리는 계속 둘러볼 수 있습니다."
        : "잠시 후 다시 확인해 주세요.",
      preparing ? (
        <Link
          to="/"
          className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
        >
          갤러리로
        </Link>
      ) : undefined,
      "status",
    );
  }
  return form;
}

function SubmitRoute({ auth, onRetryAuth, onCreated }) {
  const access = usePublicMetadata();
  const [wasAvailable, setWasAvailable] = useState(false);
  const scopeKey = draftContinuityScope(auth);
  const draftOwner = useRef(null);
  const member = isApprovedFullAppCreator(auth);
  const canCreate =
    member &&
    !access.loading &&
    !access.error &&
    access.meta?.capabilities.apps_create.enabled === true;
  useEffect(() => {
    if (canCreate) {
      draftOwner.current = scopeKey;
      setWasAvailable(true);
    }
  }, [canCreate, scopeKey]);
  const keepFormMounted =
    canCreate ||
    (wasAvailable &&
      scopeKey &&
      draftOwner.current === scopeKey &&
      (auth.concealed || auth.status !== "ready") &&
      access.meta?.capabilities.apps_create.enabled === true);
  const form = keepFormMounted ? (
    <div
      hidden={!canCreate}
      inert={!canCreate ? "" : undefined}
      aria-hidden={!canCreate}
    >
      <SubmitView key={scopeKey} meta={access.meta} onCreated={onCreated} />
    </div>
  ) : null;
  if (auth.status === "unavailable")
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title="앱 등록 기능은 아직 준비 중이에요"
            desc="API 모드에서는 인증과 앱 쓰기를 사용할 수 없어요."
          />
        </div>
      </main>
    );
  if (auth.concealed || auth.status === "checking")
    return (
      <>
        {form}
        <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
          <div role="status" aria-live="polite">
            <EmptyState title="로그인 상태를 확인하고 있어요" />
          </div>
        </main>
      </>
    );
  if (auth.status === "error")
    return (
      <>
        {form}
        <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
          <div role="alert" aria-live="assertive">
            <EmptyState
              title="로그인 상태를 확인할 수 없어요"
              desc={auth.error?.message}
            >
              <Btn onClick={onRetryAuth}>다시 확인</Btn>
            </EmptyState>
          </div>
        </main>
      </>
    );
  if (auth.status !== "ready")
    return (
      <>
        {form}
        <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
          <div role="status" aria-live="polite">
            <EmptyState title="인증 상태를 복구해 주세요">
              <Link
                to="/auth?mode=login"
                className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
              >
                인증 복구
              </Link>
            </EmptyState>
          </div>
        </main>
      </>
    );
  if (!auth.user) return <Navigate to="/auth?mode=login" replace />;
  if (auth.user.mustChangePassword || auth.user.sessionKind !== "full")
    return <Navigate to="/auth?mode=password-change" replace />;
  if (!member)
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="alert" aria-live="assertive">
          <EmptyState
            title="승인된 회원만 앱을 등록할 수 있어요"
            desc="갤러리는 계속 둘러볼 수 있습니다."
          >
            <Link
              to="/"
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              갤러리로
            </Link>
          </EmptyState>
        </div>
      </main>
    );
  if (access.loading)
    return (
      <>
        {form}
        <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
          <div role="status" aria-live="polite">
            <EmptyState title="등록 기능을 확인하고 있어요" />
          </div>
        </main>
      </>
    );
  if (access.error || !access.meta?.capabilities.apps_create.enabled) {
    const preparing =
      !access.error && isNotImplemented(access.meta?.capabilities.apps_create);
    return (
      <>
        {form}
        <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
          <div
            role={preparing ? "status" : "alert"}
            aria-live={preparing ? "polite" : "assertive"}
          >
            <EmptyState
              title={
                preparing
                  ? "앱 등록 기능은 아직 준비 중이에요"
                  : "앱 등록 기능을 사용할 수 없어요"
              }
              desc={
                access.error?.message ??
                (isNotImplemented(access.meta?.capabilities.apps_create)
                  ? "갤러리는 계속 둘러볼 수 있습니다."
                  : "잠시 후 다시 확인해 주세요.")
              }
            >
              {access.error ? (
                <Btn onClick={() => access.retry(() => {})}>다시 확인</Btn>
              ) : null}
              <Link
                to="/"
                className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
              >
                갤러리로
              </Link>
            </EmptyState>
          </div>
        </main>
      </>
    );
  }
  return form;
}

function NotFoundRoute() {
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-16 sm:px-8">
      <EmptyState
        title="페이지를 찾을 수 없어요"
        desc="주소를 확인하거나 갤러리로 돌아가 주세요."
      >
        <Link
          to="/"
          className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
        >
          갤러리로
        </Link>
      </EmptyState>
    </main>
  );
}

function AuthRoute({
  location,
  auth,
  onRetry,
  onLogin,
  onRegister,
  onChangePassword,
  onReauthenticate,
  onResolveAuth,
  onResetAuth,
  onDiscardMissingSession,
  meta,
}) {
  const route = readAuthRoute(location.search);
  const authUser =
    auth.status === "ready" && !auth.concealed ? auth.user : null;
  const mode = authUser?.mustChangePassword ? "password-change" : route.mode;
  return (
    <AuthView
      key={
        ["password-change", "reauth"].includes(mode)
          ? `${mode}:${JSON.stringify([
              auth.user?.id,
              auth.user?.role,
              auth.user?.sessionKind,
              auth.flow?.flowId,
              auth.flow?.lastIdentityChangeRevision,
            ])}`
          : mode
      }
      mode={mode}
      authUser={authUser}
      routeError={route.invalid}
      authStatus={
        auth.status === "unavailable" ||
        (__DATA_MODE__ === "api" &&
          mode === "reauth" &&
          meta?.capabilities.admin_reauth.enabled !== true)
          ? "unavailable"
          : auth.concealed
            ? "checking"
            : auth.status
      }
      authError={auth.error}
      onRetry={onRetry}
      onLogin={(input) => onLogin(input, route.returnTo)}
      onRegister={onRegister}
      onChangePassword={(input) => onChangePassword(input, route.returnTo)}
      onReauthenticate={onReauthenticate}
      returnTo={route.returnTo}
      onResolveAuth={onResolveAuth}
      onResetAuth={onResetAuth}
      onDiscardMissingSession={onDiscardMissingSession}
      canDiscardMissingSession={
        auth.unresolvedTransitionId !== null &&
        auth.unresolvedTransitionId !== undefined &&
        auth.flow?.sessionGeneration !== null &&
        auth.flow?.sessionGeneration !== undefined &&
        auth.sessionCookiePresent === false
      }
    />
  );
}

function AdminRoute({
  auth,
  onRetry,
  meta,
  resumeState,
  onConsumeResume,
  onSaveResume,
}) {
  const continuity = draftContinuityScope(auth);
  const scopeKey = memberCacheScope(auth);
  const active =
    auth.status === "ready" &&
    !auth.concealed &&
    auth.user?.role === "admin" &&
    Boolean(continuity) &&
    meta?.capabilities.admin_users_read.enabled === true;
  const owner = useRef(null);
  if (active) owner.current = continuity;
  const keepMounted =
    continuity &&
    continuity === owner.current &&
    meta?.capabilities.admin_users_read.enabled === true;
  return (
    <>
      {keepMounted ? (
        <div
          hidden={!active}
          inert={!active ? "" : undefined}
          aria-hidden={!active}
        >
          <AdminView
            key={continuity}
            scopeKey={scopeKey}
            active={active}
            meta={meta}
            resumeState={resumeState}
            onConsumeResume={onConsumeResume}
            onSaveResume={onSaveResume}
          />
        </div>
      ) : null}
      {!active ? <AdminAccessState auth={auth} onRetry={onRetry} /> : null}
    </>
  );
}

function AdminAccessState({ auth, onRetry }) {
  if (auth.status === "unavailable")
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title="관리자 기능은 아직 준비 중이에요"
            desc="API 모드에서는 인증과 관리자 기능을 사용할 수 없어요."
          />
        </div>
      </main>
    );
  if (auth.concealed)
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState title="화면이 잠시 가려졌습니다" />
        </div>
      </main>
    );
  if (auth.status === "checking")
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState title="로그인 상태를 확인하고 있어요" />
        </div>
      </main>
    );
  if (auth.status === "error")
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="alert" aria-live="assertive">
          <EmptyState
            title="로그인 상태를 확인할 수 없어요"
            desc={auth.error?.message}
          >
            <Btn onClick={onRetry}>다시 확인</Btn>
            {__DATA_MODE__ === "mock" &&
            auth.error instanceof ServiceError &&
            auth.error.code === "MOCK_STORAGE_ERROR" ? (
              <Link
                to="/__dev/mock-reset"
                className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
              >
                mock 저장 초기화
              </Link>
            ) : null}
          </EmptyState>
        </div>
      </main>
    );
  if (!auth.user)
    return (
      <Navigate
        to={`/auth?mode=login&return_to=${encodeURIComponent("/admin")}`}
        replace
      />
    );
  if (auth.user.sessionKind === "change_only" || auth.user.mustChangePassword)
    return (
      <Navigate
        to={`/auth?mode=password-change&return_to=${encodeURIComponent("/admin")}`}
        replace
      />
    );
  if (auth.user.role !== "admin")
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="alert" aria-live="assertive">
          <EmptyState title="관리자 권한이 필요해요" />
        </div>
      </main>
    );
  return (
    <main
      role="status"
      className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8"
    >
      <EmptyState title="관리자 기능을 현재 사용할 수 없어요" />
    </main>
  );
}

export default function App() {
  const location = useLocation();
  const currentLocation = useRef(location);
  currentLocation.current = location;
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const previousLocation = useRef({
    key: location.key,
    pathname: location.pathname,
    initial: true,
  });
  const previousAuthEntry = useRef(null);
  const galleryReturnPosition = useRef(null);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState("");
  const authMetadata = usePublicMetadata();
  const apiAuthPath = __DATA_MODE__ === "api" ? location.pathname : null;
  const apiAuthEnabled =
    __DATA_MODE__ === "api" &&
    authMetadata.meta?.capabilities.auth_login.enabled === true &&
    authMetadata.meta.capabilities.auth_logout.enabled === true &&
    authMetadata.meta.capabilities.auth_password_change.enabled === true &&
    !authMetadata.error;
  const authRequest = useRef(0);
  const authObservation = useRef(0);
  const pendingReauth = useRef(null);
  const [adminResume, setAdminResume] = useState(null);
  const consumeAdminResume = useCallback(() => setAdminResume(null), []);
  const saveAdminResume = useCallback((value) => {
    const owner = draftContinuityScope(authSnapshot.current);
    const resume = adminReauthResumeState(value);
    if (owner && resume) setAdminResume({ owner, resume });
  }, []);
  const authController = useRef(null);
  const pageAway = useRef(document.visibilityState === "hidden");
  const authSnapshot = useRef({
    user: null,
    flow: null,
    observationGeneration: 0,
  });
  const [auth, setAuth] = useState({
    status: __DATA_MODE__ === "mock" ? "checking" : "unavailable",
    user: null,
    flow: null,
    observationGeneration: 0,
    observationId: 0,
    error: null,
    concealed: document.visibilityState === "hidden",
  });
  const [logoutPending, setLogoutPending] = useState(false);
  const [deletion, setDeletion] = useState(null);
  const deletionAttempt = useRef(0);
  const deletionBusy = useRef(false);
  const activeDeletion = useRef(null);
  const [settledDeletion, setSettledDeletion] = useState(null);
  const retiredApps = useRef(new Set());
  const isAppRetired = useCallback((id) => retiredApps.current.has(id), []);
  useEffect(() => {
    if (
      (location.pathname !== "/" && location.state?.fromGallery !== true) ||
      (location.pathname === "/" && navigationType !== "POP")
    )
      galleryReturnPosition.current = null;
  }, [location.key, location.pathname, location.state, navigationType]);

  const onAppCreated = useCallback(
    (id) => {
      void queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "apps", "list"],
      });
      navigate(`/apps/${id}`, {
        replace: true,
        state: { fromGallery: true },
      });
      setToast("앱을 등록했어요.");
    },
    [navigate, queryClient],
  );
  const onAppUpdated = useCallback(
    async (app) => {
      const fromAdmin = location.state?.fromAdmin === true;
      if (app.isPublic)
        queryClient.setQueryData(
          [__DATA_MODE__, "apps", "detail", app.id, "public"],
          app,
        );
      else {
        const publicKey = [__DATA_MODE__, "apps", "detail", app.id, "public"];
        await queryClient.cancelQueries({ queryKey: publicKey, exact: true });
        queryClient.removeQueries({ queryKey: publicKey, exact: true });
      }
      void queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "apps", "detail", app.id],
      });
      void queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "apps", "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "admin"],
      });
      navigate(
        fromAdmin ? "/admin?tab=health" : `/apps/${app.id}`,
        fromAdmin
          ? { replace: true }
          : {
              replace: true,
              state: {
                fromGallery: location.state?.fromGallery === true,
                fromEdit: true,
              },
            },
      );
      setToast("앱을 수정했어요.");
    },
    [location.state, navigate, queryClient],
  );
  const onDbDeleted = useCallback(
    async (id, context) => {
      assertAuthObservation(context);
      retiredApps.current.add(id);
      const target = (query) => {
        const key = query.queryKey;
        return (
          key[0] === __DATA_MODE__ &&
          ((key[1] === "apps" && key[2] === "detail" && key[3] === id) ||
            (key[1] === "health" &&
              ((key[2] === "app" && key[3] === id) ||
                (key[2] === "job" && key[4] === id))))
        );
      };
      const lists = (query) =>
        query.queryKey[0] === __DATA_MODE__ &&
        ((query.queryKey[1] === "apps" && query.queryKey[2] === "list") ||
          query.queryKey[1] === "admin");
      await queryClient.cancelQueries({
        predicate: (query) => target(query) || lists(query),
      });
      if (!context.isCurrent()) return;
      queryClient.removeQueries({ predicate: target });
      void queryClient.invalidateQueries({ predicate: lists });
    },
    [queryClient],
  );
  const onAppDeleted = useCallback(
    async (id, context, fromAdmin = false) => {
      assertAuthObservation(context);
      await onDbDeleted(id, context);
      assertAuthObservation(context);
      setDeletion(null);
      if (currentLocation.current.pathname === `/apps/${id}`)
        navigate(fromAdmin ? "/admin?tab=health" : "/", { replace: true });
      setToast("앱을 삭제했어요.");
    },
    [navigate, onDbDeleted],
  );

  const isProtectedQuery = useCallback((query) => {
    const key = query.queryKey;
    return (
      (key[0] === __DATA_MODE__ && key[1] === "health") ||
      (key[0] === __DATA_MODE__ && key[1] === "admin") ||
      (key[0] === __DATA_MODE__ &&
        key[1] === "apps" &&
        key[2] === "detail" &&
        key[4] === "member")
    );
  }, []);
  const cancelProtectedQueries = useCallback(async () => {
    await queryClient.cancelQueries({ predicate: isProtectedQuery });
    queryClient.removeQueries({ predicate: isProtectedQuery });
  }, [isProtectedQuery, queryClient]);
  const clearChangedScopeQueries = useCallback(async () => {
    const changedScope = (query) =>
      isProtectedQuery(query) ||
      (query.queryKey[0] === __DATA_MODE__ &&
        query.queryKey[1] === "apps" &&
        query.queryKey[2] === "detail" &&
        query.queryKey[4] === "public");
    await queryClient.cancelQueries({ predicate: changedScope });
    queryClient.removeQueries({ predicate: changedScope });
  }, [isProtectedQuery, queryClient]);

  const restoreAuth = useCallback(
    async ({ concealed = false } = {}) => {
      if (__DATA_MODE__ === "api" && !apiAuthEnabled) return null;
      const request = ++authRequest.current;
      authController.current?.abort();
      const controller = new AbortController();
      authController.current = controller;
      const observationId = ++authObservation.current;
      setAuth({
        ...authSnapshot.current,
        status: "checking",
        observationId,
        error: null,
        concealed:
          concealed ||
          pageAway.current ||
          document.visibilityState === "hidden",
      });
      await cancelProtectedQueries();
      if (request !== authRequest.current) return null;
      try {
        let knownFlow = false;
        if (__DATA_MODE__ === "api") {
          try {
            knownFlow = localStorage.getItem("eduvibe-auth-flow-v1") !== null;
          } catch {
            /* Public reads do not require storage. */
          }
        }
        const observed =
          __DATA_MODE__ === "api" && apiAuthPath !== "/auth" && !knownFlow
            ? {
                ...authSnapshot.current,
                user: null,
                status: "ready",
                sessionCookiePresent: false,
                unresolvedTransitionId: null,
              }
            : __DATA_MODE__ === "api" && apiAuthPath === "/auth"
              ? await prepareApiAuth({ signal: controller.signal })
              : await authService.getCurrentAuthState({
                  signal: controller.signal,
                });
        if (request !== authRequest.current || controller.signal.aborted)
          return null;
        const previousScope = memberCacheScope(authSnapshot.current);
        const nextScope = memberCacheScope(observed);
        if (previousScope !== nextScope) await clearChangedScopeQueries();
        if (request !== authRequest.current || controller.signal.aborted)
          return null;
        authSnapshot.current = observed;
        const next = {
          ...observed,
          status: observed.status,
          observationId,
          error: null,
          concealed: pageAway.current || document.visibilityState === "hidden",
        };
        setAuth(next);
        return next;
      } catch (error) {
        if (request !== authRequest.current || controller.signal.aborted)
          return null;
        const failed = {
          ...authSnapshot.current,
          status: "error",
          observationId,
          error,
          concealed: pageAway.current || document.visibilityState === "hidden",
        };
        setAuth(failed);
        return failed;
      } finally {
        if (authController.current === controller)
          authController.current = null;
      }
    },
    [
      apiAuthEnabled,
      apiAuthPath,
      cancelProtectedQueries,
      clearChangedScopeQueries,
    ],
  );

  const refreshMockState = useCallback(async () => {
    await restoreAuth({ concealed: true });
    queryClient.removeQueries({
      predicate: (query) =>
        __DATA_MODE__ === "mock" &&
        query.queryKey[0] === __DATA_MODE__ &&
        query.queryKey[1] === "health",
    });
    queryClient.removeQueries({
      predicate: (query) =>
        __DATA_MODE__ === "mock" &&
        query.queryKey[0] === __DATA_MODE__ &&
        query.queryKey[1] === "apps" &&
        query.queryKey[2] === "detail",
    });
    await queryClient.invalidateQueries({
      predicate: (query) => {
        const key = query.queryKey;
        return (
          __DATA_MODE__ === "mock" &&
          key[0] === __DATA_MODE__ &&
          (key[1] === "meta" ||
            (key[1] === "admin" && key[2] === "users") ||
            (key[1] === "apps" &&
              (key[2] === "list" ||
                (key[2] === "detail" && query.state.data?.isPublic !== false))))
        );
      },
    });
  }, [queryClient, restoreAuth]);

  const beginAuthTransition = useCallback(async () => {
    if (__DATA_MODE__ === "api" && !apiAuthEnabled) return;
    ++authRequest.current;
    authController.current?.abort();
    authController.current = null;
    const observationId = ++authObservation.current;
    setAuth({
      ...authSnapshot.current,
      status: "ready",
      observationId,
      error: null,
      concealed: true,
    });
    await cancelProtectedQueries();
  }, [apiAuthEnabled, cancelProtectedQueries]);

  const concealOnDeparture = useCallback(() => {
    if (pageAway.current) return;
    pageAway.current = true;
    void beginAuthTransition();
  }, [beginAuthTransition]);

  const restoreOnReturn = useCallback(() => {
    if (document.visibilityState === "hidden") return;
    pageAway.current = false;
    if (!authController.current) void restoreAuth();
  }, [restoreAuth]);

  const recheckAuth = useCallback(() => {
    if (document.visibilityState !== "hidden") pageAway.current = false;
    return restoreAuth();
  }, [restoreAuth]);

  const isCurrentObservation = useCallback(
    (id) =>
      authObservation.current === id &&
      !pageAway.current &&
      document.visibilityState !== "hidden",
    [],
  );

  const captureDeletionContext = useCallback(
    (id, state) => {
      const attempt = ++deletionAttempt.current;
      const context = {
        ...captureAuthObservation(
          state,
          () =>
            isCurrentObservation(state.observationId) &&
            deletionAttempt.current === attempt,
        ),
        id,
        navigationObservations: new Set(),
        fenced: false,
      };
      activeDeletion.current = context;
      return context;
    },
    [isCurrentObservation],
  );
  const settleDeletion = useCallback((context) => {
    if (!context || context.isCurrent()) return Promise.resolve(context);
    return new Promise((resolve) => setSettledDeletion({ context, resolve }));
  }, []);
  useEffect(() => {
    const request = activeDeletion.current;
    if (!request) return;
    const sameScope =
      auth.user?.id === request.state.user.id &&
      auth.user?.role === request.state.user.role &&
      auth.flow?.flowId === request.state.flow.flowId &&
      auth.flow?.sessionGeneration === request.state.flow.sessionGeneration &&
      auth.flow?.lastIdentityChangeRevision ===
        request.state.flow.lastIdentityChangeRevision &&
      auth.user?.sessionKind === "full" &&
      auth.user?.approved &&
      !auth.user?.mustChangePassword;
    if (auth.concealed || (auth.status === "ready" && !sameScope))
      request.fenced = true;
    if (!settledDeletion) return;
    const { context, resolve } = settledDeletion;
    let navigationOnly = context === request && !request.fenced;
    for (
      let observation = context.state.observationId + 1;
      observation <= authObservation.current;
      observation += 1
    )
      navigationOnly &&= context.navigationObservations.has(observation);
    if (navigationOnly && auth.status === "checking") return;
    setSettledDeletion(null);
    resolve(
      navigationOnly && sameScope && auth.status === "ready"
        ? captureAuthObservation(
            auth,
            () =>
              activeDeletion.current === request &&
              isCurrentObservation(auth.observationId),
          )
        : null,
    );
  }, [auth, isCurrentObservation, settledDeletion]);

  const login = useCallback(
    async (input, returnTo) => {
      await beginAuthTransition();
      let confirmed = false;
      try {
        const result = await authService.login(input);
        const current = await restoreAuth();
        confirmed = true;
        if (current?.status !== "ready" || current.user?.id !== result.user.id)
          throw (
            current?.error ??
            new ServiceError(
              "SERVICE_UNAVAILABLE",
              "로그인 상태를 확인할 수 없습니다. 다시 확인해 주세요.",
            )
          );
        if (result.user.mustChangePassword) {
          navigate(
            `/auth?mode=password-change&return_to=${encodeURIComponent(returnTo)}`,
            { replace: true },
          );
          return;
        }
        const destination = await recheckReturnDestination(
          returnTo,
          current,
          appsService,
          () => isCurrentObservation(current.observationId),
        );
        navigate(destination, { replace: true });
      } catch (error) {
        if (!confirmed) await restoreAuth();
        throw error;
      }
    },
    [beginAuthTransition, navigate, restoreAuth, isCurrentObservation],
  );

  const changePassword = useCallback(
    async (input, returnTo) => {
      await beginAuthTransition();
      let confirmed = false;
      try {
        const result = await authService.changePassword(input);
        const current = await restoreAuth();
        if (
          current?.status !== "ready" ||
          current.user?.id !== result.user.id ||
          current.user.sessionKind !== "full" ||
          current.user.mustChangePassword
        )
          throw (
            current?.error ??
            new ServiceError(
              "SERVICE_UNAVAILABLE",
              "비밀번호 변경 상태를 확인할 수 없습니다. 다시 확인해 주세요.",
            )
          );
        confirmed = true;
        const destination = await recheckReturnDestination(
          returnTo,
          current,
          appsService,
          () => isCurrentObservation(current.observationId),
        );
        navigate(destination, { replace: true });
        setToast("비밀번호를 변경했어요.");
      } catch (error) {
        if (!confirmed) await restoreAuth();
        throw error;
      }
    },
    [beginAuthTransition, navigate, restoreAuth, isCurrentObservation],
  );

  const reauthenticate = useCallback(
    async (input, returnTo) => {
      const previous = authSnapshot.current;
      const actor = previous.user;
      if (
        previous.status !== "ready" ||
        !actor ||
        actor.role !== "admin" ||
        !actor.approved ||
        actor.sessionKind !== "full" ||
        actor.mustChangePassword
      )
        throw new ServiceError(
          "FORBIDDEN",
          "현재 로그인한 관리자가 필요해요.",
          {
            httpStatus: 403,
            outcome: "rejected",
          },
        );
      // Own both the observation and the originating route entry.
      const starting = authObservation.current;
      const begin = beginAuthTransition();
      let owned = authObservation.current;
      const attempt = {
        actorId: actor.id,
        flowId: previous.flow.flowId,
        identityRevision: previous.flow.lastIdentityChangeRevision,
        sourceGeneration: previous.flow.sessionGeneration,
        transitionId: `${previous.flow.flowId}.${previous.flow.revision}`,
        locationKey: currentLocation.current.key,
        returnTo,
      };
      const owns = () =>
        isCurrentObservation(owned) &&
        pendingReauth.current === attempt &&
        currentLocation.current.key === attempt.locationKey;
      pendingReauth.current = attempt;
      await begin;
      if (!owns() || owned !== starting + 1) return;
      let confirmed = false;
      try {
        const result = await authService.reauthenticate(input);
        if (!owns()) return;
        const proof = await authService.getFlowState(attempt.transitionId);
        if (!owns()) return;
        const restoring = restoreAuth();
        owned = authObservation.current;
        const current = await restoring;
        if (!owns()) return;
        confirmed = true;
        const committed = proof.requestedTransition;
        if (
          committed?.availability !== "available" ||
          committed.kind !== "reauthenticate" ||
          committed.state !== "succeeded" ||
          current?.flow?.sessionGeneration !== committed.resultSessionGeneration
        ) {
          pendingReauth.current = null;
          return;
        }
        if (
          current?.status !== "ready" ||
          current.user?.id !== actor.id ||
          result.user.id !== actor.id ||
          current.user.role !== "admin" ||
          !current.user.approved ||
          current.user.sessionKind !== "full" ||
          current.user.mustChangePassword ||
          !current.user.recentAuthUntil ||
          current.flow.flowId !== previous.flow.flowId ||
          current.flow.revision === previous.flow.revision ||
          current.flow.sessionGeneration === previous.flow.sessionGeneration ||
          current.flow.lastIdentityChangeRevision !==
            previous.flow.lastIdentityChangeRevision
        )
          throw (
            current?.error ??
            new ServiceError(
              "AUTH_STATE_CHANGED",
              "관리자 인증 상태를 다시 확인해 주세요.",
            )
          );
        const destination = await recheckReturnDestination(
          returnTo,
          current,
          appsService,
          owns,
        );
        if (!owns()) return;
        pendingReauth.current = null;
        navigate(destination, { replace: true });
      } catch (error) {
        if (!owns()) return;
        if (
          !confirmed &&
          error instanceof ServiceError &&
          error.outcome === "unknown"
        ) {
          // Keep the original transition for explicit confirmation; never repeat the POST.
          setAuth({
            ...previous,
            status: "unresolved",
            error,
            concealed: false,
            observationId: owned,
            unresolvedTransitionId: attempt.transitionId,
          });
          throw error;
        }
        if (!confirmed) {
          const restoring = restoreAuth();
          owned = authObservation.current;
          await restoring;
          if (!owns()) return;
        }
        pendingReauth.current = null;
        throw error;
      }
    },
    [beginAuthTransition, navigate, restoreAuth, isCurrentObservation],
  );

  const logout = useCallback(async () => {
    if (logoutPending) return;
    setLogoutPending(true);
    pendingReauth.current = null;
    setAdminResume(null);
    setDeletion(null);
    try {
      await beginAuthTransition();
      await authService.logout();
      const current = await restoreAuth();
      if (current?.status === "ready" && !current.user)
        navigate("/", { replace: true });
    } catch {
      await restoreAuth();
      setToast("로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLogoutPending(false);
    }
  }, [beginAuthTransition, logoutPending, navigate, restoreAuth]);

  const resolveAuth = useCallback(async () => {
    const attempt = pendingReauth.current;
    let owned = authObservation.current;
    const owns = () =>
      isCurrentObservation(owned) &&
      (!attempt ||
        (pendingReauth.current === attempt &&
          currentLocation.current.key === attempt.locationKey));
    try {
      const transitionId =
        attempt?.transitionId ?? authSnapshot.current.unresolvedTransitionId;
      const flow = transitionId
        ? await authService.getFlowState(transitionId)
        : null;
      if (!owns()) return;
      const result = flow?.requestedTransition;
      if (__DATA_MODE__ === "api") await recoverApiAuth("settle");
      else if (transitionId && flow)
        await authService.settleTransition(transitionId, {
          flowId: flow.flowId,
          expectedRevision: flow.revision,
        });
      if (!owns()) return;
      const restoring = restoreAuth();
      owned = authObservation.current;
      const current = await restoring;
      if (!owns()) return;
      if (
        attempt &&
        result?.availability === "available" &&
        result.kind === "reauthenticate" &&
        result.state === "succeeded" &&
        current?.status === "ready" &&
        current.sessionCookiePresent &&
        current.user?.id === attempt.actorId &&
        current.user.role === "admin" &&
        current.user.approved &&
        current.user.sessionKind === "full" &&
        !current.user.mustChangePassword &&
        current.flow.flowId === attempt.flowId &&
        current.flow.lastIdentityChangeRevision === attempt.identityRevision &&
        current.flow.sessionGeneration === result.resultSessionGeneration &&
        current.flow.sessionGeneration !== attempt.sourceGeneration
      ) {
        const destination = await recheckReturnDestination(
          attempt.returnTo,
          current,
          appsService,
          owns,
        );
        if (!owns()) return;
        pendingReauth.current = null;
        navigate(destination, { replace: true });
      }
    } catch (error) {
      if (!owns()) return;
      setToast(error.message);
      await restoreAuth();
    }
  }, [restoreAuth, isCurrentObservation, navigate]);

  const discardMissingSession = useCallback(async () => {
    if (__DATA_MODE__ === "api") {
      try {
        await recoverApiAuth("discard");
      } catch (error) {
        setToast(error.message);
      }
      await restoreAuth();
      return;
    }
    try {
      const transitionId = authSnapshot.current.unresolvedTransitionId;
      if (!transitionId) throw new Error("No unresolved auth transition");
      const flow = await authService.getFlowState(transitionId);
      if (!flow.sessionGeneration || flow.sessionCookiePresent)
        throw new Error("No missing session to discard");
      await authService.discardSession(transitionId, {
        flowId: flow.flowId,
        expectedRevision: flow.revision,
        expectedSessionGeneration: flow.sessionGeneration,
      });
      setToast("받지 못한 세션을 초기화했어요.");
    } catch {
      setToast(
        "세션을 안전하게 초기화하지 못했어요. 인증 흐름을 초기화해 주세요.",
      );
    }
    await restoreAuth();
  }, [restoreAuth]);

  const resetAuth = useCallback(async () => {
    pendingReauth.current = null;
    setAdminResume(null);
    if (__DATA_MODE__ === "api") {
      try {
        await recoverApiAuth("reset");
      } catch (error) {
        setToast(error.message);
      }
      await restoreAuth();
      return;
    }
    try {
      const previousFlowId = authSnapshot.current.flow?.flowId;
      if (!previousFlowId) throw new Error("No auth flow to reset");
      const flow = await authService.getFlowState(
        authSnapshot.current.unresolvedTransitionId ?? undefined,
      );
      const eligibility = await authService.getRestartEligibility(flow.flowId);
      if (!eligibility.restartEligible) {
        if (!flow.recoveryReady && !flow.sessionCookiePresent)
          await authService.abandonFlow(flow.flowId);
        else
          await authService.resetFlow(flow.flowId, {
            expectedRevision: flow.revision,
            expectedSessionGeneration: flow.sessionGeneration,
          });
      }
      const created = await authService.createFlow({
        restartFrom: [flow.flowId],
      });
      const recovery = await authService.issueRecoveryCookie(created.flowId);
      const ready = await authService.confirmRecoveryCookie(created.flowId, {
        expectedRevision: recovery.revision,
      });
      const next = await authService.getFlowState();
      if (!next.nextTransitionId)
        throw new Error("Anonymous session unavailable");
      await authService.issueAnonymousSession({
        flowId: created.flowId,
        expectedRevision: ready.revision,
        transitionId: next.nextTransitionId,
      });
      setToast("인증 흐름을 다시 준비했어요.");
    } catch {
      setToast("인증 흐름을 다시 준비하지 못했어요. 결과를 확인해 주세요.");
    }
    await restoreAuth();
  }, [restoreAuth]);

  useLayoutEffect(() => {
    const reauthDeparted =
      pendingReauth.current &&
      pendingReauth.current.locationKey !== location.key;
    if (reauthDeparted) pendingReauth.current = null;
    const previous = previousAuthEntry.current;
    previousAuthEntry.current = {
      key: location.key,
      pathname: location.pathname,
      restoreAuth,
    };
    if (
      previous?.restoreAuth === restoreAuth &&
      previous.pathname === location.pathname &&
      (navigationType !== "POP" || previous.key === location.key)
    ) {
      // Recover the new entry even if reauth execution has not started a restore.
      if (reauthDeparted) void restoreAuth();
      return;
    }
    if (__DATA_MODE__ === "mock") {
      void restoreAuth();
      if (
        deletionBusy.current &&
        previous &&
        (previous.pathname !== location.pathname ||
          previous.key !== location.key)
      )
        activeDeletion.current?.navigationObservations.add(
          authObservation.current,
        );
      return;
    }
    if (!apiAuthEnabled) {
      setAuth((current) => ({
        ...current,
        status: "unavailable",
        user: null,
        concealed: false,
      }));
      return;
    }
    void restoreAuth();
    if (
      deletionBusy.current &&
      previous &&
      (previous.pathname !== location.pathname || previous.key !== location.key)
    )
      activeDeletion.current?.navigationObservations.add(
        authObservation.current,
      );
  }, [
    apiAuthEnabled,
    location.key,
    location.pathname,
    navigationType,
    restoreAuth,
  ]);
  useEffect(() => {
    const previous = previousLocation.current;
    const historyTraversal =
      navigationType === "POP" && previous.key !== location.key;
    previousLocation.current = {
      key: location.key,
      pathname: location.pathname,
      initial: false,
    };
    if (
      previous.initial ||
      (!historyTraversal && previous.pathname !== location.pathname)
    )
      window.scrollTo({ top: 0 });
  }, [location.key, location.pathname, navigationType]);
  useEffect(() => {
    const onStorage = (event) => {
      if (__DATA_MODE__ === "api" && event.key === "eduvibe-auth-flow-v1") {
        void beginAuthTransition().then(() => restoreAuth({ concealed: true }));
      }
      if (__DATA_MODE__ === "mock" && event.key === "eduvibe-archive-mock-v1") {
        reconcileMockReset(event.newValue);
        if (isMockHealthStorageUpdate(event.oldValue, event.newValue))
          onMockHealthUpdated();
        else void refreshMockState();
      }
    };
    const onMockReset = () => void refreshMockState();
    const onMockHealthUpdated = () => {
      void queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return (
            __DATA_MODE__ === "mock" &&
            key[0] === __DATA_MODE__ &&
            (key[1] === "health" ||
              (key[1] === "apps" && key[2] === "list") ||
              (key[1] === "admin" && (key[2] === "users" || key[2] === "apps")))
          );
        },
      });
    };
    const onMockAppDeleted = () => {
      void queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "apps", "list"],
      });
      void queryClient.invalidateQueries({
        queryKey: [__DATA_MODE__, "admin"],
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") concealOnDeparture();
      else restoreOnReturn();
    };
    window.addEventListener("eduvibe:mock-reset", onMockReset);
    window.addEventListener("eduvibe:mock-health-updated", onMockHealthUpdated);
    window.addEventListener("eduvibe:mock-app-deleted", onMockAppDeleted);
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", concealOnDeparture);
    window.addEventListener("focus", restoreOnReturn);
    const onPageShow = () => restoreOnReturn();
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.removeEventListener("eduvibe:mock-reset", onMockReset);
      window.removeEventListener(
        "eduvibe:mock-health-updated",
        onMockHealthUpdated,
      );
      window.removeEventListener("eduvibe:mock-app-deleted", onMockAppDeleted);
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", concealOnDeparture);
      window.removeEventListener("focus", restoreOnReturn);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [
    beginAuthTransition,
    concealOnDeparture,
    queryClient,
    refreshMockState,
    restoreAuth,
    restoreOnReturn,
  ]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (
      deletion &&
      auth.status === "ready" &&
      auth.user &&
      deletion.actorId !== auth.user.id
    )
      setDeletion(null);
  }, [auth.status, auth.user, deletion]);

  const resumeOwner = draftContinuityScope(auth);
  const ownedAdminResume =
    adminResume?.owner === resumeOwner ? adminResume.resume : null;
  useEffect(() => {
    const attempt = pendingReauth.current;
    if (
      auth.status === "ready" &&
      !auth.concealed &&
      attempt &&
      (auth.user?.id !== attempt.actorId ||
        auth.flow?.flowId !== attempt.flowId ||
        auth.flow?.lastIdentityChangeRevision !== attempt.identityRevision)
    )
      pendingReauth.current = null;
    if (
      auth.status === "ready" &&
      !auth.concealed &&
      adminResume &&
      adminResume.owner !== resumeOwner
    )
      setAdminResume(null);
  }, [
    auth.status,
    auth.concealed,
    auth.user,
    auth.flow,
    adminResume,
    resumeOwner,
  ]);

  const deletionNeedsConfirmation = [
    "pending",
    "unknown",
    "expired",
    "confirming",
  ].includes(deletion?.phase);
  useEffect(() => {
    if (!deletionNeedsConfirmation) return undefined;
    const warnBeforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [deletionNeedsConfirmation]);

  useEffect(() => {
    if (!deletionNeedsConfirmation) return undefined;
    const warnOnLink = (event) => {
      const link = event.target.closest?.("a[href]");
      if (
        !link ||
        link.origin !== window.location.origin ||
        link.pathname === location.pathname
      )
        return;
      if (
        !window.confirm(
          "삭제 결과가 아직 확정되지 않았어요. 이 화면을 떠날까요?",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    document.addEventListener("click", warnOnLink, true);
    return () => document.removeEventListener("click", warnOnLink, true);
  }, [deletionNeedsConfirmation, location.pathname]);

  const active =
    location.pathname === "/apps/new" ||
    /^\/apps\/[^/]+\/edit$/.test(location.pathname)
      ? auth.status === "ready" &&
        auth.user?.role === "admin" &&
        location.pathname.endsWith("/edit")
        ? "admin"
        : "submit"
      : location.pathname.startsWith("/apps/")
        ? "detail"
        : location.pathname === "/admin"
          ? "admin"
          : "gallery";
  return (
    <div className="min-h-screen">
      <Header
        active={active}
        auth={auth}
        access={authMetadata}
        onLogin={() => navigate("/auth?mode=login")}
        onLogout={logout}
        onRetryAuth={recheckAuth}
        logoutPending={logoutPending}
      />
      <Routes>
        <Route
          path="/"
          element={
            <GalleryRoute
              auth={auth}
              galleryReturnPosition={galleryReturnPosition}
            />
          }
        />
        <Route
          path="/apps/new"
          element={
            <SubmitRoute
              auth={auth}
              onRetryAuth={recheckAuth}
              onCreated={onAppCreated}
            />
          }
        />
        <Route
          path="/apps/:id/edit"
          element={
            <EditRoute
              auth={auth}
              isCurrentObservation={isCurrentObservation}
              isAppRetired={isAppRetired}
              onRetryAuth={recheckAuth}
              onSaved={onAppUpdated}
            />
          }
        />
        <Route
          path="/apps/:id"
          element={
            <DetailRoute
              auth={auth}
              isCurrentObservation={isCurrentObservation}
              onRetryAuth={recheckAuth}
              onDeleted={onAppDeleted}
              onDbDeleted={onDbDeleted}
              isAppRetired={isAppRetired}
              deletionState={deletion}
              setDeletionState={setDeletion}
              deletionBusy={deletionBusy}
              captureDeletionContext={captureDeletionContext}
              settleDeletion={settleDeletion}
            />
          }
        />
        <Route
          path="/auth"
          element={
            <AuthRoute
              location={location}
              auth={auth}
              onRetry={recheckAuth}
              onLogin={login}
              onChangePassword={changePassword}
              onReauthenticate={reauthenticate}
              onRegister={(input) => authService.register(input)}
              onResolveAuth={resolveAuth}
              onResetAuth={resetAuth}
              onDiscardMissingSession={discardMissingSession}
              meta={authMetadata.meta}
            />
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute
              auth={auth}
              onRetry={recheckAuth}
              meta={authMetadata.meta}
              resumeState={ownedAdminResume}
              onConsumeResume={consumeAdminResume}
              onSaveResume={saveAdminResume}
            />
          }
        />
        {__DATA_MODE__ === "mock" ? (
          <Route path="/__dev/mock-reset" element={<MockResetPage />} />
        ) : null}
        <Route path="*" element={<NotFoundRoute />} />
      </Routes>
      <Footer />
      <Toast message={toast} />
    </div>
  );
}
