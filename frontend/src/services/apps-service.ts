import type { AppDetail, AppPage, Meta } from "../contracts/mappers";
import type { operations } from "../contracts/api";
import catalog from "../../../contracts/catalog.json";
import { ServiceError } from "./service-error";

export type ListAppsQuery = Pick<
  NonNullable<operations["listPublicApps"]["parameters"]["query"]>,
  "q" | "subject" | "grade" | "limit" | "offset"
>;

export type RequestOptions = { signal?: AbortSignal };

const subjects = new Set(catalog.subjects);
const grades = new Set(catalog.grades);
const queryKeys = new Set(["q", "subject", "grade", "limit", "offset"]);

function foldCodePoint(value: string): string {
  const codePoint = value.codePointAt(0)!;
  // JS has no full case-fold API; correct the Unicode code points where upper/lower differs.
  if (codePoint === 0x0131) return value;
  if (codePoint === 0x1e9e) return "ss";
  if (codePoint >= 0x13a0 && codePoint <= 0x13f5) return value;
  if (codePoint >= 0x13f8 && codePoint <= 0x13fd)
    return String.fromCodePoint(codePoint - 8);
  if (codePoint >= 0xab70 && codePoint <= 0xabbf)
    return String.fromCodePoint(codePoint - 0x97d0);
  return value.toUpperCase().toLowerCase().replaceAll("ß", "ss");
}

export function caseFold(value: string): string {
  return Array.from(value, foldCodePoint).join("");
}

export function normalizeSearch(value: string): string | undefined {
  const normalized = value.trim().normalize("NFC");
  return normalized ? caseFold(normalized) : undefined;
}

export type AppsService = {
  getMeta(options?: RequestOptions): Promise<Meta>;
  list(query?: ListAppsQuery, options?: RequestOptions): Promise<AppPage>;
  get(id: string, options?: RequestOptions): Promise<AppDetail>;
};

export function normalizeQuery(query: ListAppsQuery = {}) {
  if (
    query === null ||
    typeof query !== "object" ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => !queryKeys.has(key))
  )
    throw new RangeError("unsupported list query");
  if (
    (query.q !== undefined && typeof query.q !== "string") ||
    (query.subject !== undefined && typeof query.subject !== "string") ||
    (query.grade !== undefined && typeof query.grade !== "string")
  )
    throw new RangeError("invalid list query value");
  const q = query.q === undefined ? undefined : normalizeSearch(query.q);
  const subject = query.subject || undefined;
  const grade = query.grade || undefined;
  const limit = query.limit === undefined ? 24 : query.limit;
  const offset = query.offset === undefined ? 0 : query.offset;
  if (q && Array.from(q).length > 100)
    throw new RangeError("q must contain at most 100 characters");
  if ((subject && !subjects.has(subject)) || (grade && !grades.has(grade)))
    throw new RangeError("unsupported list filter");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("limit must be between 1 and 100");
  if (!Number.isInteger(offset) || offset < 0)
    throw new RangeError("offset must be non-negative");
  return {
    q,
    subject,
    grade,
    limit,
    offset,
  };
}

export function normalizeQueryForService(query?: ListAppsQuery) {
  try {
    return normalizeQuery(query);
  } catch {
    throw new ServiceError("VALIDATION_ERROR", "검색 조건을 확인해 주세요.", {
      outcome: "rejected",
    });
  }
}
