import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

  it("keeps the focused subject filter mounted while its request is pending", async () => {
    const user = userEvent.setup();
    const meta = await appsService.getMeta();
    const page = await appsService.list({ limit: 24, offset: 0 });
    const onQueryChange = vi.fn();
    const props = {
      meta,
      page,
      onQueryChange,
      loading: false,
      retry: () => {},
    };
    const { rerender } = render(
      <MemoryRouter>
        <GalleryView {...props} />
      </MemoryRouter>,
    );
    const math = screen.getByRole("button", { name: "수학" });
    math.focus();
    await user.keyboard("{Enter}");
    expect(onQueryChange).toHaveBeenLastCalledWith(
      {
        q: undefined,
        subject: "수학",
        grade: undefined,
      },
      { replace: false },
    );

    rerender(
      <MemoryRouter>
        <GalleryView {...props} page={undefined} loading />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "수학" })).toHaveFocus();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("moves retry focus to the stable gallery region while loading", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    const error = new ServiceError("SERVICE_UNAVAILABLE", "목록 오류");
    const props = {
      meta: undefined,
      page: undefined,
      onQueryChange: () => {},
      retry,
    };
    const { rerender } = render(
      <MemoryRouter>
        <GalleryView {...props} error={error} loading={false} />
      </MemoryRouter>,
    );
    const retryButton = screen.getByRole("button", { name: "다시 시도" });
    retryButton.focus();
    await user.keyboard("{Enter}");
    expect(retry).toHaveBeenCalledOnce();

    rerender(
      <MemoryRouter>
        <GalleryView {...props} error={undefined} loading />
      </MemoryRouter>,
    );
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("keeps Korean IME composition out of search requests until composition ends", async () => {
    const meta = await appsService.getMeta();
    const page = await appsService.list({ limit: 24, offset: 0 });
    const onQueryChange = vi.fn();
    vi.useFakeTimers();
    try {
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
      expect(onQueryChange).not.toHaveBeenCalled();
      fireEvent.compositionEnd(input, { data: "분수" });
      expect(onQueryChange).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299);
      });
      expect(onQueryChange).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onQueryChange).toHaveBeenLastCalledWith(
        { q: "분수" },
        { replace: true },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not submit composing search when another filter changes", async () => {
    const meta = await appsService.getMeta();
    const page = await appsService.list({ limit: 24, offset: 0 });
    const onQueryChange = vi.fn();
    vi.useFakeTimers();
    try {
      const props = {
        meta,
        page,
        onQueryChange,
        loading: false,
        retry: () => {},
      };
      const { rerender } = render(
        <MemoryRouter>
          <GalleryView {...props} initialFilters={{ q: "committed" }} />
        </MemoryRouter>,
      );
      const input = screen.getByRole("textbox", { name: "앱·작성자 검색" });
      fireEvent.compositionStart(input);
      fireEvent.change(input, { target: { value: "조합중" } });
      fireEvent.click(screen.getByRole("button", { name: "과학" }));
      expect(onQueryChange).toHaveBeenLastCalledWith(
        { subject: "과학" },
        { replace: false },
      );

      rerender(
        <MemoryRouter>
          <GalleryView
            {...props}
            initialFilters={{ q: "committed", subject: "과학" }}
          />
        </MemoryRouter>,
      );
      fireEvent.compositionEnd(input, { data: "조합중" });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(onQueryChange).toHaveBeenLastCalledWith(
        { q: "조합중" },
        { replace: true },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounces search edits for 300 ms and clears immediately", async () => {
    vi.useFakeTimers();
    try {
      const onQueryChange = vi.fn();
      render(
        <MemoryRouter>
          <GalleryView
            meta={undefined}
            page={undefined}
            onQueryChange={onQueryChange}
            loading={false}
            retry={() => {}}
          />
        </MemoryRouter>,
      );
      const input = screen.getByRole("textbox", { name: "앱·작성자 검색" });
      fireEvent.change(input, { target: { value: "분수" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(299);
      });
      expect(onQueryChange).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(onQueryChange).toHaveBeenLastCalledWith(
        { q: "분수" },
        { replace: true },
      );

      fireEvent.change(input, { target: { value: "" } });
      expect(onQueryChange).toHaveBeenLastCalledWith(
        { q: undefined },
        { replace: true },
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves and announces an over-limit folded query while hiding old cards", async () => {
    const meta = await appsService.getMeta();
    const page = await appsService.list({ limit: 24, offset: 0 });
    render(
      <MemoryRouter>
        <GalleryView
          meta={meta}
          page={page}
          onQueryChange={() => {}}
          loading={false}
          retry={() => {}}
        />
      </MemoryRouter>,
    );
    const input = screen.getByRole("textbox", { name: "앱·작성자 검색" });
    fireEvent.change(input, { target: { value: "ß".repeat(51) } });

    expect(input).toHaveValue("ß".repeat(51));
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("검색어가 너무 길어요");
    expect(screen.queryByRole("link", { name: /상세 보기$/ })).toBeNull();
  });

  it("keeps cards visible after a later page fails and offers an explicit retry", async () => {
    const meta = await appsService.getMeta();
    const page = await appsService.list({ limit: 24, offset: 0 });
    const loadMore = vi.fn();
    render(
      <MemoryRouter>
        <GalleryView
          meta={meta}
          page={page}
          onQueryChange={() => {}}
          loading={false}
          retry={() => {}}
          hasNextPage
          nextPageError={new ServiceError("CONTRACT_ERROR", "목록 응답 오류")}
          loadMore={loadMore}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole("link", { name: /상세 보기$/ })).toHaveLength(
      16,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "추가 자료를 불러오지 못했어요",
    );
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(loadMore).toHaveBeenCalledOnce();
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

  it("links public list query errors to the search field", () => {
    const resetQuery = vi.fn();
    const error = new ServiceError(
      "VALIDATION_ERROR",
      "검색 조건을 확인해 주세요.",
      { fields: { q: "검색어를 확인해 주세요." } },
    );
    render(
      <MemoryRouter>
        <GalleryView
          meta={undefined}
          page={undefined}
          onQueryChange={() => {}}
          initialFilters={{ q: "분수" }}
          error={error}
          loading={false}
          retry={() => {}}
          resetQuery={resetQuery}
        />
      </MemoryRouter>,
    );

    const searchInput = screen.getByRole("textbox", {
      name: "앱·작성자 검색",
    });
    expect(searchInput).toHaveValue("분수");
    expect(searchInput).toHaveAttribute("aria-invalid", "true");
    const errorDescription = document.getElementById(
      searchInput.getAttribute("aria-describedby"),
    );
    expect(errorDescription).toBeVisible();
    expect(errorDescription).toHaveTextContent("검색어를 확인해 주세요.");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "검색 조건을 확인할 수 없어요",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "검색 조건을 확인해 주세요.",
    );
    fireEvent.click(screen.getByRole("button", { name: "조건 초기화" }));
    expect(resetQuery).toHaveBeenCalledOnce();
  });

  it("does not describe a server query error after the over-limit state takes over", () => {
    const error = new ServiceError(
      "VALIDATION_ERROR",
      "검색 조건을 확인해 주세요.",
      { fields: { q: "검색어를 확인해 주세요." } },
    );
    render(
      <MemoryRouter>
        <GalleryView
          meta={undefined}
          page={undefined}
          onQueryChange={() => {}}
          initialFilters={{ q: "분수" }}
          error={error}
          loading={false}
          retry={() => {}}
          resetQuery={() => {}}
        />
      </MemoryRouter>,
    );

    const searchInput = screen.getByRole("textbox", {
      name: "앱·작성자 검색",
    });
    fireEvent.change(searchInput, { target: { value: "ß".repeat(51) } });

    const describedBy = searchInput.getAttribute("aria-describedby").split(" ");
    expect(describedBy).toEqual(["gallery-search-error"]);
    expect(describedBy.every((id) => document.getElementById(id))).toBe(true);
    expect(
      screen.queryByText("검색어를 확인해 주세요.", { exact: true }),
    ).not.toBeInTheDocument();
  });
});
