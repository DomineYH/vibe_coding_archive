import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Btn, Chip, EmptyState } from "../../components/ui";
import { ServiceError } from "../../services/service-error";

const registrationErrorFields = {
  login_id: "loginId",
  password: "password",
  nickname: "nickname",
  email: "email",
  phone: "phone",
};

// Korea has no DST, so a fixed +9h shift is exact and independent of host ICU data.
function koreanClock(date) {
  const seoul = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return `${seoul.getUTCHours()}시 ${String(seoul.getUTCMinutes()).padStart(2, "0")}분`;
}

function loginFailureMessage(error) {
  if (!(error instanceof ServiceError))
    return "로그인하지 못했어요. 연결을 확인해 주세요.";
  switch (error.code) {
    case "INVALID_CREDENTIALS":
      return "로그인 아이디 또는 비밀번호를 확인해 주세요.";
    case "TEMP_PASSWORD_EXPIRED":
    case "ACCOUNT_NOT_APPROVED":
    case "ALREADY_AUTHENTICATED":
      return error.message;
    case "RATE_LIMITED": {
      const retryAt = error.retryAt ? new Date(error.retryAt) : null;
      return retryAt && !Number.isNaN(retryAt.getTime())
        ? `로그인 시도가 너무 많아요. ${koreanClock(retryAt)} 이후에 다시 시도해 주세요.`
        : "로그인 시도가 너무 많아요. 잠시 뒤에 다시 시도해 주세요.";
    }
    case "AUTH_STATE_CHANGED":
      return "계정 상태가 바뀌었어요. 다시 로그인해 주세요.";
    case "AUTH_BUSY":
    case "DB_BUSY":
      return "서버가 바빠요. 잠시 뒤에 다시 시도해 주세요.";
    default:
      return "로그인하지 못했어요. 연결을 확인해 주세요.";
  }
}

function getRegistrationFieldErrors(error) {
  if (!(error instanceof ServiceError)) return {};
  const fields = {};
  for (const [key, message] of Object.entries(error.fields ?? {})) {
    const name = registrationErrorFields[key];
    if (name) fields[name] = message;
  }
  if (error.code === "LOGIN_ID_TAKEN" && !fields.loginId)
    fields.loginId = error.message;
  return fields;
}

function formatPendingExpiry(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}

function PasswordChangeCard({ expiresAt, onChangePassword }) {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || pending) return;
    const nextPassword = password.normalize("NFC");
    const confirmation = passwordConfirm.normalize("NFC");
    const errors = {};
    const length = Array.from(nextPassword).length;
    if (length < 15 || length > 128)
      errors.password = "비밀번호는 15~128자로 입력해 주세요.";
    if (!confirmation)
      errors.passwordConfirm = "비밀번호를 한 번 더 입력해 주세요.";
    else if (nextPassword !== confirmation)
      errors.passwordConfirm = "비밀번호 확인이 일치하지 않습니다.";
    setFieldErrors(errors);
    setMessage("");
    if (Object.keys(errors).length) return;

    submitting.current = true;
    setPending(true);
    try {
      await onChangePassword({ password });
    } catch (error) {
      const passwordError =
        error instanceof ServiceError ? error.fields?.password : null;
      setFieldErrors(passwordError ? { password: passwordError } : {});
      setMessage(
        passwordError
          ? ""
          : error instanceof ServiceError
            ? error.message
            : "비밀번호를 변경하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pb-24 pt-14 sm:px-8"
      data-screen-label="비밀번호 변경"
    >
      <span className="acc-bg mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-lg shadow-[#4C7A96]/25">
        <span className="text-[17px] font-extrabold tracking-tight">EV</span>
      </span>
      <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
        비밀번호를 변경해 주세요
      </h1>
      <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-neutral-500">
        임시 비밀번호를 대신할 본인 비밀번호를 정한 뒤 회원 기능을 사용할 수
        있습니다.
      </p>
      <p
        className="mt-4 rounded-xl bg-[#4C7A96]/[0.06] px-3.5 py-2.5 text-center text-[12px] leading-relaxed text-neutral-600"
        role="status"
      >
        변경 전용 로그인은 {formatPendingExpiry(expiresAt)}까지 유효합니다.
      </p>
      <form
        onSubmit={submit}
        aria-busy={pending}
        className="mt-5 flex w-full flex-col gap-3.5 rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.08)]"
      >
        <div>
          <label
            htmlFor="new-password"
            className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
          >
            새 비밀번호{" "}
            <span className="font-normal text-neutral-400">(필수)</span>
          </label>
          <input
            id="new-password"
            type="password"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
            autoComplete="new-password"
            aria-required="true"
            aria-invalid={fieldErrors.password ? "true" : undefined}
            aria-describedby={`new-password-hint${fieldErrors.password ? " new-password-error" : ""}`}
          />
          <p
            id="new-password-hint"
            className="mt-1 text-[11px] text-neutral-400"
          >
            15~128자 · 공백은 유지되며 NFC로 정규화됩니다.
          </p>
          {fieldErrors.password ? (
            <p
              id="new-password-error"
              className="mt-1 text-[12px] text-red-700"
            >
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
        <div>
          <label
            htmlFor="new-password-confirm"
            className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
          >
            새 비밀번호 확인{" "}
            <span className="font-normal text-neutral-400">(필수)</span>
          </label>
          <input
            id="new-password-confirm"
            type="password"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={passwordConfirm}
            onChange={(event) => setPasswordConfirm(event.target.value)}
            disabled={pending}
            autoComplete="new-password"
            aria-required="true"
            aria-invalid={fieldErrors.passwordConfirm ? "true" : undefined}
            aria-describedby={
              fieldErrors.passwordConfirm
                ? "new-password-confirm-error"
                : undefined
            }
          />
          {fieldErrors.passwordConfirm ? (
            <p
              id="new-password-confirm-error"
              className="mt-1 text-[12px] text-red-700"
            >
              {fieldErrors.passwordConfirm}
            </p>
          ) : null}
        </div>
        {message ? (
          <div
            role="alert"
            aria-live="assertive"
            className="text-[12.5px] text-red-700"
          >
            {message}
          </div>
        ) : null}
        <Btn type="submit" size="lg" className="mt-1 w-full" disabled={pending}>
          {pending ? "비밀번호 변경 중…" : "비밀번호 변경"}
        </Btn>
      </form>
    </main>
  );
}

function ReauthenticationCard({
  authUser,
  authStatus,
  authError,
  returnTo,
  resumeState,
  onRetry,
  onResolveAuth,
  onResetAuth,
  onReauthenticate,
}) {
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const canReauthenticate =
    authUser?.role === "admin" &&
    authUser.approved &&
    authUser.sessionKind === "full" &&
    !authUser.mustChangePassword;

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || pending) return;
    if (!password) {
      setMessage("관리자 비밀번호를 입력해 주세요.");
      return;
    }
    const currentPassword = password;
    setPassword("");
    setMessage("");
    submitting.current = true;
    setPending(true);
    try {
      await onReauthenticate(
        { password: currentPassword },
        returnTo,
        resumeState,
      );
    } catch (error) {
      setMessage(
        error instanceof ServiceError && error.code === "INVALID_CREDENTIALS"
          ? "관리자 비밀번호를 확인해 주세요. 현재 로그인은 유지됩니다."
          : error instanceof Error
            ? error.message
            : "관리자 재인증을 완료하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  if (authStatus === "checking")
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title="관리자 인증 상태를 확인하고 있어요"
            desc="민감한 작업을 다시 진행하기 전에 현재 로그인 상태를 확인합니다."
          />
        </div>
      </main>
    );

  if (authStatus === "error" || authStatus === "unresolved")
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div
          role={authStatus === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <EmptyState
            title={
              authStatus === "error"
                ? "관리자 인증 상태를 확인할 수 없어요"
                : "관리자 인증 결과를 확인할 수 없어요"
            }
            desc={authError?.message || "연결을 확인하고 다시 시도해 주세요."}
          >
            <div className="flex flex-wrap justify-center gap-2">
              {authStatus === "unresolved" ? (
                <Btn onClick={onResolveAuth}>결과 확인</Btn>
              ) : (
                <Btn onClick={onRetry}>다시 확인</Btn>
              )}
              <Btn variant="line" onClick={onResetAuth}>
                인증 흐름 초기화
              </Btn>
            </div>
          </EmptyState>
        </div>
      </main>
    );

  if (!canReauthenticate)
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="alert" aria-live="assertive">
          <EmptyState
            title="현재 로그인한 관리자가 필요해요"
            desc="관리자 계정으로 로그인한 뒤 다시 시도해 주세요."
          >
            <Link
              to="/auth?mode=login&return_to=%2Fadmin"
              className="inline-flex h-10 items-center rounded-full bg-neutral-900 px-4 text-[13px] font-semibold text-white"
            >
              관리자 로그인
            </Link>
          </EmptyState>
        </div>
      </main>
    );

  return (
    <main
      className="mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pb-24 pt-14 sm:px-8"
      data-screen-label="관리자 재인증"
    >
      <span className="acc-bg mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-lg shadow-[#4C7A96]/25">
        <span className="text-[17px] font-extrabold tracking-tight">EV</span>
      </span>
      <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
        관리자 본인 확인
      </h1>
      <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-neutral-500">
        민감한 계정 작업을 위해 현재 관리자 비밀번호를 다시 확인해 주세요.
      </p>
      <form
        onSubmit={submit}
        aria-busy={pending}
        className="mt-7 flex w-full flex-col gap-3.5 rounded-3xl border border-neutral-200/80 bg-white p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.08)]"
      >
        <div>
          <label
            htmlFor="reauth-password"
            className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
          >
            현재 관리자 비밀번호
          </label>
          <input
            id="reauth-password"
            type="password"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
            autoComplete="current-password"
            aria-required="true"
            aria-invalid={message ? "true" : undefined}
            aria-describedby={message ? "reauth-error" : undefined}
          />
        </div>
        <p
          className="text-[11.5px] leading-relaxed text-neutral-500"
          role="note"
        >
          재인증 성공만으로 회원 작업은 실행되지 않습니다. 돌아온 뒤 현재 대상
          상태를 다시 확인하고 명시적으로 진행해 주세요.
        </p>
        {message ? (
          <p
            id="reauth-error"
            role="alert"
            aria-live="assertive"
            className="text-[12.5px] text-red-700"
          >
            {message}
          </p>
        ) : null}
        <Btn type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? "재인증 중…" : "본인 확인"}
        </Btn>
        <Link
          to={returnTo}
          state={
            resumeState?.adminReset?.operationKey ||
            resumeState?.adminDelete?.operationKey
              ? resumeState
              : null
          }
          className="inline-flex min-h-10 items-center justify-center rounded-full text-[12.5px] font-semibold text-neutral-500"
        >
          취소하고 돌아가기
        </Link>
      </form>
    </main>
  );
}

export function AuthView({
  mode,
  authUser,
  routeError,
  authStatus,
  authError,
  onRetry,
  onLogin,
  onRegister,
  onChangePassword,
  onReauthenticate,
  returnTo,
  reauthState,
  onResolveAuth,
  onResetAuth,
  onDiscardMissingSession,
  canDiscardMissingSession,
}) {
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [registered, setRegistered] = useState(null);
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

  if (authStatus === "unavailable")
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title="인증 기능은 아직 준비 중이에요"
            desc="API 모드에서는 로그인과 회원가입을 사용할 수 없어요."
          />
        </div>
      </main>
    );

  if (mode === "reauth" && !(authStatus === "ready" && !authUser))
    return (
      <ReauthenticationCard
        authUser={authUser}
        authStatus={authStatus}
        authError={authError}
        returnTo={returnTo}
        resumeState={reauthState}
        onRetry={onRetry}
        onResolveAuth={onResolveAuth}
        onResetAuth={onResetAuth}
        onReauthenticate={onReauthenticate}
      />
    );

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
              <>
                <Btn onClick={onRetry}>다시 확인</Btn>
                {__DATA_MODE__ === "api" &&
                [
                  "AUTH_STATE_CHANGED",
                  "AUTH_REQUIRED",
                  "RECOVERY_REQUIRED",
                ].includes(authError?.code) ? (
                  <Btn variant="line" onClick={onResetAuth}>
                    브라우저 인증 초기화
                  </Btn>
                ) : null}
              </>
            ) : null}
          </EmptyState>
        </div>
      </main>
    );
  }

  if (authStatus === "unresolved") {
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title="인증 결과를 확인할 수 없어요"
            desc="보호된 화면은 잠겨 있습니다. 결과를 다시 확인하거나 인증 흐름을 초기화해 주세요."
          >
            <div className="flex flex-wrap justify-center gap-2">
              <Btn onClick={onResolveAuth}>결과 확인</Btn>
              {canDiscardMissingSession ? (
                <Btn variant="line" onClick={onDiscardMissingSession}>
                  받지 못한 세션 버리기
                </Btn>
              ) : null}
              <Btn variant="line" onClick={onResetAuth}>
                인증 흐름 초기화
              </Btn>
            </div>
          </EmptyState>
        </div>
      </main>
    );
  }

  if (mode === "password-change") {
    if (authUser?.sessionKind !== "change_only" || !authUser.mustChangePassword)
      return (
        <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
          <div role="status" aria-live="polite">
            <EmptyState
              title="비밀번호 변경 전용 로그인이 필요해요"
              desc="임시 비밀번호로 로그인한 뒤 본인 비밀번호를 변경할 수 있습니다."
            >
              <Link
                to="/auth?mode=login"
                className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold"
              >
                로그인 화면으로
              </Link>
            </EmptyState>
          </div>
        </main>
      );
    return (
      <PasswordChangeCard
        key={authUser.id}
        expiresAt={authUser.expiresAt}
        onChangePassword={onChangePassword}
      />
    );
  }

  if (mode !== "login" && mode !== "signup") {
    return (
      <main className="mx-auto w-full max-w-[420px] px-5 pb-24 pt-14 sm:px-8">
        <div role="status" aria-live="polite">
          <EmptyState
            title="이 인증 기능은 아직 제공하지 않아요"
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

  if (registered && mode === "signup") {
    return (
      <main
        className="mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pb-24 pt-14"
        data-screen-label="가입 승인 대기"
      >
        <span className="acc-bg mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-lg shadow-[#4C7A96]/25">
          <span className="text-[17px] font-extrabold tracking-tight">EV</span>
        </span>
        <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
          가입 신청이 접수되었어요
        </h1>
        <section
          role="status"
          aria-live="polite"
          className="mt-7 w-full rounded-3xl border border-neutral-200/80 bg-white p-6 text-[13px] leading-relaxed text-neutral-600 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.08)]"
        >
          <p className="font-semibold text-neutral-800">
            관리자가 수동으로 승인한 뒤 로그인할 수 있습니다. 자동 로그인되지
            않았습니다.
          </p>
          <p className="mt-3">
            최초 승인 대기는 가입일부터 90일이며, 이 신청은{" "}
            <strong className="text-neutral-900">
              {formatPendingExpiry(registered.pendingExpiresAt)} (KST)
            </strong>
            에 만료됩니다.
          </p>
          <p className="mt-3">
            승인을 요청하려면 로그인 아이디, 국내 성인 교육 관계자라는 자기진술,
            교육 목적 한 문장을 운영자에게 전달해 주세요. 운영 문의 주소는 현재
            설정되지 않았습니다.
          </p>
          <Link
            to="/auth?mode=login"
            className="mt-5 inline-flex h-10 items-center rounded-full bg-neutral-900 px-4 text-[13px] font-semibold text-white"
          >
            로그인 화면으로
          </Link>
        </section>
      </main>
    );
  }

  async function submit(event) {
    event.preventDefault();
    if (submitting.current || pending) return;
    if (mode === "signup") {
      const normalizedPassword = password.normalize("NFC");
      const normalizedConfirm = passwordConfirm.normalize("NFC");
      const errors = {};
      if (!normalizedConfirm)
        errors.passwordConfirm = "비밀번호를 한 번 더 입력해 주세요.";
      else if (normalizedPassword !== normalizedConfirm)
        errors.passwordConfirm = "비밀번호 확인이 일치하지 않습니다.";
      setFieldErrors(errors);
      setMessage("");
      if (Object.keys(errors).length) return;

      submitting.current = true;
      setPending(true);
      try {
        const result = await onRegister({
          loginId,
          password,
          nickname,
          email,
          phone,
        });
        setRegistered(result);
        setPassword("");
        setPasswordConfirm("");
      } catch (error) {
        const fieldErrors = getRegistrationFieldErrors(error);
        setFieldErrors(fieldErrors);
        setMessage(
          Object.keys(fieldErrors).length
            ? ""
            : error instanceof ServiceError &&
                error.code === "ALREADY_AUTHENTICATED"
              ? error.message
              : "가입 신청을 보내지 못했어요. 입력을 보존했으니 연결을 확인하고 다시 시도해 주세요.",
        );
      } finally {
        submitting.current = false;
        setPending(false);
      }
      return;
    }

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
      setMessage(loginFailureMessage(error));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <main
      className="mx-auto flex w-full max-w-[420px] flex-col items-center px-5 pb-24 pt-14"
      data-screen-label={mode === "login" ? "로그인" : "회원가입"}
    >
      <span className="acc-bg mb-5 inline-flex h-14 w-14 items-center justify-center rounded-[18px] text-white shadow-lg shadow-[#4C7A96]/25">
        <span className="text-[17px] font-extrabold tracking-tight">EV</span>
      </span>
      <h1 className="text-[26px] font-extrabold tracking-tight text-neutral-900">
        {mode === "login" ? "다시 만나서 반가워요" : "아카이브에 합류하기"}
      </h1>
      <p className="mt-1.5 text-center text-[13.5px] leading-relaxed text-neutral-500">
        {mode === "login"
          ? "로그인 아이디와 별명은 구분하여 관리합니다."
          : "가입 신청은 관리자의 수동 승인 후 이용할 수 있습니다."}
      </p>

      <div className="mt-7 grid w-full grid-cols-2 gap-1 rounded-full bg-neutral-200/60 p-1">
        <Link
          to="/auth?mode=login"
          aria-current={mode === "login" ? "page" : undefined}
          className={`flex h-9 items-center justify-center rounded-full text-[13.5px] font-semibold ${mode === "login" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
        >
          로그인
        </Link>
        <Link
          to="/auth?mode=signup"
          aria-current={mode === "signup" ? "page" : undefined}
          className={`flex h-9 items-center justify-center rounded-full text-[13.5px] font-semibold ${mode === "signup" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
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
            {mode === "signup" ? (
              <span className="font-normal text-neutral-400"> (필수)</span>
            ) : null}
          </label>
          <input
            id="login-id"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={loginId}
            onChange={(event) => setLoginId(event.target.value)}
            disabled={pending}
            placeholder={
              __DATA_MODE__ === "mock" ? "예: 교사김코딩" : "로그인 아이디"
            }
            autoComplete="username"
            aria-required={mode === "signup" ? "true" : undefined}
            aria-invalid={fieldErrors.loginId ? "true" : undefined}
            aria-describedby={
              mode === "signup"
                ? `login-id-hint${fieldErrors.loginId ? " login-id-error" : ""}`
                : fieldErrors.loginId
                  ? "login-id-error"
                  : undefined
            }
          />
          {mode === "signup" ? (
            <p id="login-id-hint" className="mt-1 text-[11px] text-neutral-400">
              2~32자 · 한글, 영문, 숫자와 . _ - 사용
            </p>
          ) : null}
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
            {mode === "signup" ? (
              <span className="font-normal text-neutral-400"> (필수)</span>
            ) : null}
          </label>
          <input
            id="login-password"
            type="password"
            className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
            placeholder="••••••"
            autoComplete={
              mode === "login" ? "current-password" : "new-password"
            }
            aria-required={mode === "signup" ? "true" : undefined}
            aria-invalid={fieldErrors.password ? "true" : undefined}
            aria-describedby={
              mode === "signup"
                ? `password-hint${fieldErrors.password ? " password-error" : ""}`
                : fieldErrors.password
                  ? "password-error"
                  : undefined
            }
          />
          {mode === "signup" ? (
            <p id="password-hint" className="mt-1 text-[11px] text-neutral-400">
              15~128자 · 공백 포함 가능
            </p>
          ) : null}
          {fieldErrors.password ? (
            <p id="password-error" className="mt-1 text-[12px] text-red-700">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>
        {mode === "signup" ? (
          <>
            <div>
              <label
                htmlFor="password-confirm"
                className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
              >
                비밀번호 확인{" "}
                <span className="font-normal text-neutral-400">(필수)</span>
              </label>
              <input
                id="password-confirm"
                type="password"
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                disabled={pending}
                placeholder="••••••"
                autoComplete="new-password"
                aria-required="true"
                aria-invalid={fieldErrors.passwordConfirm ? "true" : undefined}
                aria-describedby={
                  fieldErrors.passwordConfirm
                    ? "password-confirm-error"
                    : undefined
                }
              />
              {fieldErrors.passwordConfirm ? (
                <p
                  id="password-confirm-error"
                  className="mt-1 text-[12px] text-red-700"
                >
                  {fieldErrors.passwordConfirm}
                </p>
              ) : null}
            </div>
            <div>
              <label
                htmlFor="nickname"
                className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
              >
                별명{" "}
                <span className="font-normal text-neutral-400">(필수)</span>
              </label>
              <input
                id="nickname"
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
                value={nickname}
                onChange={(event) => setNickname(event.target.value)}
                disabled={pending}
                autoComplete="nickname"
                aria-required="true"
                aria-invalid={fieldErrors.nickname ? "true" : undefined}
                aria-describedby={
                  fieldErrors.nickname ? "nickname-error" : undefined
                }
              />
              {fieldErrors.nickname ? (
                <p
                  id="nickname-error"
                  className="mt-1 text-[12px] text-red-700"
                >
                  {fieldErrors.nickname}
                </p>
              ) : null}
            </div>
            <div>
              <label
                htmlFor="email"
                className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
              >
                이메일{" "}
                <span className="font-normal text-neutral-400">(선택)</span>
              </label>
              <input
                id="email"
                type="text"
                inputMode="email"
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={pending}
                autoComplete="email"
                aria-invalid={fieldErrors.email ? "true" : undefined}
                aria-describedby={
                  fieldErrors.email ? "email-error" : "contact-hint"
                }
              />
              {fieldErrors.email ? (
                <p id="email-error" className="mt-1 text-[12px] text-red-700">
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>
            <div>
              <label
                htmlFor="phone"
                className="mb-1.5 block text-[12px] font-semibold text-neutral-700"
              >
                연락처{" "}
                <span className="font-normal text-neutral-400">(선택)</span>
              </label>
              <input
                id="phone"
                type="text"
                inputMode="tel"
                className="w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-shadow focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                disabled={pending}
                autoComplete="tel"
                aria-invalid={fieldErrors.phone ? "true" : undefined}
                aria-describedby={
                  fieldErrors.phone ? "phone-error" : "contact-hint"
                }
              />
              {fieldErrors.phone ? (
                <p id="phone-error" className="mt-1 text-[12px] text-red-700">
                  {fieldErrors.phone}
                </p>
              ) : null}
            </div>
            <p
              id="contact-hint"
              className="-mt-1 text-[11px] leading-relaxed text-neutral-400"
            >
              이메일·연락처는 선택이며 공개 화면에 표시되지 않습니다. 개발용
              mock에서는 가짜 비밀번호와 연락처만 사용해 주세요. 실제 수집
              기능은 비활성화되어 있습니다.
            </p>
          </>
        ) : null}
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
          {pending
            ? mode === "login"
              ? "로그인 중…"
              : "가입 신청 중…"
            : mode === "login"
              ? "로그인"
              : "가입 신청하기"}
        </Btn>
        {mode === "signup" ? (
          <p className="text-center text-[11.5px] leading-relaxed text-neutral-400">
            가입 즉시 로그인되지 않으며, 관리자 승인 후 이용할 수 있습니다.
          </p>
        ) : null}
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
