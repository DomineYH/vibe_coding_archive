import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { Btn } from "../../components/ui";
import { readMockScenario, resetMockState, setMockScenario } from "./state";

export default function MockResetPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [scenario, setScenario] = useState(() => {
    try {
      return readMockScenario();
    } catch {
      return "original";
    }
  });
  const [message, setMessage] = useState("");
  const [readFailed, setReadFailed] = useState(() => {
    try {
      readMockScenario();
      return false;
    } catch {
      return true;
    }
  });

  const chooseScenario = (value) => {
    try {
      setMockScenario(value);
      setScenario(value);
      setReadFailed(false);
      setMessage("시나리오를 저장했어요. 공개 갤러리에서 확인할 수 있습니다.");
    } catch (error) {
      setMessage(error.message || "시나리오를 저장하지 못했어요.");
    }
  };

  const reset = () => {
    try {
      resetMockState();
      queryClient.clear();
      navigate("/");
    } catch (error) {
      setMessage(error.message || "mock 저장 데이터를 초기화하지 못했어요.");
    }
  };

  return (
    <main className="mx-auto w-full max-w-[760px] px-5 pb-24 pt-12 sm:px-8">
      <section className="rounded-3xl border border-neutral-200/80 bg-white p-6 sm:p-8">
        <span className="acc-text text-[11.5px] font-bold uppercase tracking-[0.22em]">
          Development only
        </span>
        <h1 className="mt-2 text-[26px] font-extrabold tracking-tight text-neutral-900">
          mock 저장 관리
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-neutral-500">
          이 페이지는 현재 origin의 개발용 mock 데이터만 관리합니다. 저장된
          데이터가 손상된 경우에도 아래 버튼을 누르기 전까지 초기화하지
          않습니다.
        </p>

        <label
          className="mt-6 block text-[13px] font-semibold text-neutral-800"
          htmlFor="mock-scenario"
        >
          갤러리 시나리오
        </label>
        <select
          id="mock-scenario"
          value={scenario}
          disabled={readFailed}
          onChange={(event) => chooseScenario(event.target.value)}
          className="mt-1.5 h-10 w-full rounded-xl border border-neutral-200 bg-white px-3 text-[14px] text-neutral-800 outline-none focus-visible:ring-2 focus-visible:ring-[#4C7A96] disabled:bg-neutral-100"
        >
          <option value="original">원본 비교 fixture</option>
          <option value="empty">정상 빈 결과</option>
          <option value="list_failure">목록 조회 실패</option>
        </select>
        {readFailed ? (
          <p className="mt-2 text-[13px] text-red-700" role="alert">
            저장된 mock을 읽지 못했습니다. 아래의 명시적 초기화만 사용할 수
            있습니다.
          </p>
        ) : null}
        {message ? (
          <p className="mt-2 text-[13px] text-neutral-600" role="status">
            {message}
          </p>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-2">
          <Btn onClick={reset}>기본 fixture로 명시적 초기화</Btn>
          <Link
            to="/"
            className="inline-flex h-10 items-center rounded-full px-4 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-100"
          >
            갤러리로
          </Link>
        </div>
      </section>
    </main>
  );
}
