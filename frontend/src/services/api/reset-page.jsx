import { EmptyState } from "../../components/ui";

export default function MockResetPage() {
  return (
    <main className="mx-auto w-full max-w-[1280px] px-5 py-16 sm:px-8">
      <EmptyState
        title="mock reset은 개발 모드에서만 사용할 수 있어요"
        desc="API 빌드에는 mock 저장소나 초기화 기능이 포함되지 않습니다."
      />
    </main>
  );
}
