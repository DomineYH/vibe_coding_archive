import { describe, expect, it } from "vitest";
import { formatCheckedAt, formatDate } from "../src/components/presentation.js";

describe("formatDate", () => {
  it("keeps the original year-month-day display for Seoul calendar dates", () => {
    expect(formatDate("2026-04-01T15:00:00.000Z")).toBe("2026-04-02");
  });

  it("uses Seoul calendar dates for checked-at comparisons", () => {
    expect(
      formatCheckedAt("2026-04-01T15:00:00.000Z", "2026-04-01T16:00:00.000Z"),
    ).toBe("오늘 00:00");
  });
});
