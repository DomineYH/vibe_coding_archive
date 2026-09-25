// 인증 뷰 — 로그인 / 회원가입 (ID + PW만)
function AuthView({ users, onLogin, onSignup }) {
  const [mode, setMode] = React.useState('login');
  const [id, setId] = React.useState('');
  const [pw, setPw] = React.useState('');
  const [pw2, setPw2] = React.useState('');
  const [msg, setMsg] = React.useState(null); // {tone, text}

  const switchMode = (m) => { setMode(m); setMsg(null); setPw(''); setPw2(''); };

  const submit = (e) => {
    e.preventDefault();
    if (!id.trim() || !pw) { setMsg({ tone: 'tomato', text: '아이디와 비밀번호를 모두 입력해 주세요.' }); return; }
    if (mode === 'login') {
      const r = onLogin(id.trim(), pw);
      if (!r.ok) setMsg(r.msg);
    } else {
      if (pw !== pw2) { setMsg({ tone: 'tomato', text: '비밀번호 확인이 일치하지 않습니다.' }); return; }
      if (pw.length < 4) { setMsg({ tone: 'tomato', text: '비밀번호는 4자 이상이어야 합니다.' }); return; }
      const r = onSignup(id.trim(), pw);
      setMsg(r.msg);
      if (r.ok) { setMode('login'); setPw(''); setPw2(''); }
    }
  };

  const toneCls = {
    tomato: 'border-red-200 bg-red-50 text-red-700',
    yellow: 'border-amber-200 bg-amber-50 text-amber-800',
    mint:   'border-emerald-200 bg-emerald-50 text-emerald-700',
  };

  return (
    <div className="mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pb-24 pt-14" data-screen-label="로그인">
      <span className="acc-bg mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-lg shadow-[#4C7A96]/25"><span className="text-[17px] font-extrabold tracking-tight">EV</span></span>
      <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">{mode === 'login' ? '다시 만나서 반가워요' : '아카이브에 합류하기'}</h1>
      <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-neutral-500">
        {mode === 'login' ? '아이디가 곧 활동 닉네임이에요. 별도의 개인정보는 받지 않아요.' : '아이디와 비밀번호만으로 가입해요. 관리자 승인 후 활동할 수 있어요.'}
      </p>

      {/* 세그먼트 */}
      <div className="mt-7 grid w-full grid-cols-2 gap-1 rounded-full bg-neutral-200/60 p-1">
        {[['login', '로그인'], ['signup', '회원가입']].map(([m, label]) => (
          <button key={m} onClick={() => switchMode(m)} className={'h-9 rounded-full text-[13.5px] font-semibold transition-all duration-200 ' + (mode === m ? 'bg-white text-neutral-900 shadow-sm' : 'text-neutral-500 hover:text-neutral-700')}>{label}</button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-5 flex w-full flex-col gap-3.5 rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.08)]">
        <Field label="아이디" hint="닉네임으로 공개 표시됩니다">
          <input className={inputCls} value={id} onChange={(e) => setId(e.target.value)} placeholder="예: 교사김코딩" autoComplete="username" />
        </Field>
        <Field label="비밀번호">
          <input className={inputCls} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </Field>
        {mode === 'signup' ? (
          <Field label="비밀번호 확인">
            <input className={inputCls} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="••••••" autoComplete="new-password" />
          </Field>
        ) : null}

        {msg ? (
          <div className={'flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[12.5px] font-medium leading-relaxed ' + toneCls[msg.tone]}>
            
            <span>{msg.text}</span>
          </div>
        ) : null}

        <Btn type="submit" size="lg" className="mt-1 w-full">{mode === 'login' ? '로그인' : '가입 신청하기'}</Btn>
        {mode === 'signup' ? (
          <p className="text-center text-[11.5px] leading-relaxed text-neutral-400">가입 즉시 로그인되지 않으며, 관리자 승인 후 이용할 수 있습니다.</p>
        ) : null}
      </form>

      {/* 데모 계정 안내 */}
      <div className="mt-5 w-full rounded-2xl border border-neutral-200/70 bg-white/70 px-4 py-3.5">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400">데모 계정</div>
        <div className="grid gap-1.5 text-[12.5px] text-neutral-600">
          <div className="flex items-center justify-between"><span className="font-semibold">admin / admin123</span><Chip tone="blue">관리자</Chip></div>
          <div className="flex items-center justify-between"><span className="font-semibold">교사김코딩 / 1234</span><Chip tone="mint">승인됨</Chip></div>
          <div className="flex items-center justify-between"><span className="font-semibold">비기너개발자 / 1234</span><Chip tone="yellow">승인 대기</Chip></div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { AuthView });
