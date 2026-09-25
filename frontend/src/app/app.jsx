import { useCallback, useEffect, useRef, useState } from "react";
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
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import catalog from "../../../contracts/catalog.json";
import { appsService } from "@services/apps";
import { authService } from "@services/auth";
import { normalizeSearch } from "../services/apps-service";
import MockResetPage from "@services/mock-reset";
import { contractError, ServiceError } from "../services/service-error";
import { AppDetailView } from "../features/detail/view-detail";
import { GalleryView } from "../features/gallery/view-gallery";
import { Avatar, Btn, EmptyState } from "../components/ui";
import { AuthView } from "../features/auth/view-auth";
import { readAuthRoute } from "../features/auth/auth-route";

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
      const folded = normalizeSearch(value);
      if (folded && Array.from(folded).length > 100)
        return { filters: {}, invalid: true };
      if (normalized) values.q = normalized;
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

function Header({ active, auth, onLogin, onLogout, logoutPending }) {
  const navButton = (isActive) =>
    `h-9 rounded-full px-4 text-[13px] font-semibold transition-all ${isActive ? "bg-neutral-900/[0.06] text-neutral-900" : "text-neutral-500 hover:bg-neutral-900/[0.04] hover:text-neutral-900"}`;
  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200/70 bg-white/75 backdrop-blur-xl">
      <div className="mx-auto flex h-[57px] w-full max-w-[1280px] items-center gap-2 px-5 sm:px-8">
        <Link
          to="/"
          className="flex items-center gap-2.5"
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
          {auth.user?.role === "admin" ? (
            <Link
              to="/admin"
              aria-current={active === "admin" ? "page" : undefined}
              className={`inline-flex items-center justify-center ${navButton(active === "admin")}`}
            >
              관리자
            </Link>
          ) : null}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {auth.status === "checking" ? (
            <span className="text-[12px] text-neutral-500" role="status">
              로그인 상태 확인 중
            </span>
          ) : auth.user ? (
            <>
              <span className="inline-flex max-w-[145px] items-center gap-1.5 truncate text-[11.5px] font-semibold text-neutral-700 sm:gap-2 sm:text-[13px]">
                <Avatar name={auth.user.nickname} size={28} />
                <span className="truncate">{auth.user.nickname}</span>
              </span>
              <Btn
                size="sm"
                variant="line"
                onClick={onLogout}
                disabled={logoutPending}
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
    loading: query.isPending,
    error: query.error ?? unavailable,
    retry(refetch) {
      void (query.isError || !canRead ? query.refetch() : refetch());
    },
  };
}

function authCacheScope(auth) {
  return [
    __DATA_MODE__,
    auth.user?.id ?? "anonymous",
    auth.user?.sessionKind ?? "anonymous",
    auth.user?.role ?? null,
    auth.epoch,
  ];
}

function GalleryRoute({ auth }) {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const query = readGalleryFilters(location.search);
  const filters = query.filters;
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
  const resetQuery = useCallback(
    () => setSearchParams(new URLSearchParams(), { replace: true }),
    [setSearchParams],
  );
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
      ...authCacheScope(auth),
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
    enabled: access.canRead && !query.invalid,
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
      onQueryChange={onQueryChange}
      initialFilters={filters}
      detailLinkState={{ fromGallery: true }}
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
          (access.canRead && (list.isPending || list.isRefetching)))
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

function DetailRoute({ auth, onRetryAuth }) {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const access = usePublicMetadata();
  const authPending = __DATA_MODE__ === "mock" && auth.status === "checking";
  const authError = __DATA_MODE__ === "mock" && auth.status === "error";
  const detail = useQuery({
    queryKey: [...authCacheScope(auth), "apps", "detail", id],
    enabled:
      access.canRead && (__DATA_MODE__ !== "mock" || auth.status === "ready"),
    queryFn: async ({ signal }) => {
      const app = await appsService.get(id, { signal });
      if (
        !app.isPublic &&
        __DATA_MODE__ === "mock" &&
        (!auth.user ||
          (auth.user.role !== "admin" && app.ownerId !== auth.user.id))
      )
        throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
          outcome: "rejected",
          httpStatus: 404,
        });
      assertThemeIds(access.meta, [app]);
      return app;
    },
  });
  const app = detail.data;
  return (
    <AppDetailView
      app={app}
      meta={access.meta}
      loading={
        authPending ||
        access.loading ||
        (access.canRead && !authError && detail.isPending)
      }
      error={authError ? auth.error : (access.error ?? detail.error)}
      retry={authError ? onRetryAuth : () => access.retry(detail.refetch)}
      onBack={() => navigate(location.state?.fromGallery === true ? -1 : "/")}
    />
  );
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

function AuthRoute({ location, auth, onRetry, onLogin }) {
  const route = readAuthRoute(location.search);
  return (
    <AuthView
      mode={route.mode}
      routeError={route.invalid}
      authStatus={auth.status}
      authError={auth.error}
      onRetry={onRetry}
      onLogin={(input) => onLogin(input, route.returnTo)}
    />
  );
}

function AdminRoute({ auth, onRetry }) {
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
  if (auth.user.role !== "admin")
    return (
      <main className="mx-auto w-full max-w-[760px] px-5 py-16 sm:px-8">
        <div role="alert" aria-live="assertive">
          <EmptyState title="관리자 권한이 필요해요" />
        </div>
      </main>
    );
  return (
    <main className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-12 sm:px-8">
      <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
        관리자
      </h1>
      <p className="mt-2 text-[14px] text-neutral-500">
        관리자 작업은 아직 제공하지 않아요.
      </p>
    </main>
  );
}

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const previousLocation = useRef({
    key: location.key,
    pathname: location.pathname,
    initial: true,
  });
  const queryClient = useQueryClient();
  const [toast, setToast] = useState("");
  const authRequest = useRef(0);
  const authEpoch = useRef(0);
  const [auth, setAuth] = useState({
    status: "checking",
    user: null,
    error: null,
    epoch: 0,
  });
  const [logoutPending, setLogoutPending] = useState(false);

  const clearMemberQueries = useCallback(async () => {
    const isMemberQuery = (query) =>
      query.queryKey[0] === __DATA_MODE__ && query.queryKey[1] !== "meta";
    await queryClient.cancelQueries({ predicate: isMemberQuery });
    queryClient.removeQueries({ predicate: isMemberQuery });
  }, [queryClient]);

  const restoreAuth = useCallback(async () => {
    const request = ++authRequest.current;
    const epoch = ++authEpoch.current;
    setAuth({ status: "checking", user: null, error: null, epoch });
    await clearMemberQueries();
    if (request !== authRequest.current) return;
    try {
      const user = await authService.getMe();
      if (request === authRequest.current)
        setAuth({ status: "ready", user, error: null, epoch });
    } catch (error) {
      if (request !== authRequest.current) return;
      if (error instanceof ServiceError && error.code === "AUTH_REQUIRED")
        setAuth({ status: "ready", user: null, error: null, epoch });
      else setAuth({ status: "error", user: null, error, epoch });
    }
  }, [clearMemberQueries]);

  const updateAuth = useCallback(
    async (user) => {
      ++authRequest.current;
      const epoch = ++authEpoch.current;
      await clearMemberQueries();
      setAuth({ status: "ready", user, error: null, epoch });
    },
    [clearMemberQueries],
  );

  const login = useCallback(
    async (input, returnTo) => {
      const result = await authService.login(input);
      await updateAuth(result.user);
      const appMatch = returnTo.match(/^\/apps\/([0-9a-f-]+)$/i);
      if (appMatch) {
        try {
          await appsService.get(appMatch[1]);
        } catch {
          // The destination route repeats this check and renders its safe error state.
        }
      }
      navigate(returnTo, { replace: true });
    },
    [navigate, updateAuth],
  );

  const logout = useCallback(async () => {
    if (logoutPending) return;
    setLogoutPending(true);
    try {
      await clearMemberQueries();
      await authService.logout();
      await updateAuth(null);
      navigate("/", { replace: true });
    } catch {
      await restoreAuth();
      setToast("로그아웃하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      setLogoutPending(false);
    }
  }, [clearMemberQueries, logoutPending, navigate, restoreAuth, updateAuth]);

  useEffect(() => {
    void restoreAuth();
  }, [restoreAuth]);
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
    const refreshQueries = (event) => {
      if (__DATA_MODE__ === "mock" && event.key === "eduvibe-archive-mock-v1")
        void restoreAuth();
    };
    window.addEventListener("eduvibe:mock-reset", restoreAuth);
    window.addEventListener("storage", refreshQueries);
    return () => {
      window.removeEventListener("eduvibe:mock-reset", restoreAuth);
      window.removeEventListener("storage", refreshQueries);
    };
  }, [restoreAuth]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const active = location.pathname.startsWith("/apps/")
    ? "detail"
    : location.pathname === "/admin"
      ? "admin"
      : "gallery";
  return (
    <div className="min-h-screen">
      <Header
        active={active}
        auth={auth}
        onLogin={() => navigate("/auth?mode=login")}
        onLogout={logout}
        logoutPending={logoutPending}
      />
      <Routes>
        <Route path="/" element={<GalleryRoute auth={auth} />} />
        <Route
          path="/apps/:id"
          element={<DetailRoute auth={auth} onRetryAuth={restoreAuth} />}
        />
        <Route
          path="/auth"
          element={
            <AuthRoute
              location={location}
              auth={auth}
              onRetry={restoreAuth}
              onLogin={login}
            />
          }
        />
        <Route
          path="/admin"
          element={<AdminRoute auth={auth} onRetry={restoreAuth} />}
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
