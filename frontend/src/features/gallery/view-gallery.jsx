import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { AppCard, Btn, EmptyState } from "../../components/ui";
import { ServiceError } from "../../services/service-error";
import { isSearchTooLong } from "../../services/apps-service";

export function GalleryView({
  meta,
  page,
  canCreate = false,
  onCreate,
  onQueryChange,
  initialFilters = {},
  detailLinkState,
  onDetailClick,
  error,
  loading,
  retry,
  resetQuery,
  loadMore,
  loadingMore,
  nextPageError,
  hasNextPage,
  duplicateOnlyPage,
}) {
  const initialSearch = initialFilters.q ?? "";
  const subject = initialFilters.subject ?? "";
  const grade = initialFilters.grade ?? "";
  const hasAppliedConditions = Boolean(initialSearch || subject || grade);
  const [search, setSearch] = useState(initialSearch);
  const [composing, setComposing] = useState(false);
  const [subjectsInUse, setSubjectsInUse] = useState(
    page?.facets.subjectsInUse ?? [],
  );
  const [focusOnRetry, setFocusOnRetry] = useState(false);
  const lastRouteSearch = useRef(initialSearch);
  const routeSearchPending = useRef(false);
  const mainRef = useRef(null);
  const searchRef = useRef(null);
  const loadMoreRegionRef = useRef(null);
  const loadMoreLocked = useRef(false);
  const startLoadMore = useCallback(() => {
    if (!loadMore || loadMoreLocked.current) return;
    loadMoreLocked.current = true;
    void Promise.resolve(loadMore()).finally(() => {
      loadMoreLocked.current = false;
    });
  }, [loadMore]);
  const searchTooLong = !composing && isSearchTooLong(search);
  const visibleSubjects = subjectsInUse.includes(subject)
    ? subjectsInUse
    : subject
      ? [...subjectsInUse, subject]
      : subjectsInUse;
  const resetRoute =
    error instanceof ServiceError && error.code === "MOCK_STORAGE_ERROR";
  const invalidQuery =
    error instanceof ServiceError && error.code === "VALIDATION_ERROR";
  const fieldErrors =
    invalidQuery && !searchTooLong && !loading ? (error.fields ?? {}) : {};
  const queryError = fieldErrors.q;
  const gradeError = fieldErrors.grade;

  useLayoutEffect(() => {
    if (lastRouteSearch.current === initialSearch) return;
    lastRouteSearch.current = initialSearch;
    routeSearchPending.current = true;
    setSearch(initialSearch);
  }, [initialSearch]);
  useEffect(() => {
    if (page) setSubjectsInUse(page.facets.subjectsInUse);
  }, [page]);
  useEffect(() => {
    if (routeSearchPending.current) {
      routeSearchPending.current = false;
      return undefined;
    }
    if (composing || searchTooLong) return undefined;
    const q = search.trim().normalize("NFC") || undefined;
    if ((q ?? "") === initialSearch) return undefined;
    if (!q) {
      onQueryChange({ q }, { replace: true });
      return undefined;
    }
    const timer = window.setTimeout(
      () => onQueryChange({ q }, { replace: true }),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [composing, initialSearch, onQueryChange, search, searchTooLong]);
  useEffect(() => {
    if (focusOnRetry && loading) {
      mainRef.current?.focus({ preventScroll: true });
      setFocusOnRetry(false);
    }
  }, [focusOnRetry, loading]);
  useEffect(() => {
    if (
      !hasNextPage ||
      loadingMore ||
      nextPageError ||
      duplicateOnlyPage ||
      typeof IntersectionObserver === "undefined"
    )
      return undefined;
    const region = loadMoreRegionRef.current;
    if (!region) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) startLoadMore();
      },
      { rootMargin: "300px" },
    );
    observer.observe(region);
    return () => observer.disconnect();
  }, [
    duplicateOnlyPage,
    hasNextPage,
    loadingMore,
    loadMore,
    nextPageError,
    startLoadMore,
  ]);
  const handleRetry = () => {
    setFocusOnRetry(true);
    retry();
  };
  const handleResetQuery = () => {
    setSearch("");
    setComposing(false);
    resetQuery();
    searchRef.current?.focus({ preventScroll: true });
  };
  const changeSearch = (value) => {
    setSearch(value);
    if (!value) onQueryChange({ q: undefined }, { replace: true });
  };

  return (
    <main
      ref={mainRef}
      tabIndex={-1}
      className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8"
      data-screen-label="갤러리"
    >
      <section className="flex flex-col items-start gap-5 pb-8 pt-12 sm:pt-16">
        <div className="flex w-full flex-col items-start gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col items-start gap-5">
            <span className="acc-text text-[11.5px] font-bold uppercase tracking-[0.22em]">
              Teachers&rsquo; Vibe Coding Archive
            </span>
            <h1
              className="max-w-2xl break-keep text-[34px] font-extrabold leading-[1.15] tracking-tight text-neutral-900 sm:text-[44px]"
              style={{ textWrap: "balance" }}
            >
              수업을 바꾼 앱과
              <br className="sm:hidden" /> 그 앱을 만든{" "}
              <span className="acc-text">프롬프트</span>까지.
            </h1>
            <p
              className="max-w-xl break-keep text-[14.5px] leading-relaxed text-neutral-500"
              style={{ textWrap: "pretty" }}
            >
              AI로 만든 교육용 웹 앱을 프롬프트와 함께 공유해요. 마음에 드는
              앱은 프롬프트를 복사해 우리 반에 맞게 다시 만들 수 있어요.
            </p>
          </div>
          {canCreate ? (
            <Btn onClick={onCreate} className="shrink-0">
              내 앱 등록하기
            </Btn>
          ) : null}
        </div>
      </section>

      <div className="sticky top-[57px] z-20 -mx-5 mb-7 border-y border-neutral-200/70 bg-[#EAE7E2]/88 px-5 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            className="flex flex-wrap items-center gap-1.5"
            aria-label="과목 필터"
          >
            {["", ...visibleSubjects].map((value) => {
              const label = value || "전체";
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={subject === value}
                  onClick={() =>
                    onQueryChange(
                      { subject: value || undefined },
                      { replace: false },
                    )
                  }
                  className={`h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-all ${subject === value ? "acc-bg text-white shadow-sm" : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <label className="sr-only" htmlFor="grade-filter">
              학년 필터
            </label>
            <select
              id="grade-filter"
              value={grade}
              aria-invalid={gradeError ? true : undefined}
              aria-describedby={
                gradeError ? "gallery-grade-filter-error" : undefined
              }
              onChange={(event) =>
                onQueryChange(
                  { grade: event.target.value || undefined },
                  { replace: false },
                )
              }
              className="h-8 rounded-full border border-neutral-200 bg-white pl-3 pr-7 text-[12.5px] font-semibold text-neutral-600 outline-none focus-visible:ring-2 focus-visible:ring-[#4C7A96]"
            >
              <option value="">학년 전체</option>
              {(meta?.grades ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
                <Search size={13} aria-hidden="true" />
              </span>
              <label className="sr-only" htmlFor="gallery-search">
                앱·작성자 검색
              </label>
              <input
                ref={searchRef}
                id="gallery-search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={(event) => {
                  setComposing(false);
                  setSearch(event.currentTarget.value);
                  if (!event.currentTarget.value)
                    onQueryChange({ q: undefined }, { replace: true });
                }}
                aria-invalid={searchTooLong || queryError ? true : undefined}
                aria-describedby={
                  [
                    searchTooLong && "gallery-search-error",
                    queryError && "gallery-search-validation-error",
                  ]
                    .filter(Boolean)
                    .join(" ") || undefined
                }
                placeholder="앱·작성자 검색"
                className="h-8 w-36 rounded-full border border-neutral-200 bg-white pl-8 pr-3 text-[12.5px] outline-none transition-all focus:w-48 focus:border-[#4C7A96]/40 sm:w-44"
              />
              {searchTooLong ? (
                <span id="gallery-search-error" className="sr-only">
                  검색어는 정규화 후 100자 이하여야 해요.
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {searchTooLong ? (
        <div role="alert" aria-live="assertive">
          <EmptyState
            title="검색어가 너무 길어요"
            desc="검색어는 정규화 후 100자 이하여야 해요. 입력 내용은 유지됩니다."
          />
        </div>
      ) : loading ? (
        <div role="status" aria-live="polite">
          <EmptyState
            title="공개 아카이브를 불러오는 중이에요"
            desc="잠시만 기다려 주세요."
          />
        </div>
      ) : error ? (
        <div role="alert" aria-live="assertive">
          <EmptyState
            title={
              invalidQuery
                ? "검색 조건을 확인할 수 없어요"
                : "공개 아카이브를 불러오지 못했어요"
            }
            desc={error.message || "잠시 후 다시 시도해 주세요."}
          >
            <div className="flex flex-col items-center gap-3">
              {Object.entries(fieldErrors).map(([field, message]) => (
                <p
                  key={field}
                  id={
                    field === "q"
                      ? "gallery-search-validation-error"
                      : field === "grade"
                        ? "gallery-grade-filter-error"
                        : undefined
                  }
                  className="text-[13px] text-red-700"
                >
                  {message}
                </p>
              ))}
              <div className="flex flex-wrap justify-center gap-2">
                {invalidQuery ? (
                  <Btn onClick={handleResetQuery}>조건 초기화</Btn>
                ) : (
                  <Btn onClick={handleRetry}>다시 시도</Btn>
                )}
                {!invalidQuery && __DATA_MODE__ === "mock" && resetRoute ? (
                  <Link
                    className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
                    to="/__dev/mock-reset"
                  >
                    mock 저장 초기화
                  </Link>
                ) : null}
              </div>
            </div>
          </EmptyState>
        </div>
      ) : (page?.items.length ?? 0) > 0 ? (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {page?.items.map((app) => {
              const theme = meta.themes.find((item) => item.id === app.themeId);
              return theme ? (
                <AppCard
                  key={app.id}
                  app={app}
                  theme={theme}
                  detailLinkState={detailLinkState}
                  onDetailClick={onDetailClick}
                />
              ) : null;
            })}
          </div>
          {nextPageError ? (
            <div
              className="mt-8 flex flex-col items-center gap-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-[13px] text-neutral-600">
                추가 자료를 불러오지 못했어요. 기존 목록은 유지됩니다.
              </p>
              <Btn onClick={startLoadMore}>다시 시도</Btn>
            </div>
          ) : hasNextPage ? (
            <div
              ref={loadMoreRegionRef}
              className="mt-8 flex justify-center"
              aria-live="polite"
            >
              <Btn onClick={startLoadMore} disabled={loadingMore}>
                {loadingMore
                  ? "불러오는 중이에요"
                  : duplicateOnlyPage
                    ? "계속 불러오기"
                    : "더 불러오기"}
              </Btn>
            </div>
          ) : null}
        </>
      ) : !hasAppliedConditions ? (
        <EmptyState
          title="아직 공개된 앱이 없어요"
          desc="앱이 공개되면 여기에 표시돼요."
        />
      ) : (
        <EmptyState
          title="조건에 맞는 앱이 없어요"
          desc="다른 과목이나 학년으로 바꿔 보거나, 검색어를 지워 보세요."
        >
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-xs text-[13px] leading-relaxed text-neutral-600 [overflow-wrap:anywhere]">
              검색어: {initialSearch ? `“${initialSearch}”` : "없음"} · 과목:{" "}
              {subject || "전체"} · 학년: {grade || "전체"}
            </p>
            <Btn onClick={handleResetQuery}>조건 초기화</Btn>
          </div>
        </EmptyState>
      )}
    </main>
  );
}
