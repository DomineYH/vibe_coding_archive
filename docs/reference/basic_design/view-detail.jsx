// 상세 보기 뷰
function DetailView({ app, user, onBack, onEdit, onDelete, onPing }) {
  const [confirm, setConfirm] = React.useState(false);
  React.useEffect(() => setConfirm(false), [app && app.id]);
  if (!app) return null;
  const meta = STATUS_META[app.status] || STATUS_META[200];
  const mine = user && (user.id === app.owner || user.role === 'admin');
  const isAdmin = !!user && user.role === 'admin';

  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 pb-24 pt-8 sm:px-8" data-screen-label={'상세: ' + app.name}>
      <div className="mb-6 flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold text-neutral-500 transition-colors hover:bg-neutral-200/60 hover:text-neutral-800">
          <LR.ChevronLeft size={15} /><span>갤러리로</span>
        </button>
        {mine ? (
          <div className="flex items-center gap-2">
            <Btn variant="line" size="sm" onClick={onEdit}><LR.Pencil size={13} /><span>편집</span></Btn>
            <button onClick={() => setConfirm(true)} className="inline-flex h-8 items-center rounded-full border border-neutral-300 bg-white px-3.5 text-[12.5px] font-semibold text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700">삭제</button>
          </div>
        ) : null}
      </div>

      {confirm ? (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-5 py-4">
          <div className="min-w-[220px] flex-1">
            <div className="break-keep text-[13.5px] font-bold text-red-700">‘{app.name}’{objJosa(app.name)} 아카이브에서 삭제할까요?</div>
            <p className="mt-0.5 break-keep text-[12px] leading-relaxed text-red-600/90">프롬프트와 활용 매뉴얼이 함께 삭제되며 되돌릴 수 없습니다.</p>
          </div>
          <Btn size="sm" variant="danger" onClick={() => onDelete(app.id)}>삭제 확인</Btn>
          <Btn size="sm" variant="ghost" onClick={() => setConfirm(false)}>취소</Btn>
        </div>
      ) : null}

      {/* 히어로: 디바이스 스크린 */}
      <DeviceScreen app={app} big className="card-r aspect-[16/7] w-full ring-1 ring-black/[0.06] sm:aspect-[16/5.5]" />

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[28px] font-extrabold tracking-tight text-neutral-900">{app.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-neutral-600"><Avatar name={app.owner} size={20} />{app.owner}</span>
            <span className="text-neutral-300">·</span>
            <Chip tone="blue">{app.subject}</Chip>
            {app.grades.map((g) => <Chip key={g}>{g}</Chip>)}
            {!app.isPublic ? <Chip tone="yellow">비공개</Chip> : null}
          </div>
        </div>
        <a href={app.url} target="_blank" rel="noopener" className="acc-bg inline-flex h-11 items-center gap-2 rounded-full px-6 text-[14px] font-semibold text-white shadow-sm transition-all hover:shadow-md hover:brightness-110 active:scale-[0.97]">
          <span>앱 열기</span><LR.ArrowUpRight size={16} />
        </a>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* 좌측: 설명 + 프롬프트 */}
        <div className="flex min-w-0 flex-col gap-6">
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-6">
            <h2 className="mb-3 text-[15px] font-bold text-neutral-900">상세 설명 · 활용 매뉴얼</h2>
            <p className="whitespace-pre-line break-keep text-[14px] leading-[1.8] text-neutral-600">{app.description}</p>
          </section>

          {/* 프롬프트 코드 블록 */}
          <section className="overflow-hidden rounded-3xl bg-[#2B2724] shadow-[0_12px_36px_-14px_rgba(0,0,0,0.4)]">
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
              <div className="text-[12px] font-bold uppercase tracking-[0.18em] text-neutral-400">핵심 프롬프트</div>
              <CopyButton text={app.prompt} dark />
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-keep px-5 py-5 font-mono text-[13px] leading-[1.85] text-neutral-300">{app.prompt}</pre>
          </section>
        </div>

        {/* 우측: 스펙 + 네트워크 패널 */}
        <aside className="flex flex-col gap-6">
          <section>
            <h2 className="mb-3 px-1 text-[12px] font-bold uppercase tracking-wider text-neutral-400">기술 스택</h2>
            <div className="rounded-3xl border border-neutral-200/80 bg-white px-5 py-2">
              <SpecCell label="Database" value={app.stack.db} />
              <SpecCell label="Backend" value={app.stack.backend} />
              <SpecCell label="Frontend" value={app.stack.frontend} />
              <SpecCell label="Hosting" value={app.stack.hosting} />
            </div>
          </section>

          {/* 네트워크 체크 패널 */}
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-[14px] font-bold text-neutral-900">연결 상태</h2>
              <StatusBadge status={app.status} checking={app.checking} technical={isAdmin} />
            </div>
            <dl className="grid gap-2 text-[13px]">
              {isAdmin ? (
                <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                  <dt className="text-neutral-500">응답 시간</dt>
                  <dd className="font-mono font-semibold text-neutral-800">{app.checking ? '—' : app.status === 200 ? app.ms + ' ms' : 'timeout'}</dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between rounded-xl bg-neutral-50 px-3.5 py-2.5">
                <dt className="text-neutral-500">마지막 검사</dt>
                <dd className="font-semibold text-neutral-800">오늘 {app.lastChecked}</dd>
              </div>
            </dl>
            {!app.checking && app.status !== 200 ? (
              <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
                
                <div>
                  <div className="text-[13px] font-bold text-red-700">{isAdmin ? meta.code + ' — ' + meta.label : '지금은 열 수 없는 앱이에요'}</div>
                  <p className="mt-1 break-keep text-[12px] leading-relaxed text-red-600/90">{isAdmin ? meta.detail : '앱 주소가 응답하지 않습니다. 잠시 후 다시 시도해 보시고, 계속 열리지 않으면 등록한 선생님이나 관리자에게 알려 주세요.'}</p>
                </div>
              </div>
            ) : null}
            <Btn variant="soft" className="mt-4 w-full" onClick={() => onPing(app.id)} disabled={app.checking}>
              <LR.RefreshCw size={14} className={app.checking ? 'animate-spin' : ''} /><span>{app.checking ? '확인 중…' : (isAdmin ? '수동 Ping 테스트' : '연결 다시 확인')}</span>
            </Btn>
          </section>

          <div className="px-1 text-[12px] leading-relaxed text-neutral-400">
            <div className="flex items-center justify-between border-b border-neutral-200/70 py-2"><span>공개 범위</span><span className="font-semibold text-neutral-600">{app.isPublic ? '전체 공개' : '본인 · 관리자만'}</span></div>
            <div className="flex items-center justify-between border-b border-neutral-200/70 py-2"><span>등록일</span><span className="font-semibold text-neutral-600">{app.createdAt}</span></div>
            <div className="flex items-center justify-between py-2"><span>썸네일 테마</span><span className="font-semibold text-neutral-600">Pantone {themeById(app.theme).pantone} {themeById(app.theme).name}</span></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

Object.assign(window, { DetailView });
