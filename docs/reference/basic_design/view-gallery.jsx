// 갤러리 뷰 — 액자형 반응형 그리드 + 필터
function GalleryView({ apps, user, onOpen, onSubmit }) {
  const [subject, setSubject] = React.useState('전체');
  const [grade, setGrade] = React.useState('전체');
  const [q, setQ] = React.useState('');

  const visible = apps.filter((a) => a.isPublic || (user && (user.id === a.owner || user.role === 'admin')));
  const filtered = visible.filter((a) =>
    (subject === '전체' || a.subject === subject) &&
    (grade === '전체' || a.grades.includes(grade)) &&
    (!q.trim() || (a.name + a.owner + a.description).toLowerCase().includes(q.trim().toLowerCase()))
  );

  const subjectsInUse = ['전체', ...SUBJECTS.filter((s) => visible.some((a) => a.subject === s))];

  return (
    <div className="mx-auto w-full max-w-[1280px] px-5 pb-24 sm:px-8" data-screen-label="갤러리">
      {/* 히어로 */}
      <section className="flex flex-col items-start gap-5 pb-8 pt-12 sm:pt-16">
        <span className="acc-text text-[11.5px] font-bold uppercase tracking-[0.22em]">Teachers&rsquo; Vibe Coding Archive</span>
        <h1 className="max-w-2xl break-keep text-[34px] font-extrabold leading-[1.15] tracking-tight text-neutral-900 sm:text-[44px]" style={{ textWrap: 'balance' }}>
          수업을 바꾼 앱과<br className="sm:hidden" /> 그 앱을 만든 <span className="acc-text">프롬프트</span>까지.
        </h1>
        <p className="max-w-xl break-keep text-[14.5px] leading-relaxed text-neutral-500" style={{ textWrap: 'pretty' }}>
          AI로 만든 교육용 웹 앱을 프롬프트와 함께 공유해요. 마음에 드는 앱은 프롬프트를 복사해 우리 반에 맞게 다시 만들 수 있어요.
        </p>
        {user ? <Btn onClick={onSubmit}><span>내 앱 등록하기</span></Btn> : null}
      </section>

      {/* 필터 바 */}
      <div className="sticky top-[57px] z-20 -mx-5 mb-7 border-y border-neutral-200/70 bg-[#EAE7E2]/88 px-5 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {subjectsInUse.map((s) => (
              <button key={s} onClick={() => setSubject(s)} className={'h-8 rounded-full px-3.5 text-[12.5px] font-semibold transition-all ' + (subject === s ? 'acc-bg text-white shadow-sm' : 'bg-white text-neutral-600 border border-neutral-200 hover:border-neutral-300')}>{s}</button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <select value={grade} onChange={(e) => setGrade(e.target.value)} className="h-8 rounded-full border border-neutral-200 bg-white pl-3 pr-7 text-[12.5px] font-semibold text-neutral-600 outline-none">
              <option value="전체">학년 전체</option>
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <div className="relative">
              <LR.Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="앱·작성자 검색" className="h-8 w-36 rounded-full border border-neutral-200 bg-white pl-8 pr-3 text-[12.5px] outline-none transition-all focus:w-48 focus:border-[#4C7A96]/40 sm:w-44" />
            </div>
          </div>
        </div>
      </div>

      {/* 그리드 */}
      {filtered.length ? (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((a) => <AppCard key={a.id} app={a} onOpen={() => onOpen(a.id)} />)}
        </div>
      ) : (
        <EmptyState icon={LR.SearchX} title="조건에 맞는 앱이 없어요" desc="다른 과목이나 학년으로 바꿔 보거나, 검색어를 지워 보세요." />
      )}
    </div>
  );
}

Object.assign(window, { GalleryView });
