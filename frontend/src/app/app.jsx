import { useCallback, useEffect, useRef, useState } from "react";
import {
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import catalog from "../../../contracts/catalog.json";
import { appsService } from "@services/apps";
import MockResetPage from "@services/mock-reset";
import { contractError, ServiceError } from "../services/service-error";
import { AppDetailView } from "../features/detail/view-detail";
import { GalleryView } from "../features/gallery/view-gallery";
import { Btn, EmptyState } from "../components/ui";

const galleryQueryKeys = new Set(["q", "subject", "grade"]);

function readGalleryFilters(search) {
  if (!search) return { filters: {}, invalid: false };
  const values = {};
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
    if (!galleryQueryKeys.has(key) || Object.hasOwn(values, key) || !value)
      return { filters: {}, invalid: true };
    values[key] = value;
  }
  if (
    (values.q && values.q.trim().length > 100) ||
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

function Header({ active, onLogin }) {
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
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Btn size="sm" variant="primary" onClick={onLogin}>
            로그인
          </Btn>
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

function GalleryRoute() {
  const location = useLocation();
  const [, setSearchParams] = useSearchParams();
  const query = readGalleryFilters(location.search);
  const filters = query.filters;
  const access = usePublicMetadata();
  const onQueryChange = useCallback(
    (next) => {
      if (query.invalid) return;
      const params = new URLSearchParams();
      if (next.q) params.set("q", next.q);
      if (next.subject) params.set("subject", next.subject);
      if (next.grade) params.set("grade", next.grade);
      if (params.toString() !== location.search.slice(1))
        setSearchParams(params, { replace: true });
    },
    [location.search, query.invalid, setSearchParams],
  );
  const resetQuery = useCallback(
    () => setSearchParams(new URLSearchParams(), { replace: true }),
    [setSearchParams],
  );
  const list = useQuery({
    queryKey: [
      __DATA_MODE__,
      "anonymous",
      "anonymous",
      null,
      0,
      "apps",
      "list",
      filters.q ?? "",
      filters.subject ?? null,
      filters.grade ?? null,
      24,
    ],
    enabled: access.canRead && !query.invalid,
    queryFn: async ({ signal }) => {
      const page = await appsService.list(
        { ...filters, limit: 24, offset: 0 },
        { signal },
      );
      assertThemeIds(access.meta, page.items);
      return page;
    },
  });
  return (
    <GalleryView
      meta={access.meta}
      page={list.data}
      onQueryChange={onQueryChange}
      initialFilters={filters}
      detailLinkState={{ fromGallery: true }}
      error={
        query.invalid
          ? new ServiceError(
              "VALIDATION_ERROR",
              "검색 조건을 확인할 수 없어요.",
            )
          : (access.error ?? list.error)
      }
      loading={
        !query.invalid && (access.loading || (access.canRead && list.isPending))
      }
      retry={() => access.retry(list.refetch)}
      resetQuery={resetQuery}
    />
  );
}

function DetailRoute() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const access = usePublicMetadata();
  const detail = useQuery({
    queryKey: [
      __DATA_MODE__,
      "anonymous",
      "anonymous",
      null,
      0,
      "apps",
      "detail",
      id,
    ],
    enabled: access.canRead,
    queryFn: async ({ signal }) => {
      const app = await appsService.get(id, { signal });
      if (!app.isPublic)
        throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
          outcome: "rejected",
          httpStatus: 404,
        });
      assertThemeIds(access.meta, [app]);
      return app;
    },
  });
  const app = detail.data?.isPublic ? detail.data : undefined;
  return (
    <AppDetailView
      app={app}
      meta={access.meta}
      loading={access.loading || (access.canRead && detail.isPending)}
      error={access.error ?? detail.error}
      retry={() => access.retry(detail.refetch)}
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

export default function App() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(location.pathname);
  const queryClient = useQueryClient();
  const [toast, setToast] = useState("");
  useEffect(() => {
    const historyTraversal =
      navigationType === "POP" && previousPath.current !== location.pathname;
    previousPath.current = location.pathname;
    if (!historyTraversal) window.scrollTo({ top: 0 });
  }, [location.pathname, navigationType]);
  useEffect(() => {
    const clearQueries = () => queryClient.clear();
    const refreshQueries = (event) => {
      if (__DATA_MODE__ === "mock" && event.key === "eduvibe-archive-mock-v1")
        void queryClient.invalidateQueries();
    };
    window.addEventListener("eduvibe:mock-reset", clearQueries);
    window.addEventListener("storage", refreshQueries);
    return () => {
      window.removeEventListener("eduvibe:mock-reset", clearQueries);
      window.removeEventListener("storage", refreshQueries);
    };
  }, [queryClient]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const active = location.pathname.startsWith("/apps/") ? "detail" : "gallery";
  return (
    <div className="min-h-screen">
      <Header
        active={active}
        onLogin={() => setToast("Phase 1에서는 공개 갤러리를 제공합니다.")}
      />
      <Routes>
        <Route path="/" element={<GalleryRoute />} />
        <Route path="/apps/:id" element={<DetailRoute />} />
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
