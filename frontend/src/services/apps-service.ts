import type { AppDetail, AppPage, Meta } from "../contracts/mappers";

export type ListAppsQuery = {
  q?: string;
  subject?: string;
  grade?: string;
  limit?: number;
  offset?: number;
};

export type RequestOptions = { signal?: AbortSignal };

export type AppsService = {
  getMeta(options?: RequestOptions): Promise<Meta>;
  list(query?: ListAppsQuery, options?: RequestOptions): Promise<AppPage>;
  get(id: string, options?: RequestOptions): Promise<AppDetail>;
};

export function normalizeQuery(query: ListAppsQuery = {}) {
  const q = query.q?.trim() || undefined;
  const limit = query.limit ?? 24;
  const offset = query.offset ?? 0;
  if (q && q.length > 100)
    throw new RangeError("q must contain at most 100 characters");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("limit must be between 1 and 100");
  if (!Number.isInteger(offset) || offset < 0)
    throw new RangeError("offset must be non-negative");
  return {
    q,
    subject: query.subject || undefined,
    grade: query.grade || undefined,
    limit,
    offset,
  };
}
