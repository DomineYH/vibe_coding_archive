import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Link } from "react-router-dom";
import { AppCard, Btn, EmptyState } from "../../components/ui";
import { ServiceError } from "../../services/service-error";

export function GalleryView({
  meta,
  page,
  onQueryChange,
  error,
  loading,
  retry,
}) {
  const [subject, setSubject] = useState("");
  const [grade, setGrade] = useState("");
  const [search, setSearch] = useState("");
  const [committedSearch, setCommittedSearch] = useState("");
  const [composing, setComposing] = useState(false);

  const changeSearch = (value) => {
    setSearch(value);
    if (!composing) setCommittedSearch(value);
  };
  const resetRoute =
    error instanceof ServiceError && error.code === "MOCK_STORAGE_ERROR";

  useEffect(() => {
    onQueryChange({
      q: committedSearch || undefined,
      subject: subject || undefined,
      grade: grade || undefined,
    });
  }, [committedSearch, grade, onQueryChange, subject]);

  return (
    <main
      className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8"
      data-screen-label="갤러리"
    >
      <section className="flex flex-col items-start gap-5 pb-8 pt-12 sm:pt-16">
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
          AI로 만든 교육용 웹 앱을 프롬프트와 함께 공유해요. 마음에 드는 앱은
          프롬프트를 복사해 우리 반에 맞게 다시 만들 수 있어요.
        </p>
      </section>

      <div className="sticky top-[57px] z-20 -mx-5 mb-7 border-y border-neutral-200/70 bg-[#EAE7E2]/88 px-5 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div
            role="group"
            className="flex flex-wrap items-center gap-1.5"
            aria-label="과목 필터"
          >
            {["", ...(page?.facets.subjectsInUse ?? [])].map((value) => {
              const label = value || "전체";
              return (
                <button
                  key={label}
                  type="button"
                  aria-pressed={subject === value}
                  onClick={() => setSubject(value)}
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
              onChange={(event) => setGrade(event.target.value)}
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
                id="gallery-search"
                value={search}
                onChange={(event) => changeSearch(event.target.value)}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={(event) => {
                  setComposing(false);
                  setSearch(event.currentTarget.value);
                  setCommittedSearch(event.currentTarget.value);
                }}
                placeholder="앱·작성자 검색"
                className="h-8 w-36 rounded-full border border-neutral-200 bg-white pl-8 pr-3 text-[12.5px] outline-none transition-all focus:w-48 focus:border-[#4C7A96]/40 sm:w-44"
              />
            </div>
          </div>
        </div>
      </div>

      {loading ? (
        <div role="status" aria-live="polite">
          <EmptyState
            title="공개 아카이브를 불러오는 중이에요"
            desc="잠시만 기다려 주세요."
          />
        </div>
      ) : error ? (
        <div role="alert" aria-live="assertive">
          <EmptyState
            title="공개 아카이브를 불러오지 못했어요"
            desc={error.message || "잠시 후 다시 시도해 주세요."}
          >
            <div className="flex flex-wrap justify-center gap-2">
              <Btn onClick={retry}>다시 시도</Btn>
              {__DATA_MODE__ === "mock" && resetRoute ? (
                <Link
                  className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
                  to="/__dev/mock-reset"
                >
                  mock 저장 초기화
                </Link>
              ) : null}
            </div>
          </EmptyState>
        </div>
      ) : (page?.items.length ?? 0) > 0 ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {page?.items.map((app) => {
            const theme = meta.themes.find((item) => item.id === app.themeId);
            return theme ? (
              <AppCard key={app.id} app={app} theme={theme} />
            ) : null;
          })}
        </div>
      ) : (
        <EmptyState
          title="조건에 맞는 앱이 없어요"
          desc="다른 과목이나 학년으로 바꿔 보거나, 검색어를 지워 보세요."
        />
      )}
    </main>
  );
}
