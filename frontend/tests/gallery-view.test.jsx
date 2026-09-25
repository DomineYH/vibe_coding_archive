import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { GalleryView } from "../src/features/gallery/view-gallery";
import { StatusBadge } from "../src/components/ui";
import { appsService } from "../src/services/mock/apps";
import { ServiceError } from "../src/services/service-error";

describe("connection result badge", () => {
  it("uses the result terminology for speech and keeps the visible label", () => {
    render(<StatusBadge state="healthy" />);

    const badge = screen.getByLabelText("연결 결과: 정상");
    expect(badge).toHaveTextContent("정상");
  });
});

describe("public gallery states", () => {
  it("announces initial loading without showing the empty-results message", () => {
    render(
      <MemoryRouter>
        <GalleryView
          meta={undefined}
          page={undefined}
          onQueryChange={() => {}}
          loading
          retry={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "공개 아카이브를 불러오는 중이에요",
    );
    expect(
      screen.queryByText("조건에 맞는 앱이 없어요"),
    ).not.toBeInTheDocument();
  });

  it("keeps Korean IME composition out of search requests until composition ends", async () => {
    const meta = await appsService.getMeta();
    const page = await appsService.list({ limit: 24, offset: 0 });
    const onQueryChange = vi.fn();
    render(
      <MemoryRouter>
        <GalleryView
          meta={meta}
          page={page}
          onQueryChange={onQueryChange}
          loading={false}
          retry={() => {}}
        />
      </MemoryRouter>,
    );
    const input = screen.getByRole("textbox", { name: "앱·작성자 검색" });
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "분수" } });
    expect(onQueryChange).toHaveBeenLastCalledWith({
      q: undefined,
      subject: undefined,
      grade: undefined,
    });
    fireEvent.compositionEnd(input, { data: "분수" });
    expect(onQueryChange).toHaveBeenLastCalledWith({
      q: "분수",
      subject: undefined,
      grade: undefined,
    });
  });

  it("shows a failure separately and retries only after an explicit action", () => {
    const retry = vi.fn();
    const error = new ServiceError(
      "SERVICE_UNAVAILABLE",
      "목록을 불러오지 못했어요.",
    );
    render(
      <MemoryRouter>
        <GalleryView
          meta={undefined}
          page={undefined}
          onQueryChange={() => {}}
          error={error}
          loading={false}
          retry={retry}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "공개 아카이브를 불러오지 못했어요",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
