// 공용 UI 컴포넌트
const LR = (window.LucideReact && window.LucideReact.Copy) ? window.LucideReact : new Proxy({}, { get: () => (p) => <span style={{ display: 'inline-block', width: p.size || 16, height: p.size || 16 }}></span> });

// ── 기본 요소 ──────────────────────────────────────────────
function Chip({ children, tone = 'gray' }) {
  const tones = {
    gray:   'bg-neutral-100 text-neutral-600 border-neutral-200',
    blue:   'bg-[#4C7A96]/[0.10] text-[#31576C] border-[#4C7A96]/20',
    mint:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    yellow: 'bg-amber-50 text-amber-800 border-amber-200',
    tomato: 'bg-red-50 text-red-700 border-red-200',
  };
  return <span className={'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium leading-5 ' + tones[tone]}>{children}</span>;
}

function StatusBadge({ status, checking, size = 'sm', technical }) {
  const meta = STATUS_META[status] || STATUS_META[200];
  const big = size === 'md';
  if (checking) {
    return (
      <span className={'inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 font-medium text-neutral-500 ' + (big ? 'px-3 py-1 text-[13px]' : 'px-2.5 py-0.5 text-[11.5px]')}>
        <LR.Loader2 size={big ? 14 : 12} className="animate-spin" /><span>검사중…</span>
      </span>
    );
  }
  const ok = status === 200;
  return (
    <span className={'inline-flex items-center gap-1.5 rounded-full border font-semibold ' + (big ? 'px-3 py-1 text-[13px] ' : 'px-2.5 py-0.5 text-[11.5px] ') + (ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700')}>
      <span className={'inline-block h-1.5 w-1.5 rounded-full ' + (ok ? 'bg-emerald-600' : 'bg-red-600')}></span>
      <span>{technical ? meta.code : (ok ? '정상' : '오류')}</span>
    </span>
  );
}

function Btn({ children, onClick, variant = 'primary', size = 'md', className = '', type = 'button', disabled }) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-semibold transition-all duration-200 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none select-none';
  const sizes = { sm: 'h-8 px-3 text-[12.5px] rounded-full', md: 'h-10 px-5 text-[13.5px] rounded-full', lg: 'h-12 px-7 text-[15px] rounded-full' };
  const variants = {
    primary: 'acc-bg text-white shadow-sm hover:shadow-md hover:brightness-110',
    soft:    'acc-soft acc-text hover:brightness-[0.97]',
    ghost:   'text-neutral-600 hover:bg-neutral-100',
    line:    'border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50',
    danger:  'bg-[#9B3B41] text-white shadow-sm hover:brightness-110',
    mint:    'bg-[#3C7A72] text-white shadow-sm hover:brightness-110',
  };
  return <button type={type} disabled={disabled} onClick={onClick} className={[base, sizes[size], variants[variant], className].join(' ')}>{children}</button>;
}

function Field({ label, required, hint, children }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex items-baseline gap-1.5">
        <span className="text-[13px] font-semibold text-neutral-800">{label}</span>
        {required ? <span className="text-[12px] font-medium text-[#9B3B41]">*</span> : null}
        {hint ? <span className="text-[11.5px] text-neutral-400">{hint}</span> : null}
      </div>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10';

function Toggle({ value, onChange, label }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-3" aria-pressed={value}>
      <span className={'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-300 ' + (value ? 'bg-[#3C7A72]' : 'bg-neutral-300')}>
        <span className={'absolute h-5.5 w-5.5 rounded-full bg-white shadow transition-all duration-300 ' + (value ? 'left-[26px]' : 'left-[3px]')} style={{ width: 22, height: 22 }}></span>
      </span>
      {label ? <span className="text-[13.5px] font-medium text-neutral-700">{label}</span> : null}
    </button>
  );
}

function CopyButton({ text, dark }) {
  const [done, setDone] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    setDone(true); setTimeout(() => setDone(false), 1800);
  };
  return (
    <button onClick={copy} className={'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors ' + (dark ? 'bg-white/10 text-neutral-300 hover:bg-white/20' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200')}>
      {done ? <LR.Check size={13} className="text-[#3C7A72]" /> : <LR.Copy size={13} />}
      <span>{done ? '복사됨' : '복사하기'}</span>
    </button>
  );
}

function Avatar({ name, size = 32 }) {
  return (
    <span className="acc-bg inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {(name || '?').slice(0, 1)}
    </span>
  );
}

// ── 액자형(디바이스 스크린) 갤러리 카드 ──────────────────────
function DeviceScreen({ app, className = '', big }) {
  const t = themeById(app.theme);
  const dark = t.ink === 'light';
  const chrome = dark ? 'bg-white/20' : 'bg-black/15';
  const inkMain = dark ? 'text-white' : 'text-neutral-900';
  const inkSub = dark ? 'text-white/70' : 'text-neutral-900/60';
  return (
    <div className={'relative overflow-hidden ' + className} style={{ background: `linear-gradient(135deg, ${t.from} 0%, ${t.to} 100%)` }}>
      {/* 브라우저 크롬 */}
      <div className="absolute inset-x-0 top-0 flex items-center gap-1.5 px-3.5" style={{ height: big ? 38 : 30 }}>
        <span className={'h-2 w-2 rounded-full ' + chrome}></span>
        <span className={'h-2 w-2 rounded-full ' + chrome}></span>
        <span className={'h-2 w-2 rounded-full ' + chrome}></span>
        <span className={'ml-2 hidden h-4 flex-1 max-w-[60%] rounded-full sm:block ' + chrome}></span>
      </div>
      {/* 화면 콘텐츠: 앱 타이포 */}
      <div className="flex h-full flex-col items-center justify-center px-5 pt-4 text-center">
        <div className={'font-extrabold tracking-tight leading-tight ' + inkMain} style={{ fontSize: big ? 30 : 19, textWrap: 'balance' }}>{app.name}</div>
        <div className={'mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ' + inkSub}>{app.subject} · {app.grades[0]}{app.grades.length > 1 ? ' 외' : ''}</div>
      </div>
      {/* 유리 반사광 */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 38%, rgba(255,255,255,0) 39%)' }}></div>
      {!app.isPublic ? (
        <span className="absolute right-2.5 top-2 inline-flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur">
          <LR.Lock size={10} /><span>비공개</span>
        </span>
      ) : null}
    </div>
  );
}

function AppCard({ app, onOpen }) {
  return (
    <button onClick={onOpen} className="card-r group block w-full overflow-hidden border border-neutral-200/80 bg-white text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-[0_14px_32px_-12px_rgba(15,76,129,0.22)]">
      {/* 모니터 베젤 */}
      <div className="p-2.5 pb-0">
        <DeviceScreen app={app} className="aspect-[16/10] rounded-[14px] ring-1 ring-black/[0.06] transition-transform duration-300" />
      </div>
      <div className="px-4 pb-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold tracking-tight text-neutral-900">{app.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-neutral-500">
              <Avatar name={app.owner} size={16} /><span className="truncate">{app.owner}</span>
            </div>
          </div>
          <StatusBadge status={app.status} checking={app.checking} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip tone="blue">{app.subject}</Chip>
          {app.grades.slice(0, 3).map((g) => <Chip key={g}>{g}</Chip>)}
          {app.grades.length > 3 ? <Chip>+{app.grades.length - 3}</Chip> : null}
        </div>
      </div>
    </button>
  );
}

function EmptyState({ icon: Icon, title, desc, children }) {
  const I = Icon || LR.Inbox;
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-300 bg-white/60 px-6 py-16 text-center">
      <span className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400"><I size={22} /></span>
      <div className="text-[15px] font-bold text-neutral-700">{title}</div>
      {desc ? <div className="mt-1 max-w-xs text-[13px] leading-relaxed text-neutral-500">{desc}</div> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}

function SpecCell({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-neutral-200/70 py-3 last:border-0">
      <div className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">{label}</div>
      <div className="break-keep text-right text-[13px] font-semibold leading-snug text-neutral-700">{value || '—'}</div>
    </div>
  );
}

Object.assign(window, { LR, Chip, StatusBadge, Btn, Field, inputCls, Toggle, CopyButton, Avatar, DeviceScreen, AppCard, EmptyState, SpecCell });
