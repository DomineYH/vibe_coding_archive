import { describe, expect, it } from "vitest";
import {
  normalizeQuery,
  normalizeQueryForService,
  type ListAppsQuery,
} from "../src/services/apps-service";

describe("shared query validation", () => {
  it("converts invalid query input to the service validation error", () => {
    expect(() => normalizeQueryForService({ limit: 0 })).toThrowError(
      expect.objectContaining({
        name: "ServiceError",
        code: "VALIDATION_ERROR",
        outcome: "rejected",
      }),
    );
  });

  it("normalizes search with trim, NFC, and full case folding before counting code points", () => {
    expect(normalizeQuery({ q: "  Cafe\u0301  STRAẞE  " }).q).toBe(
      "café  strasse",
    );
    expect(normalizeQuery({ q: "Ꭰꭰẞıςﬃ" }).q).toBe("ᎠᎠssıσffi");
    expect(() => normalizeQuery({ q: "ß".repeat(51) })).toThrow(RangeError);
  });

  it.each([
    { subject: "전체" },
    { grade: "중4" },
    { unexpected: "value" },
    { limit: 101 },
    { limit: 1.5 },
    { offset: -1 },
    { offset: 1.5 },
  ])("rejects unsupported list query values: %o", (query) => {
    const input = query as unknown as ListAppsQuery;
    expect(() => normalizeQuery(input)).toThrow(RangeError);
    expect(() => normalizeQueryForService(input)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_ERROR" }),
    );
  });
});
