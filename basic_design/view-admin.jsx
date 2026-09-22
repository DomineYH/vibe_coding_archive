// 관리자 대시보드
function StatCard({ label, value, tone }) {
  const rules = { blue: 'bg-[#4C7A96]', mint: 'bg-emerald-600', yellow: 'bg-amber-600', tomato: 'bg-red-600' };
  return (
    <div className="relative overflow-hidden rounded-3xl border border-neutral-200/80 bg-white p-5">
      <span className={'absolute inset-y-0 left-0 w-[3px] ' + rules[tone]}></span>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{label}</div>
      <div className="mt-1 text-[26px] font-extrabold leading-tight tracking-tight text-neutral-900">{value}</div>
    </div>
  );
}

function AdminView({ users, apps, onToggleApprove, onChangePw, onDeleteUser, onDeleteApp, onPing, onPingAll, onOpenApp }) {
  const [tab, setTab] = React.useState('users');
  const [pwTarget, setPwTarget] = React.useState(null);
  const [newPw, setNewPw] = React.useState('');
  const [pwDone, setPwDone] = React.useState(null);
  const [confirmDel, setConfirmDel] = React.useState(null); // 'user:아이디' | 'app:id'

  const pending = users.filter((u) => !u.approved);
  const okCount = apps.filter((a) => a.status === 200).length;
  const errCount = apps.length - okCount;

  const savePw = (id) => {
    if (newPw.length < 4) return;
    onChangePw(id, newPw);
    setPwDone(id); setPwTarget(null); setNewPw('');
    setTimeout(() => setPwDone(null), 2000);
  };

  return (
    <div className="mx-auto w-full max-w-[1080px] px-5 pb-24 pt-10 sm:px-8" data-screen-label="관리자 대시보드">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-neutral-900">관리자 대시보드</h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">사용자 승인과 플랫폼 상태를 한곳에서 관리해요.</p>
        </div>
        <div className="flex gap-1 rounded-full bg-neutral-200/60 p-1">
          {[['users', '사용자 관리'], ['health', 'Health Monitor']].map(([t, label]) => (
            <button key={t} onClick={() => { setTab(t); setConfirmDel(null); setPwTarget(null); setNewPw(''); }} className={'h-9 rounded-full px-5 text-[13px] font-semibold transition-all ' + (tab === t ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700')}>{label}</button>
          ))}
        </div>
      </div>

      {/* 통계 */}
      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="전체 사용자" value={users.length} tone="blue" />
        <StatCard label="승인 대기" value={pending.length} tone="yellow" />
        <StatCard label="등록된 앱" value={apps.length} tone="blue" />
        <StatCard label="정상 가동" value={okCount + ' / ' + apps.length} tone={errCount ? 'tomato' : 'mint'} />
      </div>

      {tab === 'users' ? (
        <section className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white">
          <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-4">
            <h2 className="text-[15px] font-bold text-neutral-900">사용자 승인 · 계정 관리</h2>
            {pending.length ? <Chip tone="yellow">대기 {pending.length}명</Chip> : <Chip tone="mint">대기 없음</Chip>}
          </div>
          <ul className="divide-y divide-neutral-100">
            {[...users].sort((a, b) => (a.approved === b.approved ? 0 : a.approved ? 1 : -1)).map((u) => (
              <li key={u.id} className={'px-6 py-4 transition-colors ' + (!u.approved ? 'bg-amber-50/40' : '')}>
                <div className="flex flex-wrap items-center gap-3">
                  <Avatar name={u.id} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[14.5px] font-bold text-neutral-900">{u.id}</span>
                      {u.role === 'admin' ? <Chip tone="blue">관리자</Chip> : u.approved ? <Chip tone="mint">활동중</Chip> : <Chip tone="yellow">승인 대기</Chip>}
                      {pwDone === u.id ? <Chip tone="mint">비밀번호 변경됨</Chip> : null}
                    </div>
                    <div className="mt-0.5 text-[12px] text-neutral-400">가입 신청 {u.joinedAt}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {u.role !== 'admin' ? (
                      <button onClick={() => setPwTarget(pwTarget === u.id ? null : u.id)} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-[12px] font-semibold text-neutral-600 transition-colors hover:bg-neutral-50">
                        <span>비밀번호 변경</span>
                      </button>
                    ) : null}
                    {u.role !== 'admin' ? (
                      <button onClick={() => { setConfirmDel('user:' + u.id); setPwTarget(null); }} className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 text-[12px] font-semibold text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700">
                        <span>삭제</span>
                      </button>
                    ) : null}
                    {u.role !== 'admin' ? (
                      <button onClick={() => onToggleApprove(u.id)} className={'inline-flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[12px] font-bold transition-all active:scale-95 ' + (u.approved ? 'bg-neutral-100 text-neutral-500 hover:bg-red-50 hover:text-red-600' : 'bg-[#3C7A72] text-white shadow-sm hover:brightness-110')}>
                        {u.approved ? <span>승인 해제</span> : <span>승인하기</span>}
                      </button>
                    ) : null}
                  </div>
                </div>
                {confirmDel === 'user:' + u.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                    <div className="min-w-[200px] flex-1">
                      <div className="text-[12.5px] font-bold text-red-700">{u.id} 계정을 삭제할까요?</div>
                      <p className="mt-0.5 text-[11.5px] leading-relaxed text-red-600/90">이 사용자가 등록한 앱 {apps.filter((x) => x.owner === u.id).length}개도 함께 삭제되며 되돌릴 수 없습니다.</p>
                    </div>
                    <Btn size="sm" variant="danger" onClick={() => { onDeleteUser(u.id); setConfirmDel(null); }}>삭제 확인</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>취소</Btn>
                  </div>
                ) : null}
                {pwTarget === u.id ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50 px-4 py-3">
                    
                    <span className="text-[12.5px] font-semibold text-neutral-600">강제 패스워드 변경 —</span>
                    <input autoFocus type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePw(u.id)} placeholder="새 비밀번호 (4자 이상)" className="h-9 flex-1 min-w-[160px] rounded-xl border border-neutral-200 bg-white px-3 text-[13px] outline-none focus:border-[#4C7A96]/40" />
                    <Btn size="sm" onClick={() => savePw(u.id)} disabled={newPw.length < 4}>적용</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => { setPwTarget(null); setNewPw(''); }}>취소</Btn>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="overflow-hidden rounded-3xl border border-neutral-200/80 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-6 py-4">
            <h2 className="text-[15px] font-bold text-neutral-900">네트워크 활성 상태 모니터링</h2>
            <Btn size="sm" variant="soft" onClick={onPingAll}><LR.RefreshCw size={13} /><span>전체 재검사</span></Btn>
          </div>
          <ul className="divide-y divide-neutral-100">
            {apps.map((a) => {
              const meta = STATUS_META[a.status];
              const bad = !a.checking && a.status !== 200;
              return (
                <li key={a.id} className={'px-6 py-4 transition-colors duration-300 ' + (bad ? 'bg-red-50/40' : '')}>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="h-9 w-14 shrink-0 overflow-hidden rounded-lg ring-1 ring-black/[0.06]" style={{ background: `linear-gradient(135deg, ${themeById(a.theme).from}, ${themeById(a.theme).to})` }}></span>
                    <div className="min-w-0 flex-1">
                      <button onClick={() => onOpenApp(a.id)} className="block max-w-full truncate text-left text-[14px] font-bold text-neutral-900 hover:underline">{a.name}</button>
                      <div className="mt-0.5 flex items-center gap-2 truncate font-mono text-[11.5px] text-neutral-400">
                        <span className="truncate">{a.url}</span>
                        {a.status === 200 && !a.checking ? <span className="shrink-0 text-emerald-600">{a.ms} ms</span> : null}
                      </div>
                    </div>
                    <StatusBadge status={a.status} checking={a.checking} technical />
                    <button onClick={() => onPing(a.id)} disabled={a.checking} className="acc-text inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-[12px] font-bold transition-all hover:bg-neutral-50 active:scale-95 disabled:opacity-40">
                      <span>즉시 재검사</span>
                    </button>
                    <button onClick={() => setConfirmDel('app:' + a.id)} className="inline-flex h-8 items-center rounded-full border border-neutral-200 bg-white px-3 text-[12px] font-semibold text-neutral-500 transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-700">
                      <span>삭제</span>
                    </button>
                  </div>
                  {confirmDel === 'app:' + a.id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                      <div className="min-w-[200px] flex-1">
                        <div className="text-[12.5px] font-bold text-red-700">‘{a.name}’{objJosa(a.name)} 아카이브에서 삭제할까요?</div>
                        <p className="mt-0.5 text-[11.5px] leading-relaxed text-red-600/90">프롬프트와 활용 매뉴얼이 함께 삭제되며 되돌릴 수 없습니다.</p>
                      </div>
                      <Btn size="sm" variant="danger" onClick={() => { onDeleteApp(a.id); setConfirmDel(null); }}>삭제 확인</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(null)}>취소</Btn>
                    </div>
                  ) : null}
                  {bad ? (
                    <div className="mt-3 flex items-start gap-2.5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
                      
                      <div>
                        <div className="text-[12.5px] font-bold text-red-700">{meta.code} — {meta.label}</div>
                        <p className="mt-0.5 break-keep text-[12px] leading-relaxed text-red-600/90">{meta.detail}</p>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

Object.assign(window, { AdminView });
