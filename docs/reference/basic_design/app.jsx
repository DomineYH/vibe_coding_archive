// 앱 루트 — 상태, 라우팅, 헤더, Tweaks
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#4C7A96",
  "radius": 22,
  "header": "클라우드"
}/*EDITMODE-END*/;

const STORE_KEY = 'eduvibe-archive-coty2026';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const s = JSON.parse(raw); if (s.users && s.apps) return s; }
  } catch (e) {}
  return { users: INITIAL_USERS, apps: INITIAL_APPS, currentUserId: null };
}

function Toast({ toast }) {
  if (!toast) return null;
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-[toastIn_0.25s_ease-out]">
      <div className="flex items-center gap-2 rounded-full bg-neutral-900/90 px-5 py-2.5 text-[13px] font-semibold text-white shadow-xl backdrop-blur">
        <span>{toast}</span>
      </div>
    </div>
  );
}

function Header({ user, route, go, onLogout, solid }) {
  const navBtn = (active) => 'h-9 rounded-full px-4 text-[13px] font-semibold transition-all ' + (
    solid
      ? (active ? 'bg-white/20 text-white' : 'text-white/75 hover:text-white hover:bg-white/10')
      : (active ? 'bg-neutral-900/[0.06] text-neutral-900' : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-900/[0.04]')
  );
  return (
    <header className={'sticky top-0 z-30 border-b backdrop-blur-xl transition-colors ' + (solid ? 'acc-bg border-white/10' : 'border-neutral-200/70 bg-white/75')}>
      <div className="mx-auto flex h-[57px] w-full max-w-[1280px] items-center gap-2 px-5 sm:px-8">
        <button onClick={() => go({ name: 'gallery' })} className="flex items-center gap-2.5">
          <span className={'inline-flex h-8 w-8 items-center justify-center rounded-[10px] shadow-sm ' + (solid ? 'bg-white acc-text' : 'acc-bg text-white')}><span className="text-[12.5px] font-extrabold tracking-tight">EV</span></span>
          <span className={'text-[15.5px] font-extrabold tracking-tight ' + (solid ? 'text-white' : 'text-neutral-900')}>EduVibe<span className={solid ? 'text-white/60' : 'acc-text'}> 아카이브</span></span>
        </button>
        <nav className="ml-4 hidden items-center gap-1 sm:flex">
          <button onClick={() => go({ name: 'gallery' })} className={navBtn(route.name === 'gallery' || route.name === 'detail')}>갤러리</button>
          {user ? <button onClick={() => go({ name: 'submit' })} className={navBtn(route.name === 'submit')}>앱 등록</button> : null}
          {user && user.role === 'admin' ? <button onClick={() => go({ name: 'admin' })} className={navBtn(route.name === 'admin')}>관리자</button> : null}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {user ? (
            <>
              <span className={'hidden items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[13px] font-semibold sm:inline-flex ' + (solid ? 'bg-white/15 text-white' : 'bg-neutral-100 text-neutral-700')}>
                <Avatar name={user.id} size={24} /><span>{user.id}</span>
                {user.role === 'admin' ? <span className={'text-[11px] font-bold ' + (solid ? 'text-white/70' : 'acc-text')}>관리자</span> : null}
              </span>
              <button onClick={onLogout} title="로그아웃" className={'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors ' + (solid ? 'text-white/75 hover:bg-white/10 hover:text-white' : 'text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700')}><LR.LogOut size={16} /></button>
            </>
          ) : (
            <Btn size="sm" variant={solid ? 'line' : 'primary'} onClick={() => go({ name: 'auth' })}><span>로그인</span></Btn>
          )}
        </div>
      </div>
    </header>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [state, setState] = React.useState(loadState);
  const [route, setRoute] = React.useState({ name: 'gallery' });
  const [toast, setToast] = React.useState(null);
  const toastTimer = React.useRef(null);

  const { users, apps } = state;
  const user = users.find((u) => u.id === state.currentUserId) || null;

  // 영속화
  React.useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }, [state]);

  // Tweaks → CSS 변수
  React.useEffect(() => {
    const r = document.documentElement.style;
    r.setProperty('--accent', t.accent);
    r.setProperty('--radius-card', t.radius + 'px');
  }, [t]);

  const go = (r) => { setRoute(r); window.scrollTo({ top: 0 }); };
  const ping_ = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  };

  // ── 인증 ──
  const login = (id, pw) => {
    const u = users.find((x) => x.id === id);
    if (!u || u.pw !== pw) return { ok: false, msg: { tone: 'tomato', text: '아이디 또는 비밀번호가 올바르지 않습니다.' } };
    if (!u.approved) return { ok: false, msg: { tone: 'yellow', text: '관리자 승인 대기 중인 계정입니다. 승인이 완료되면 로그인할 수 있어요.' } };
    setState((s) => ({ ...s, currentUserId: id }));
    go({ name: 'gallery' });
    ping_(`${id}님, 환영합니다!`);
    return { ok: true };
  };
  const signup = (id, pw) => {
    if (users.some((x) => x.id === id)) return { ok: false, msg: { tone: 'tomato', text: '이미 사용 중인 아이디입니다.' } };
    setState((s) => ({ ...s, users: [...s.users, { id, pw, role: 'user', approved: false, joinedAt: today() }] }));
    return { ok: true, msg: { tone: 'mint', text: '가입 신청 완료! 관리자 승인 후 로그인할 수 있어요.' } };
  };
  const logout = () => { setState((s) => ({ ...s, currentUserId: null })); go({ name: 'gallery' }); ping_('로그아웃되었습니다.'); };

  // ── 관리자 ──
  const toggleApprove = (id) => {
    setState((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? { ...u, approved: !u.approved } : u)) }));
    const u = users.find((x) => x.id === id);
    ping_(u && !u.approved ? `${id}님을 승인했어요.` : `${id}님의 승인을 해제했어요.`);
  };
  const changePw = (id, pw) => {
    setState((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? { ...u, pw } : u)) }));
    ping_(`${id}님의 비밀번호를 변경했어요.`);
  };

  // ── 핑 시뮬레이션 ──
  const setApp = (id, patch) => setState((s) => ({ ...s, apps: s.apps.map((a) => (a.id === id ? { ...a, ...(typeof patch === 'function' ? patch(a) : patch) } : a)) }));
  const deleteUser = (id) => {
    setState((s) => ({
      ...s,
      users: s.users.filter((u) => u.id !== id),
      apps: s.apps.filter((a) => a.owner !== id),
      currentUserId: s.currentUserId === id ? null : s.currentUserId,
    }));
    ping_(id + '님의 계정과 등록 앱을 삭제했어요.');
  };
  const deleteApp = (id, backToGallery) => {
    const target = apps.find((a) => a.id === id);
    setState((s) => ({ ...s, apps: s.apps.filter((a) => a.id !== id) }));
    const nm = target ? target.name : '앱';
    ping_('‘' + nm + '’' + objJosa(nm) + ' 삭제했어요.');
    if (backToGallery) go({ name: 'gallery' });
  };
  const pingApp = (id) => {
    setApp(id, { checking: true });
    setTimeout(() => setApp(id, { checking: false, ...simulatePing() }), 600 + Math.random() * 700);
  };
  const pingAll = () => apps.forEach((a, i) => setTimeout(() => pingApp(a.id), i * 130));

  // ── 등록/편집 ──
  const saveApp = (f) => {
    if (f.id) {
      setApp(f.id, f);
      ping_('변경사항을 저장했어요.');
      go({ name: 'detail', id: f.id });
    } else {
      const app = { ...f, id: uid(), owner: user.id, createdAt: today(), ...simulatePing() };
      setState((s) => ({ ...s, apps: [app, ...s.apps] }));
      ping_('아카이브에 등록되었어요!');
      go({ name: 'detail', id: app.id });
    }
  };

  // 라우트 가드
  const r = route;
  const detailApp = r.name === 'detail' ? apps.find((a) => a.id === r.id) : null;
  const canSeeDetail = detailApp && (detailApp.isPublic || (user && (user.id === detailApp.owner || user.role === 'admin')));

  let view = null;
  if (r.name === 'auth') view = <AuthView users={users} onLogin={login} onSignup={signup} />;
  else if (r.name === 'submit' && user) view = <SubmitView key={r.editId || 'new'} user={user} editApp={r.editId ? apps.find((a) => a.id === r.editId) : null} onSave={saveApp} onCancel={() => go(r.editId ? { name: 'detail', id: r.editId } : { name: 'gallery' })} />;
  else if (r.name === 'admin' && user && user.role === 'admin') view = <AdminView users={users} apps={apps} onToggleApprove={toggleApprove} onChangePw={changePw} onDeleteUser={deleteUser} onDeleteApp={deleteApp} onPing={pingApp} onPingAll={pingAll} onOpenApp={(id) => go({ name: 'detail', id })} />;
  else if (r.name === 'detail' && canSeeDetail) view = <DetailView app={detailApp} user={user} onBack={() => go({ name: 'gallery' })} onEdit={() => go({ name: 'submit', editId: detailApp.id })} onDelete={(id) => deleteApp(id, true)} onPing={pingApp} />;
  else view = <GalleryView apps={apps} user={user} onOpen={(id) => go({ name: 'detail', id })} onSubmit={() => go(user ? { name: 'submit' } : { name: 'auth' })} />;

  return (
    <div className="min-h-screen">
      <Header user={user} route={route} go={go} onLogout={logout} solid={t.header === '딥톤'} />
      {view}
      <footer className="border-t border-neutral-200/70 py-8 text-center text-[12px] text-neutral-400">
        EduVibe 아카이브 — 교사 에이전틱 코딩 공유 플랫폼 · Pantone 11-4201 Cloud Dancer, Color of the Year 2026
      </footer>
      <Toast toast={toast} />

      <TweaksPanel>
        <TweakSection label="브랜드" />
        <TweakColor label="액센트 컬러" value={t.accent}
          options={['#4C7A96', '#4E8382', '#7E6E82', '#A9714B']}
          onChange={(v) => setTweak('accent', v)} />
        <TweakRadio label="헤더 스타일" value={t.header} options={['클라우드', '딥톤']}
          onChange={(v) => setTweak('header', v)} />
        <TweakSection label="카드" />
        <TweakSlider label="모서리 곡률" value={t.radius} min={12} max={32} unit="px"
          onChange={(v) => setTweak('radius', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
