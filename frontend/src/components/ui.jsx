import { Lock, SearchX } from "lucide-react";
import { Link } from "react-router-dom";

export function Btn({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  disabled,
}) {
  const base =
    "inline-flex select-none items-center justify-center gap-1.5 font-semibold transition-all duration-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";
  const sizes = {
    sm: "h-8 rounded-full px-3 text-[12.5px]",
    md: "h-10 rounded-full px-5 text-[13.5px]",
    lg: "h-12 rounded-full px-7 text-[15px]",
  };
  const variants = {
    primary: "acc-bg text-white shadow-sm hover:brightness-110 hover:shadow-md",
    soft: "acc-soft acc-text hover:brightness-[0.97]",
    ghost: "text-neutral-600 hover:bg-neutral-100",
    line: "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50",
    danger: "bg-[#9B3B41] text-white shadow-sm hover:brightness-110",
    mint: "bg-[#3C7A72] text-white shadow-sm hover:brightness-110",
  };
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={[base, sizes[size], variants[variant], className].join(" ")}
    >
      {children}
    </button>
  );
}

export function Chip({ children, tone = "gray" }) {
  const tones = {
    gray: "border-neutral-200 bg-neutral-100 text-neutral-600",
    blue: "border-[#4C7A96]/20 bg-[#4C7A96]/[0.10] text-[#31576C]",
    mint: "border-emerald-200 bg-emerald-50 text-emerald-700",
    yellow: "border-amber-200 bg-amber-50 text-amber-800",
    tomato: "border-red-200 bg-red-50 text-red-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium leading-5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ state, size = "sm" }) {
  const healthy = state === "healthy";
  const big = size === "md";
  const label = state === "unchecked" ? "미검사" : healthy ? "정상" : "오류";
  return (
    <span
      aria-label={`연결 결과: ${label}`}
      className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${big ? "px-3 py-1 text-[13px]" : "px-2.5 py-0.5 text-[11.5px]"} ${healthy ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${healthy ? "bg-emerald-600" : "bg-red-600"}`}
        aria-hidden="true"
      />
      <span>{label}</span>
    </span>
  );
}

export function Avatar({ name, size = 32 }) {
  return (
    <span
      aria-hidden="true"
      className="acc-bg inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
    >
      {(name || "?").slice(0, 1)}
    </span>
  );
}

export function DeviceScreen({ app, theme, className = "", big = false }) {
  const dark = theme.ink === "light";
  const chrome = dark ? "bg-white/20" : "bg-black/15";
  const inkMain = dark ? "text-white" : "text-neutral-900";
  const inkSub = dark ? "text-white/70" : "text-neutral-900/60";
  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        background: `linear-gradient(135deg, ${theme.from} 0%, ${theme.to} 100%)`,
      }}
    >
      <div
        className="absolute inset-x-0 top-0 flex items-center gap-1.5 px-3.5"
        style={{ height: big ? 38 : 30 }}
        aria-hidden="true"
      >
        <span className={`h-2 w-2 rounded-full ${chrome}`} />
        <span className={`h-2 w-2 rounded-full ${chrome}`} />
        <span className={`h-2 w-2 rounded-full ${chrome}`} />
        <span
          className={`ml-2 hidden h-4 max-w-[60%] flex-1 rounded-full sm:block ${chrome}`}
        />
      </div>
      <div className="flex h-full flex-col items-center justify-center px-5 pt-4 text-center">
        <div
          className={`font-extrabold leading-tight tracking-tight ${inkMain}`}
          style={{ fontSize: big ? 30 : 19, textWrap: "balance" }}
        >
          {app.name}
        </div>
        <div
          className={`mt-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] ${inkSub}`}
        >
          {app.subject} · {app.grades[0]}
          {app.grades.length > 1 ? " 외" : ""}
        </div>
      </div>
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(115deg, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.05) 38%, rgba(255,255,255,0) 39%)",
        }}
      />
      {!app.isPublic ? (
        <span className="absolute right-2.5 top-2 inline-flex items-center gap-1 rounded-full bg-black/35 px-2 py-0.5 text-[10.5px] font-semibold text-white backdrop-blur">
          <Lock size={10} aria-hidden="true" />
          비공개
        </span>
      ) : null}
    </div>
  );
}

export function AppCard({ app, theme, detailLinkState }) {
  return (
    <Link
      to={`/apps/${app.id}`}
      state={detailLinkState}
      aria-label={`${app.name}, ${app.owner}, ${app.subject} 상세 보기`}
      className="card-r group block w-full overflow-hidden border border-neutral-200/80 bg-white text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:border-neutral-300 hover:shadow-[0_14px_32px_-12px_rgba(15,76,129,0.22)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C7A96]"
    >
      <div className="p-2.5 pb-0">
        <DeviceScreen
          app={app}
          theme={theme}
          className="aspect-[16/10] rounded-[14px] ring-1 ring-black/[0.06] transition-transform duration-300"
        />
      </div>
      <div className="px-4 pb-4 pt-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[15px] font-bold tracking-tight text-neutral-900">
              {app.name}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-neutral-500">
              <Avatar name={app.owner} size={16} />
              <span className="truncate">{app.owner}</span>
            </div>
          </div>
          <StatusBadge state={app.health.result.state} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <Chip tone="blue">{app.subject}</Chip>
          {app.grades.slice(0, 3).map((grade) => (
            <Chip key={grade}>{grade}</Chip>
          ))}
          {app.grades.length > 3 ? <Chip>+{app.grades.length - 3}</Chip> : null}
        </div>
      </div>
    </Link>
  );
}

export function EmptyState({ title, desc, children }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-neutral-300 bg-white/60 px-6 py-16 text-center">
      <span
        className="mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400"
        aria-hidden="true"
      >
        <SearchX size={22} />
      </span>
      <div className="text-[15px] font-bold text-neutral-700">{title}</div>
      {desc ? (
        <div className="mt-1 max-w-xs text-[13px] leading-relaxed text-neutral-500">
          {desc}
        </div>
      ) : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
