import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Btn, Chip, EmptyState } from "../../components/ui";
import { ServiceError } from "../../services/service-error";

export function AuthView({
  mode,
  routeError,
  authStatus,
  authError,
  onRetry,
  onLogin,
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  if (routeError) {
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="alert" aria-live="assertive">
          <EmptyState
            title="로그인 주소를 확인해 주세요"
            desc="인증 모드나 돌아갈 주소가 유효하지 않습니다."
          >
            <Link
              to="/auth?mode=login"
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              로그인 주소 초기화
            </Link>
          </EmptyState>
        </div>
      </main>
    );
  }

  if (authStatus === "checking" || authStatus === "error") {
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div
          role={authStatus === "checking" ? "status" : "alert"}
          aria-live="polite"
        >
          <EmptyState
            title={
              authStatus === "checking"
                ? "로그인 상태를 확인하고 있어요"
                : "로그인 상태를 확인할 수 없어요"
            }
            desc={
              authStatus === "checking"
                ? "잠시만 기다려 주세요."
                : authError?.message || "연결을 확인하고 다시 시도해 주세요."
            }
          >
            {authStatus === "error" ? (
              <Btn onClick={onRetry}>다시 확인</Btn>
            ) : null}
          </EmptyState>
        </div>
      </main>
    );
  }

  if (mode !== "login") {
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title={
              mode === "signup"
                ? "신규 가입은 아직 제공하지 않아요"
                : "이 인증 기능은 아직 제공하지 않아요"
            }
            desc="기존 합성 계정으로 로그인할 수 있습니다."
          >
            <Link
              to="/auth?mode=login"
              className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
            >
              로그인으로 돌아가기
            </Link>
          </EmptyState>
        </div>
      </main>
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || pending) return;
    const errors = {};
    const normalizedLoginId = loginId.trim().normalize("NFC");
    if (!normalizedLoginId) errors.loginId = "로그인 아이디를 입력해 주세요.";
    else if (
      Array.from(normalizedLoginId).length < 2 ||
      Array.from(normalizedLoginId).length > 32 ||
      !/^[가-힣A-Za-z0-9_.-]+$/u.test(normalizedLoginId)
    )
      errors.loginId = "로그인 아이디를 확인해 주세요.";
    if (!password) errors.password = "비밀번호를 입력해 주세요.";
    setFieldErrors(errors);
    setMessage("");
    if (Object.keys(errors).length) return;

    submitting.current = true;
    setPending(true);
    try {
      await onLogin({ loginId: normalizedLoginId, password });
    } catch (error) {
      const text =
        error instanceof ServiceError && error.code === "INVALID_CREDENTIALS"
          ? "로그인 아이디 또는 비밀번호를 확인해 주세요."
          : error instanceof ServiceError &&
              error.code === "ACCOUNT_NOT_APPROVED"
            ? error.message
            : error instanceof ServiceError &&
                error.code === "ALREADY_AUTHENTICATED"
              ? error.message
              : "로그인하지 못했어요. 연결을 확인해 주세요.";
      setMessage(text);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pb-24 pt-14"
      data-screen-label="로그인"
    >
      <span className="acc-bg mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-lg shadow-[#4C7A96]/25">
        <span className="text-[17px] font-extrabold tracking-tight">EV</span>
      </span>
      <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
        다시 만나서 반가워요
      </h1>
      <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-neutral-500">
        로그인 아이디와 별명은 구분하여 관리합니다.
      </p>

      <div className="mt-7 grid w-full grid-cols-2 gap-1 rounded-full bg-neutral-200/60 p-1">
        <button
          type="button"
          aria-pressed="true"
          className="h-9 rounded-full bg-white text-[13.5px] font-semibold text-neutral-900 shadow-sm"
        >
          로그인
        </button>
        <Link
          to="/auth?mode=signup"
          className="flex h-9 items-center justify-center rounded-full text-[13.5px] font-semibold text-neutral-500 hover:text-neutral-700"
        >
          회원가입
        </Link>
      </div>

      <form
        onSubmit={submit}
        aria-busy={pending}
        className="mt-5 flex w-full flex-col gap-3.5 rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.08)]"
      >
        <div>
          <label
            htmlFor="login-id"
            className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
          >
            로그인 아이디
          </label>
          <input
            id="login-id"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            placeholder={
              __DATA_MODE__ === "mock" ? "예: 교사김코딩" : "로그인 아이디"
            }
            autoComplete="username"
            aria-invalid={fieldErrors.loginId ? "true" : undefined}
            aria-describedby={
              fieldErrors.loginId ? "login-id-error" : undefined
            }
          />
          {fieldErrors.loginId ? (
            <p id="login-id-error" className="mt-1 text-[12px] text-red-700">
              {fieldErrors.loginId}
            </p>
          ) : null}
        </div>
        <div>
          <label
            htmlFor="login-password"
            className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
          >
            비밀번호
          </label>
          <input
            id="login-password"
            type="password"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••"
            autoComplete="current-password"
            aria-invalid={fieldErrors.password ? "true" : undefined}
            aria-describedby={
              fieldErrors.password ? "password-error" : undefined
            }
          />
          {fieldErrors.password ? (
            <p id="password-error" className="mt-1 text-[12px] text-red-700">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
        {message ? (
          <div
            role="alert"
            aria-live="assertive"
            className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[12.5px] font-medium leading-relaxed text-red-700"
          >
            <span>{message}</span>
          </div>
        ) : null}
        <Btn type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
          {pending ? "로그인 중…" : "로그인"}
        </Btn>
      </form>

      {__DATA_MODE__ === "mock" ? (
        <div className="mt-5 w-full rounded-2xl border border-neutral-200/70 bg-white/70 px-4 py-3.5">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400">
            데모 계정
          </div>
          <div className="grid gap-1.5 text-[12.5px] text-neutral-600">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">admin / admin123</span>
              <Chip tone="blue">관리자</Chip>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">교사김코딩 / 1234</span>
              <Chip tone="mint">승인됨</Chip>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">비기너개발자 / 1234</span>
              <Chip tone="yellow">승인 대기</Chip>
            </div>
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-neutral-400">
            이 계정과 비밀번호는 개발용 mock에서만 사용할 수 있습니다.
          </p>
        </div>
      ) : null}
    </main>
  );
}
