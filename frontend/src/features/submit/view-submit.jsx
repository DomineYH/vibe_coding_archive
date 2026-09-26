import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useBlocker } from "react-router-dom";
import { DeviceScreen, Btn } from "../../components/ui";
import {
  isAppInputDirty,
  normalizeAppInput,
} from "../../services/apps-service";
import { ServiceError } from "../../services/service-error";
import { appsService } from "@services/apps";

const emptyDraft = {
  name: "",
  url: "",
  prompt: "",
  description: "",
  subject: "",
  grades: [],
  isPublic: true,
  themeId: "niagara",
  stack: { db: "", backend: "", frontend: "", hosting: "" },
};

const inputClass =
  "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] text-neutral-900 placeholder:text-neutral-400 outline-none transition focus:border-[#4C7A96]/40 focus:ring-4 focus:ring-[#4C7A96]/10";

function Field({ id, label, required, hint, error, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <label
          htmlFor={id}
          className="text-[13px] font-semibold text-neutral-800"
        >
          {label}{" "}
          {required ? (
            <span aria-hidden="true" className="text-red-600">
              *
            </span>
          ) : null}
        </label>
        {hint ? (
          <span className="text-[11.5px] text-neutral-400">{hint}</span>
        ) : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-[12px] text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function isUncertain(error) {
  return error instanceof ServiceError && error.outcome === "unknown";
}

export function SubmitView({ meta, onCreated }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [operationKey, setOperationKey] = useState(null);
  const [pendingInput, setPendingInput] = useState(null);
  const [confirmedAppId, setConfirmedAppId] = useState(null);
  const allowNavigation = useRef(false);
  const savingLocked = saving || unknown;
  const dirty = isAppInputDirty(emptyDraft, draft);
  const shouldWarn = dirty || savingLocked;
  const blocker = useBlocker(
    useCallback(
      () => !allowNavigation.current && (dirty || saving || unknown),
      [dirty, saving, unknown],
    ),
  );
  const theme =
    meta.themes.find((item) => item.id === draft.themeId) ?? meta.themes[0];
  const preview = {
    name: draft.name.trim() || "앱 이름",
    subject: draft.subject || "과목",
    grades: draft.grades.length ? draft.grades : ["학년"],
    isPublic: draft.isPublic,
  };

  useEffect(() => {
    if (!confirmedAppId) return;
    if (blocker.state === "blocked") {
      blocker.reset();
      return;
    }
    allowNavigation.current = true;
    onCreated(confirmedAppId);
    setConfirmedAppId(null);
  }, [blocker, confirmedAppId, onCreated]);

  useEffect(() => {
    if (!shouldWarn) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [shouldWarn]);

  const setField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[field];
      return next;
    });
    setFormError("");
  };
  const setStack = (field, value) => {
    setDraft((current) => ({
      ...current,
      stack: { ...current.stack, [field]: value },
    }));
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[`stack.${field}`];
      return next;
    });
    setFormError("");
  };

  const openCreatedApp = (id) => {
    setConfirmedAppId(id);
  };

  const handleFailure = (error) => {
    if (isUncertain(error)) {
      setSaving(false);
      setUnknown(true);
      setFormError(error.message);
      return;
    }
    setSaving(false);
    setUnknown(false);
    setOperationKey(null);
    setPendingInput(null);
    if (error instanceof ServiceError) {
      setFieldErrors(error.fields ?? {});
      setFormError(
        error.fields ? "표시된 항목을 확인해 주세요." : error.message,
      );
    } else {
      setFormError("앱을 등록하지 못했어요. 다시 시도해 주세요.");
    }
  };

  const sendWithKey = async (input, key) => {
    setSaving(true);
    setUnknown(false);
    setFormError("");
    try {
      const app = await appsService.create(input, key);
      openCreatedApp(app.id);
    } catch (error) {
      handleFailure(error);
    } finally {
      setSaving(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (savingLocked) return;
    setFieldErrors({});
    setFormError("");
    let input;
    try {
      input = normalizeAppInput(draft);
    } catch (error) {
      if (error instanceof ServiceError) {
        setFieldErrors(error.fields ?? {});
        setFormError("표시된 항목을 확인해 주세요. 입력 내용은 유지됩니다.");
      } else {
        setFormError("입력 내용을 확인해 주세요.");
      }
      return;
    }
    setSaving(true);
    try {
      const operation = await appsService.issueCreateOperation(input);
      if (operation.state !== "unresolved" || operation.targetId !== null)
        throw new ServiceError(
          "CONTRACT_ERROR",
          "저장 작업을 확인할 수 없어요.",
        );
      setOperationKey(operation.key);
      setPendingInput(input);
      await sendWithKey(input, operation.key);
    } catch (error) {
      handleFailure(error);
    } finally {
      setSaving(false);
    }
  };

  const checkResult = async () => {
    if (!operationKey || !pendingInput) return;
    setSaving(true);
    setFormError("");
    try {
      const operation = await appsService.getCreateOperation(operationKey);
      if (operation.state === "succeeded" && operation.targetId) {
        openCreatedApp(operation.targetId);
      } else if (operation.state === "rejected") {
        handleFailure(
          new ServiceError(
            "VALIDATION_ERROR",
            "앱을 등록하지 못했어요. 입력 내용을 확인해 주세요.",
            { outcome: "rejected" },
          ),
        );
      } else {
        setFormError(
          "아직 저장 결과가 정해지지 않았어요. 결과를 확인한 뒤 다시 시도해 주세요.",
        );
      }
    } catch (error) {
      setFormError(
        error instanceof Error
          ? error.message
          : "저장 결과를 확인하지 못했어요.",
      );
    } finally {
      setSaving(false);
    }
  };

  const retrySameRequest = () => {
    if (operationKey && pendingInput)
      void sendWithKey(pendingInput, operationKey);
  };

  const toggleGrade = (grade) => {
    const selected = draft.grades.includes(grade);
    setField(
      "grades",
      selected
        ? draft.grades.filter((item) => item !== grade)
        : meta.grades.filter(
            (item) => item === grade || draft.grades.includes(item),
          ),
    );
  };

  return (
    <main
      className="mx-auto w-full max-w-[1080px] px-5 pb-24 pt-10 sm:px-8"
      data-screen-label="등록"
    >
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-tight text-neutral-900">
            새 앱 등록
          </h1>
          <p className="mt-1 text-[13.5px] text-neutral-500">
            프롬프트까지 공유하면 다른 선생님이 똑같이 다시 만들 수 있어요.
          </p>
        </div>
        <Link
          to="/"
          className="inline-flex h-8 shrink-0 items-center rounded-full px-3 text-[12.5px] font-semibold text-neutral-600 hover:bg-neutral-100"
        >
          취소
        </Link>
      </div>

      {formError ? (
        <div
          className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] font-medium text-red-700"
          role="alert"
        >
          {formError}
        </div>
      ) : null}

      <form
        noValidate
        onSubmit={submit}
        aria-label="새 앱 등록 양식"
        className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="flex min-w-0 flex-col gap-6">
          <fieldset disabled={savingLocked} className="contents">
            <section className="flex min-w-0 flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-5 sm:p-6">
              <h2 className="text-[14px] font-bold text-neutral-900">
                기본 정보
              </h2>
              <Field
                id="app-name"
                label="어플리케이션 이름"
                required
                error={fieldErrors.name}
              >
                <input
                  id="app-name"
                  className={inputClass}
                  value={draft.name}
                  onChange={(event) => setField("name", event.target.value)}
                  autoComplete="off"
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={
                    fieldErrors.name ? "app-name-error" : undefined
                  }
                  placeholder="예: 수학 수업 도구"
                />
              </Field>
              <Field
                id="app-url"
                label="배포 URL"
                required
                error={fieldErrors.url}
              >
                <input
                  id="app-url"
                  type="text"
                  inputMode="url"
                  className={inputClass}
                  value={draft.url}
                  onChange={(event) => setField("url", event.target.value)}
                  autoComplete="url"
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.url)}
                  aria-describedby={
                    fieldErrors.url ? "app-url-error" : undefined
                  }
                  placeholder="https://my-app.vercel.app"
                />
              </Field>
              <Field
                id="app-prompt"
                label="핵심 프롬프트"
                required
                hint="앱을 만들 때 AI에게 준 프롬프트"
                error={fieldErrors.prompt}
              >
                <textarea
                  id="app-prompt"
                  className={`${inputClass} min-h-[130px] resize-y py-2.5 font-mono text-[13px] leading-relaxed`}
                  value={draft.prompt}
                  onChange={(event) => setField("prompt", event.target.value)}
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.prompt)}
                  aria-describedby={
                    fieldErrors.prompt ? "app-prompt-error" : undefined
                  }
                  placeholder="AI에게 입력했던 핵심 프롬프트를 그대로 붙여넣어 주세요."
                />
              </Field>
              <Field
                id="app-description"
                label="상세 설명"
                required
                hint="어떤 수업 상황에 유용한지 매뉴얼 포함"
                error={fieldErrors.description}
              >
                <textarea
                  id="app-description"
                  className={`${inputClass} min-h-[130px] resize-y py-2.5 leading-relaxed`}
                  value={draft.description}
                  onChange={(event) =>
                    setField("description", event.target.value)
                  }
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.description)}
                  aria-describedby={
                    fieldErrors.description
                      ? "app-description-error"
                      : undefined
                  }
                  placeholder={
                    "어떤 단원·상황에서 쓰면 좋은지 적어 주세요.\n\n[활용 매뉴얼]\n1. …"
                  }
                />
              </Field>
            </section>

            <section className="flex min-w-0 flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-5 sm:p-6">
              <h2 className="text-[14px] font-bold text-neutral-900">분류</h2>
              <div>
                <div className="mb-2 text-[12.5px] font-semibold text-neutral-700">
                  교과 과목 <span className="text-red-600">*</span>
                </div>
                <div
                  role="group"
                  aria-label="교과 과목"
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.subject)}
                  aria-describedby={
                    fieldErrors.subject ? "subject-error" : undefined
                  }
                  className="flex flex-wrap gap-1.5"
                >
                  {meta.subjects.map((subject) => (
                    <button
                      key={subject}
                      type="button"
                      aria-pressed={draft.subject === subject}
                      onClick={() => setField("subject", subject)}
                      className={`h-9 rounded-full px-4 text-[13px] font-semibold transition-all ${draft.subject === subject ? "acc-bg text-white shadow-sm" : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                    >
                      {subject}
                    </button>
                  ))}
                </div>
                {fieldErrors.subject ? (
                  <p
                    id="subject-error"
                    className="mt-1.5 text-[12px] text-red-700"
                  >
                    {fieldErrors.subject}
                  </p>
                ) : null}
              </div>
              <div>
                <div className="mb-2 text-[12.5px] font-semibold text-neutral-700">
                  적용 가능 학년 <span className="text-red-600">*</span>
                  <span className="ml-1 font-normal text-neutral-400">
                    복수 선택 가능
                  </span>
                </div>
                <div
                  role="group"
                  aria-label="적용 가능 학년"
                  aria-required="true"
                  aria-invalid={Boolean(fieldErrors.grades)}
                  aria-describedby={
                    fieldErrors.grades ? "grades-error" : undefined
                  }
                  className="flex flex-wrap gap-1.5"
                >
                  {meta.grades.map((grade) => (
                    <button
                      key={grade}
                      type="button"
                      aria-pressed={draft.grades.includes(grade)}
                      onClick={() => toggleGrade(grade)}
                      className={`h-9 rounded-full px-3.5 text-[13px] font-semibold transition-all ${draft.grades.includes(grade) ? "bg-[#3C7A72] text-white shadow-sm" : "border border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}
                    >
                      {grade}
                    </button>
                  ))}
                </div>
                {fieldErrors.grades ? (
                  <p
                    id="grades-error"
                    className="mt-1.5 text-[12px] text-red-700"
                  >
                    {fieldErrors.grades}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="flex min-w-0 flex-col gap-4 rounded-3xl border border-neutral-200/80 bg-white p-5 sm:p-6">
              <h2 className="text-[14px] font-bold text-neutral-900">
                기술 스택
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {[
                  ["db", "DB", "예: Supabase (PostgreSQL)"],
                  ["backend", "백엔드 엔진", "예: Firebase Functions"],
                  ["frontend", "프론트엔드 프레임워크", "예: React + Vite"],
                  ["hosting", "호스팅 서비스", "예: Vercel"],
                ].map(([field, label, placeholder]) => (
                  <Field
                    key={field}
                    id={`stack-${field}`}
                    label={label}
                    error={fieldErrors[`stack.${field}`]}
                  >
                    <input
                      id={`stack-${field}`}
                      className={inputClass}
                      value={draft.stack[field]}
                      onChange={(event) => setStack(field, event.target.value)}
                      aria-invalid={Boolean(fieldErrors[`stack.${field}`])}
                      aria-describedby={
                        fieldErrors[`stack.${field}`]
                          ? `stack-${field}-error`
                          : undefined
                      }
                      placeholder={placeholder}
                    />
                  </Field>
                ))}
              </div>
            </section>
          </fieldset>
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <section className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <h2 className="mb-3 text-[12px] font-bold uppercase tracking-wider text-neutral-400">
              썸네일 미리보기
            </h2>
            <DeviceScreen
              app={preview}
              theme={theme}
              className="aspect-[16/10] rounded-2xl ring-1 ring-black/[0.06]"
            />
            <h3 className="mb-2.5 mt-5 text-[12px] font-bold uppercase tracking-wider text-neutral-400">
              Pantone 테마 컬러
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {meta.themes.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  disabled={savingLocked}
                  aria-label={`테마 ${item.name} 선택`}
                  aria-pressed={draft.themeId === item.id}
                  onClick={() => setField("themeId", item.id)}
                  className={`aspect-square rounded-xl ring-offset-2 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C7A96] ${draft.themeId === item.id ? "scale-105 ring-2 ring-[#4C7A96]" : "hover:scale-105"}`}
                  style={{
                    background: `linear-gradient(135deg, ${item.from}, ${item.to})`,
                  }}
                />
              ))}
            </div>
            <div className="mt-2.5 text-center text-[11.5px] font-semibold text-neutral-500">
              Pantone {theme?.pantone} · {theme?.name}
            </div>
          </section>

          <section className="rounded-3xl border border-neutral-200/80 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[13.5px] font-bold text-neutral-900">
                  {draft.isPublic ? "전체 공개" : "비공개"}
                </div>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-neutral-500">
                  {draft.isPublic
                    ? "모든 사용자가 열람할 수 있어요."
                    : "본인과 관리자만 볼 수 있어요."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="전체 공개"
                aria-checked={draft.isPublic}
                disabled={savingLocked}
                onClick={() => setField("isPublic", !draft.isPublic)}
                className={`relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4C7A96] disabled:opacity-50 ${draft.isPublic ? "bg-[#3C7A72]" : "bg-neutral-300"}`}
              >
                <span
                  className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${draft.isPublic ? "left-6" : "left-1"}`}
                />
              </button>
            </div>
          </section>

          <Btn
            type="submit"
            size="lg"
            className="w-full"
            disabled={savingLocked}
          >
            {saving ? "등록 중…" : unknown ? "결과 확인 중" : "아카이브에 등록"}
          </Btn>
          {unknown ? (
            <section
              className="-mt-4 flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4"
              aria-label="저장 결과 확인"
            >
              <p className="text-[12.5px] leading-relaxed text-amber-900">
                같은 요청만 다시 보낼 수 있어요. 먼저 결과를 확인해 주세요.
              </p>
              <Btn
                variant="line"
                onClick={() => void checkResult()}
                disabled={saving}
              >
                저장 결과 확인
              </Btn>
              <Btn onClick={retrySameRequest} disabled={saving}>
                같은 요청 다시 보내기
              </Btn>
            </section>
          ) : null}
        </aside>
      </form>

      {blocker.state === "blocked" ? (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-neutral-900/35 p-5"
          role="presentation"
        >
          <section
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="leave-submit-title"
            aria-describedby="leave-submit-description"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"
          >
            <h2
              id="leave-submit-title"
              className="text-[18px] font-bold text-neutral-900"
            >
              {saving
                ? "앱을 등록하고 있어요"
                : unknown
                  ? "저장 결과를 확인해 주세요"
                  : "작성 중인 내용이 있어요"}
            </h2>
            <p
              id="leave-submit-description"
              className="mt-2 text-[13px] leading-relaxed text-neutral-600"
            >
              {saving
                ? "저장이 끝날 때까지 이동할 수 없어요."
                : unknown
                  ? "결과가 확인될 때까지 이 화면을 유지해 주세요. 같은 요청을 다시 보내거나 결과를 확인할 수 있어요."
                  : "이 화면을 나가면 작성한 내용이 사라져요. 계속 작성할까요?"}
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {saving ? null : unknown ? (
                <>
                  <Btn
                    variant="line"
                    onClick={() => void checkResult()}
                    disabled={saving}
                  >
                    결과 확인
                  </Btn>
                  <Btn onClick={retrySameRequest} disabled={saving}>
                    같은 요청 다시 보내기
                  </Btn>
                </>
              ) : (
                <>
                  <Btn variant="line" onClick={() => blocker.reset()}>
                    계속 작성
                  </Btn>
                  <Btn variant="danger" onClick={() => blocker.proceed()}>
                    작성 취소하고 이동
                  </Btn>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
