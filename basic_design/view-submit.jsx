// 등록/편집 뷰 — 로그인 사용자 전용
function SubmitView({ user, editApp, onSave, onCancel }) {
  const [f, setF] = React.useState(() => editApp ? { ...editApp, stack: { ...editApp.stack } } : {
    name: '', url: '', prompt: '', description: '',
    grades: [], subject: '', stack: { db: '', backend: '', frontend: '', hosting: '' },
    isPublic: true, theme: 'niagara',
  });
  const [err, setErr] = React.useState(null);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setStack = (k, v) => setF((p) => ({ ...p, stack: { ...p.stack, [k]: v } }));
  const toggleGrade = (g) => set('grades', f.grades.includes(g) ? f.grades.filter((x) => x !== g) : [...f.grades, g].sort((a, b) => GRADES.indexOf(a) - GRADES.indexOf(b)));

  const submit = (e) => {
    e.preventDefault();
    const need = [
      [!f.name.trim(), '어플리케이션 이름'], [!f.url.trim(), '배포 URL'],
      [!f.prompt.trim(), '핵심 프롬프트'], [!f.description.trim(), '상세 설명'],
      [!f.subject, '교과 과목'], [!f.grades.length, '적용 학년'],
    ].filter(([bad]) => bad).map(([, label]) => label);
    if (need.length) { setErr('필수 항목을 확인해 주세요: ' + need.join(', ')); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    onSave(f);
  };

  const previewApp = { ...f, name: f.name || '앱 이름', subject: f.subject || '과목', grades: f.grades.length ? f.grades : ['학년'], owner: user.id, status: 200 };

  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 pb-24 pt-10 sm:px-8" data-screen-label={editApp ? '편집' : '등록'}>
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-neutral-900">{editApp ? '앱 정보 편집' : '새 앱 등록'}</h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">프롬프트까지 공유하면 다른 선생님이 똑같이 다시 만들 수 있어요.</p>
        </div>
        <Btn variant="ghost" size="sm" onClick={onCancel}><span>취소</span></Btn>
      </div>

      {err ? (
        <div className="mb-5 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700">
          <span>{err}</span>
        </div>
      ) : null}

      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          {/* 기본 정보 */}
          <section className="flex flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-6">
            <h2 className="text-[14px] font-bold text-neutral-900">기본 정보</h2>
            <Field label="어플리케이션 이름" required>
              <input className={inputCls} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 분수 피자 가게" />
            </Field>
            <Field label="배포 URL" required>
              <input className={inputCls} value={f.url} onChange={(e) => set('url', e.target.value)} placeholder="https://my-app.vercel.app" />
            </Field>
            <Field label="핵심 프롬프트" required hint="앱을 만들 때 AI에게 준 프롬프트">
              <textarea className={inputCls + ' min-h-[130px] resize-y font-mono text-[13px] leading-relaxed'} value={f.prompt} onChange={(e) => set('prompt', e.target.value)} placeholder="AI에게 입력했던 핵심 프롬프트를 그대로 붙여넣어 주세요."></textarea>
            </Field>
            <Field label="상세 설명" required hint="어떤 수업 상황에 유용한지 매뉴얼 포함">
              <textarea className={inputCls + ' min-h-[130px] resize-y leading-relaxed'} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder={'어떤 단원·상황에서 쓰면 좋은지 적어 주세요.\n\n[활용 매뉴얼]\n1. …'}></textarea>
            </Field>
          </section>

          {/* 분류 */}
          <section className="flex flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-6">
            <h2 className="text-[14px] font-bold text-neutral-900">분류</h2>
            <Field label="교과 과목" required>
              <div className="flex flex-wrap gap-1.5">
                {SUBJECTS.map((s) => (
                  <button type="button" key={s} onClick={() => set('subject', s)} className={'h-9 rounded-full px-4 text-[13px] font-semibold transition-all ' + (f.subject === s ? 'acc-bg text-white shadow-sm' : 'border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300')}>{s}</button>
                ))}
              </div>
            </Field>
            <Field label="적용 가능 학년" required hint="복수 선택 가능">
              <div className="flex flex-wrap gap-1.5">
                {GRADES.map((g) => (
                  <button type="button" key={g} onClick={() => toggleGrade(g)} className={'h-9 rounded-full px-3.5 text-[13px] font-semibold transition-all ' + (f.grades.includes(g) ? 'bg-[#3C7A72] text-white shadow-sm' : 'border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300')}>{g}</button>
                ))}
              </div>
            </Field>
          </section>

          {/* 기술 스택 */}
          <section className="flex flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-6">
            <h2 className="text-[14px] font-bold text-neutral-900">기술 스택</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="DB"><input className={inputCls} value={f.stack.db} onChange={(e) => setStack('db', e.target.value)} placeholder="예: Supabase (PostgreSQL)" /></Field>
              <Field label="백엔드 엔진"><input className={inputCls} value={f.stack.backend} onChange={(e) => setStack('backend', e.target.value)} placeholder="예: Firebase Functions" /></Field>
              <Field label="프론트엔드 프레임워크"><input className={inputCls} value={f.stack.frontend} onChange={(e) => setStack('frontend', e.target.value)} placeholder="예: React + Vite" /></Field>
              <Field label="호스팅 서비스"><input className={inputCls} value={f.stack.hosting} onChange={(e) => setStack('hosting', e.target.value)} placeholder="예: Vercel" /></Field>
            </div>
          </section>
        </div>

        {/* 우측: 미리보기 + 공개 설정 + 테마 */}
        <aside className="flex flex-col gap-6">
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-neutral-400">썸네일 미리보기</h2>
            <DeviceScreen app={previewApp} className="aspect-[16/10] rounded-2xl ring-1 ring-black/[0.06]" />
            <h3 className="mb-2.5 mt-5 text-[12px] font-bold uppercase tracking-wider text-neutral-400">Pantone 테마 컬러</h3>
            <div className="grid grid-cols-4 gap-2">
              {THEMES.map((t) => (
                <button type="button" key={t.id} title={t.name} onClick={() => set('theme', t.id)}
                  className={'aspect-square rounded-xl ring-offset-2 transition-all ' + (f.theme === t.id ? 'ring-2 ring-[#4C7A96] scale-105' : 'hover:scale-105')}
                  style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }}>
                </button>
              ))}
            </div>
            <div className="mt-2.5 text-center text-[11.5px] font-semibold text-neutral-500">Pantone {themeById(f.theme).pantone} · {themeById(f.theme).name}</div>
          </section>

          <section className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[13.5px] font-bold text-neutral-900">{f.isPublic ? '전체 공개' : '비공개'}</div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">{f.isPublic ? '모든 사용자가 열람할 수 있어요.' : '본인과 관리자만 볼 수 있어요.'}</p>
              </div>
              <Toggle value={f.isPublic} onChange={(v) => set('isPublic', v)} />
            </div>
          </section>

          <Btn type="submit" size="lg" className="w-full"><span>{editApp ? '변경사항 저장' : '아카이브에 등록'}</span></Btn>
        </aside>
      </form>
    </div>
  );
}

Object.assign(window, { SubmitView });
