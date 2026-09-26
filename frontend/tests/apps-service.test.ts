import { describe, expect, it } from "vitest";
import {
  isAppInputDirty,
  normalizeAppInput,
  normalizeQuery,
  normalizeQueryForService,
  type AppInput,
  type ListAppsQuery,
} from "../src/services/apps-service";

const validAppInput: AppInput = {
  name: "  Cafe\u0301 🧑🏽‍💻  ",
  url: "  https://예시.한국/수업?단원=분수#미리보기  ",
  prompt: "  첫 줄\r\n둘째 줄\u0085끝  ",
  description: "  설명\u2028다음 문단\u2029끝  ",
  subject: "수학",
  grades: ["중1", "초3", "초3"],
  isPublic: true,
  themeId: "niagara",
  stack: {
    db: " PostgreSQL ",
    backend: "",
    frontend: "Cafe\u0301",
    hosting: " Vercel ",
  },
};

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

describe("app input contract", () => {
  it("normalizes only the fields and line breaks fixed by the app contract", () => {
    expect(normalizeAppInput(validAppInput)).toEqual({
      name: "Café 🧑🏽‍💻",
      url: "https://예시.한국/수업?단원=분수#미리보기",
      prompt: "  첫 줄\n둘째 줄\n끝  ",
      description: "  설명\n다음 문단\n끝  ",
      subject: "수학",
      grades: ["초3", "중1"],
      isPublic: true,
      themeId: "niagara",
      stack: {
        db: "PostgreSQL",
        backend: null,
        frontend: "Café",
        hosting: "Vercel",
      },
    });
  });

  it.each([
    { name: "😀".repeat(101) },
    { url: "https://example.com/" + "a".repeat(2048) },
    { prompt: "😀".repeat(30_001) },
    { description: "😀".repeat(20_001) },
    { name: "\t이름" },
    { name: "\u202e이름" },
    { prompt: "설명\u0001" },
    { prompt: "설명\u202e" },
    { url: "https://localhost/app" },
    { url: "https://10.0.0.1/app" },
    { url: "https://example.com:8443/app" },
    { url: "https://user@example.com/app" },
    { url: "https://example.com/a b" },
    { url: "https://example.com/%GG" },
    { url: "https://example.com\\@evil.test" },
  ])("rejects an app field outside its input contract: %o", (patch) => {
    expect(() =>
      normalizeAppInput({ ...validAppInput, ...patch }),
    ).toThrowError(
      expect.objectContaining({
        name: "ServiceError",
        code: "VALIDATION_ERROR",
        outcome: "rejected",
      }),
    );
  });

  it("compares drafts by normalized persisted values", () => {
    expect(
      isAppInputDirty(validAppInput, {
        ...validAppInput,
        name: "Café 🧑🏽‍💻",
        grades: ["초3", "중1"],
        stack: {
          db: "PostgreSQL",
          backend: "",
          frontend: "Café",
          hosting: "Vercel",
        },
      }),
    ).toBe(false);
    expect(
      isAppInputDirty(validAppInput, {
        ...validAppInput,
        prompt: `${validAppInput.prompt} `,
      }),
    ).toBe(true);
    expect(
      isAppInputDirty(validAppInput, {
        ...validAppInput,
        url: validAppInput.url.replace("  ", "") + "#different",
      }),
    ).toBe(true);
  });
});
