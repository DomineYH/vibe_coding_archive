import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { StatusBadge } from "../src/components/ui";

afterEach(cleanup);

it("renders unchecked with neutral wrapper and dot", () => {
  render(<StatusBadge state="unchecked" />);
  const badge = screen.getByLabelText("연결 결과: 미검사");
  expect(badge).toHaveTextContent("미검사");
  expect(badge).toHaveClass(
    "border-neutral-200",
    "bg-neutral-100",
    "text-neutral-600",
  );
  expect(badge.className).not.toMatch(/red-/);
  expect(badge.firstElementChild).toHaveClass("bg-neutral-600");
  expect(badge.firstElementChild.className).not.toMatch(/red-/);
});

it("renders blocked as amber 검사 제한", () => {
  render(<StatusBadge state="blocked" />);
  const badge = screen.getByLabelText("연결 결과: 검사 제한");
  expect(badge).toHaveTextContent("검사 제한");
  expect(badge).toHaveClass(
    "border-amber-200",
    "bg-amber-50",
    "text-amber-800",
  );
  expect(badge.className).not.toMatch(/red-/);
  expect(badge.firstElementChild).toHaveClass("bg-amber-600");
  expect(badge.firstElementChild.className).not.toMatch(/red-/);
});

const appearances = [
  [
    "healthy",
    "정상",
    "border-emerald-200 bg-emerald-50 text-emerald-700",
    "bg-emerald-600",
  ],
  [
    "unchecked",
    "미검사",
    "border-neutral-200 bg-neutral-100 text-neutral-600",
    "bg-neutral-600",
  ],
  [
    "blocked",
    "검사 제한",
    "border-amber-200 bg-amber-50 text-amber-800",
    "bg-amber-600",
  ],
  ["http_error", "오류", "border-red-200 bg-red-50 text-red-700", "bg-red-600"],
  ["timeout", "오류", "border-red-200 bg-red-50 text-red-700", "bg-red-600"],
  [
    "network_error",
    "오류",
    "border-red-200 bg-red-50 text-red-700",
    "bg-red-600",
  ],
  [
    "redirect_error",
    "오류",
    "border-red-200 bg-red-50 text-red-700",
    "bg-red-600",
  ],
  ["unknown", "오류", "border-red-200 bg-red-50 text-red-700", "bg-red-600"],
  [undefined, "오류", "border-red-200 bg-red-50 text-red-700", "bg-red-600"],
  ["toString", "오류", "border-red-200 bg-red-50 text-red-700", "bg-red-600"],
  [
    "constructor",
    "오류",
    "border-red-200 bg-red-50 text-red-700",
    "bg-red-600",
  ],
];

for (const [size, sizeClasses] of [
  ["sm", "px-2.5 py-0.5 text-[11.5px]"],
  ["md", "px-3 py-1 text-[13px]"],
]) {
  it.each(appearances)(
    `preserves label, tone, accessibility and ${size} dimensions for %s`,
    (state, label, tone, dot) => {
      render(<StatusBadge state={state} size={size} />);
      const badge = screen.getByLabelText(`연결 결과: ${label}`);
      expect(badge).toHaveTextContent(label);
      expect(badge).toHaveClass(
        `inline-flex items-center gap-1.5 rounded-full border font-semibold ${sizeClasses} ${tone}`,
        { exact: true },
      );
      expect(badge.firstElementChild).toHaveClass(
        `inline-block h-1.5 w-1.5 rounded-full ${dot}`,
        { exact: true },
      );
      expect(badge.firstElementChild).toHaveAttribute("aria-hidden", "true");
    },
  );
}
