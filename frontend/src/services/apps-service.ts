import type { AppDetail, AppPage, Meta } from "../contracts/mappers";
import type { components, operations } from "../contracts/api";
import type { AppWriteOperation, Grade, Subject } from "../contracts/mappers";
import catalog from "../../../contracts/catalog.json";
import { ServiceError } from "./service-error";
import type { ProtectedReadContext } from "./auth-state";

export type ListAppsQuery = Pick<
  NonNullable<operations["listPublicApps"]["parameters"]["query"]>,
  "q" | "subject" | "grade" | "limit" | "offset"
>;

export type RequestOptions = { signal?: AbortSignal };
export type AppInput = {
  name: string;
  url: string;
  prompt: string;
  description: string;
  subject: Subject;
  grades: Grade[];
  isPublic: boolean;
  themeId: string;
  stack: {
    db: string | null;
    backend: string | null;
    frontend: string | null;
    hosting: string | null;
  };
};
export type AppPatch = Partial<Omit<AppInput, "stack">> & {
  stack?: Partial<AppInput["stack"]>;
};

const subjects = new Set(catalog.subjects);
const grades = new Set(catalog.grades);
const queryKeys = new Set(["q", "subject", "grade", "limit", "offset"]);
const themeIds = new Set(catalog.themes.map((theme) => theme.id));
const bidiControls = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const malformedEscape = /%(?![0-9a-f]{2})/iu;
const invisibleOnly = /^[\p{White_Space}\p{Default_Ignorable_Code_Point}]*$/u;
const appFields = new Set([
  "name",
  "url",
  "prompt",
  "description",
  "subject",
  "grades",
  "isPublic",
  "themeId",
  "stack",
]);
const stackFields = new Set(["db", "backend", "frontend", "hosting"]);

const lineBreaks = /\r\n|[\r\u0085\u2028\u2029]/gu;

function codePoints(value: string): number {
  return Array.from(value).length;
}

function hasControl(value: string, allowNewlineAndTab = false): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    const control =
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
    return (
      (control &&
        !(allowNewlineAndTab && (character === "\n" || character === "\t"))) ||
      bidiControls.test(character)
    );
  });
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/.test(part)))
    return false;
  const [first, second] = parts.map(Number);
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second! >= 64 && second! <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second! >= 16 && second! <= 31) ||
    (first === 192 && second === 168)
  );
}

function hasPrivateEmbeddedIPv4(ipv6: string): boolean {
  // URL serializes valid IPv6 hosts as hexadecimal words, including dotted tails.
  const [left, right] = ipv6.split("::");
  const words = left ? left.split(":").map((word) => parseInt(word, 16)) : [];
  if (right !== undefined) {
    const tail = right
      ? right.split(":").map((word) => parseInt(word, 16))
      : [];
    words.push(
      ...Array<number>(8 - words.length - tail.length).fill(0),
      ...tail,
    );
  }
  const mapped =
    words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  return (
    (mapped || compatible) &&
    isPrivateIPv4(
      [words[6] >>> 8, words[6] & 255, words[7] >>> 8, words[7] & 255].join(
        ".",
      ),
    )
  );
}

function invalidAppInput(fields: Record<string, string>): ServiceError {
  return new ServiceError("VALIDATION_ERROR", "입력 내용을 확인해 주세요.", {
    outcome: "rejected",
    fields,
  });
}

function cleanText(
  value: unknown,
  field: string,
  maxLength: number,
  { trim = false, multiline = false, nfc = false, required = false } = {},
): string {
  if (typeof value !== "string")
    throw invalidAppInput({ [field]: "문자열을 입력해 주세요." });
  let result = value;
  if (multiline) result = result.replace(lineBreaks, "\n");
  if (hasControl(result, multiline))
    throw invalidAppInput({ [field]: "허용되지 않는 문자가 포함되어 있어요." });
  if (trim) result = result.trim();
  if (nfc) result = result.normalize("NFC");
  if (
    codePoints(result) > maxLength ||
    (required && invisibleOnly.test(result))
  )
    throw invalidAppInput({
      [field]:
        required && invisibleOnly.test(result)
          ? "필수 항목을 입력해 주세요."
          : `${maxLength.toLocaleString("ko-KR")}자 이내로 입력해 주세요.`,
    });
  return result;
}

function validateAppUrl(value: unknown): string {
  const url = cleanText(value, "url", 2048, { trim: true, required: true });
  let parsed: URL;
  try {
    if (/\s/u.test(url) || url.includes("\\") || malformedEscape.test(url))
      throw new Error("invalid URL characters");
    parsed = new URL(url);
  } catch {
    throw invalidAppInput({ url: "http 또는 https 주소를 확인해 주세요." });
  }
  const authority = url.match(/^https?:\/*([^/?#]*)/iu)?.[1] ?? "";
  const host = parsed.hostname.toLowerCase().replace(/\.$/u, "");
  const ipv6 = host.startsWith("[") ? host.slice(1, -1) : null;
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    authority.includes("@") ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    isPrivateIPv4(host) ||
    (ipv6 !== null &&
      (ipv6 === "::" ||
        ipv6 === "::1" ||
        /^f[cd]/iu.test(ipv6) ||
        /^fe[89ab]/iu.test(ipv6) ||
        hasPrivateEmbeddedIPv4(ipv6)))
  )
    throw invalidAppInput({
      url: "공개 http 또는 https 주소를 입력해 주세요.",
    });
  return url;
}

export function normalizeAppInput(input: unknown): AppInput {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !appFields.has(key))
  )
    throw invalidAppInput({ form: "입력 내용을 확인해 주세요." });
  const value = input as Record<string, unknown>;
  const errors: Record<string, string> = {};
  let name = "";
  let url = "";
  let prompt = "";
  let description = "";
  const stack: AppInput["stack"] = {
    db: "",
    backend: "",
    frontend: "",
    hosting: "",
  };
  try {
    name = cleanText(value.name, "name", 100, {
      trim: true,
      nfc: true,
      required: true,
    });
  } catch (error) {
    if (error instanceof ServiceError) Object.assign(errors, error.fields);
    else throw error;
  }
  try {
    url = validateAppUrl(value.url);
  } catch (error) {
    if (error instanceof ServiceError) Object.assign(errors, error.fields);
    else throw error;
  }
  try {
    prompt = cleanText(value.prompt, "prompt", 30_000, {
      multiline: true,
      required: true,
    });
  } catch (error) {
    if (error instanceof ServiceError) Object.assign(errors, error.fields);
    else throw error;
  }
  try {
    description = cleanText(value.description, "description", 20_000, {
      multiline: true,
      required: true,
    });
  } catch (error) {
    if (error instanceof ServiceError) Object.assign(errors, error.fields);
    else throw error;
  }
  if (typeof value.subject !== "string" || !subjects.has(value.subject))
    errors.subject = "교과 과목을 선택해 주세요.";
  if (
    !Array.isArray(value.grades) ||
    value.grades.length === 0 ||
    value.grades.some(
      (grade) => typeof grade !== "string" || !grades.has(grade),
    )
  )
    errors.grades = "적용 학년을 하나 이상 선택해 주세요.";
  if (typeof value.isPublic !== "boolean")
    errors.isPublic = "공개 여부를 확인해 주세요.";
  if (typeof value.themeId !== "string" || !themeIds.has(value.themeId))
    errors.themeId = "테마를 선택해 주세요.";
  if (
    value.stack === null ||
    typeof value.stack !== "object" ||
    Array.isArray(value.stack) ||
    Object.keys(value.stack).some((key) => !stackFields.has(key))
  ) {
    errors.stack = "기술 스택을 확인해 주세요.";
  } else {
    const rawStack = value.stack as Record<string, unknown>;
    for (const field of stackFields) {
      try {
        stack[field as keyof AppInput["stack"]] = cleanText(
          rawStack[field] ?? "",
          `stack.${field}`,
          200,
          { trim: true, nfc: true },
        );
      } catch (error) {
        if (error instanceof ServiceError) Object.assign(errors, error.fields);
        else throw error;
      }
    }
  }
  if (Object.keys(errors).length) throw invalidAppInput(errors);
  const normalizedGrades = catalog.grades.filter((grade) =>
    (value.grades as string[]).includes(grade),
  ) as Grade[];
  return {
    name,
    url,
    prompt,
    description,
    subject: value.subject as Subject,
    grades: normalizedGrades,
    isPublic: value.isPublic as boolean,
    themeId: value.themeId as string,
    stack: Object.fromEntries(
      Object.entries(stack).map(([key, text]) => [key, text || null]),
    ) as AppInput["stack"],
  };
}

export function appInputToWire(
  input: unknown,
): components["schemas"]["AppInput"] {
  const value = normalizeAppInput(input);
  return {
    name: value.name,
    url: value.url,
    prompt: value.prompt,
    description: value.description,
    subject: value.subject,
    grades: value.grades,
    is_public: value.isPublic,
    theme_id: value.themeId,
    stack_db: value.stack.db,
    stack_backend: value.stack.backend,
    stack_frontend: value.stack.frontend,
    stack_hosting: value.stack.hosting,
  };
}

export function normalizeAppPatch(input: unknown): AppPatch {
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !appFields.has(key)) ||
    Object.keys(input).length === 0
  )
    throw invalidAppInput({ form: "변경할 항목을 확인해 주세요." });

  const value = input as Record<string, unknown>;
  const patch: AppPatch = {};
  const errors: Record<string, string> = {};

  for (const field of ["name", "url", "prompt", "description"] as const) {
    if (!Object.hasOwn(value, field)) continue;
    try {
      patch[field] =
        field === "url"
          ? validateAppUrl(value[field])
          : cleanText(
              value[field],
              field,
              field === "name" ? 100 : field === "prompt" ? 30_000 : 20_000,
              {
                trim: field === "name",
                nfc: field === "name",
                multiline: field === "prompt" || field === "description",
                required: true,
              },
            );
    } catch (error) {
      if (error instanceof ServiceError) Object.assign(errors, error.fields);
      else throw error;
    }
  }
  if (Object.hasOwn(value, "subject")) {
    if (typeof value.subject !== "string" || !subjects.has(value.subject))
      errors.subject = "교과 과목을 선택해 주세요.";
    else patch.subject = value.subject as Subject;
  }
  if (Object.hasOwn(value, "grades")) {
    if (
      !Array.isArray(value.grades) ||
      value.grades.length === 0 ||
      value.grades.some(
        (grade) => typeof grade !== "string" || !grades.has(grade),
      )
    )
      errors.grades = "적용 학년을 하나 이상 선택해 주세요.";
    else
      patch.grades = catalog.grades.filter((grade) =>
        (value.grades as string[]).includes(grade),
      ) as Grade[];
  }
  if (Object.hasOwn(value, "isPublic")) {
    if (typeof value.isPublic !== "boolean")
      errors.isPublic = "공개 여부를 확인해 주세요.";
    else patch.isPublic = value.isPublic;
  }
  if (Object.hasOwn(value, "themeId")) {
    if (typeof value.themeId !== "string" || !themeIds.has(value.themeId))
      errors.themeId = "테마를 선택해 주세요.";
    else patch.themeId = value.themeId;
  }
  if (Object.hasOwn(value, "stack")) {
    const stack = value.stack;
    if (
      stack === null ||
      typeof stack !== "object" ||
      Array.isArray(stack) ||
      Object.keys(stack).length === 0 ||
      Object.keys(stack).some((key) => !stackFields.has(key))
    ) {
      errors.stack = "기술 스택을 확인해 주세요.";
    } else {
      const normalized: NonNullable<AppPatch["stack"]> = {};
      for (const field of stackFields) {
        if (!Object.hasOwn(stack, field)) continue;
        const item = (stack as Record<string, unknown>)[field];
        try {
          normalized[field as keyof AppInput["stack"]] =
            item === null
              ? null
              : cleanText(item, `stack.${field}`, 200, {
                  trim: true,
                  nfc: true,
                }) || null;
        } catch (error) {
          if (error instanceof ServiceError)
            Object.assign(errors, error.fields);
          else throw error;
        }
      }
      patch.stack = normalized;
    }
  }
  if (Object.keys(errors).length) throw invalidAppInput(errors);
  return patch;
}

export function appPatchToWire(
  input: unknown,
): components["schemas"]["AppPatch"] {
  const value = normalizeAppPatch(input);
  const wire: components["schemas"]["AppPatch"] = {};
  if (Object.hasOwn(value, "name")) wire.name = value.name!;
  if (Object.hasOwn(value, "url")) wire.url = value.url!;
  if (Object.hasOwn(value, "prompt")) wire.prompt = value.prompt!;
  if (Object.hasOwn(value, "description"))
    wire.description = value.description!;
  if (Object.hasOwn(value, "subject")) wire.subject = value.subject!;
  if (Object.hasOwn(value, "grades")) wire.grades = value.grades!;
  if (Object.hasOwn(value, "isPublic")) wire.is_public = value.isPublic!;
  if (Object.hasOwn(value, "themeId")) wire.theme_id = value.themeId!;
  if (value.stack && Object.hasOwn(value.stack, "db"))
    wire.stack_db = value.stack.db!;
  if (value.stack && Object.hasOwn(value.stack, "backend"))
    wire.stack_backend = value.stack.backend!;
  if (value.stack && Object.hasOwn(value.stack, "frontend"))
    wire.stack_frontend = value.stack.frontend!;
  if (value.stack && Object.hasOwn(value.stack, "hosting"))
    wire.stack_hosting = value.stack.hosting!;
  return wire;
}

function draftValue(input: AppInput) {
  return {
    name: input.name.trim().normalize("NFC"),
    url: input.url.trim(),
    prompt: input.prompt.replace(lineBreaks, "\n"),
    description: input.description.replace(lineBreaks, "\n"),
    subject: input.subject,
    grades: [...new Set(input.grades)].sort(
      (left, right) =>
        catalog.grades.indexOf(left) - catalog.grades.indexOf(right),
    ),
    isPublic: input.isPublic,
    themeId: input.themeId,
    stack: Object.fromEntries(
      Object.entries(input.stack).map(([key, value]) => [
        key,
        (value ?? "").trim().normalize("NFC") || null,
      ]),
    ),
  };
}

export function isAppInputDirty(initial: AppInput, current: AppInput): boolean {
  return (
    JSON.stringify(draftValue(initial)) !== JSON.stringify(draftValue(current))
  );
}

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

export function isSearchTooLong(value: string): boolean {
  return codePoints(normalizeSearch(value) ?? "") > 100;
}

export type AppsService = {
  getMeta(options?: RequestOptions): Promise<Meta>;
  list(query?: ListAppsQuery, options?: RequestOptions): Promise<AppPage>;
  get(
    id: string,
    options?: RequestOptions & { readContext?: ProtectedReadContext },
  ): Promise<AppDetail>;
  issueCreateOperation(input: unknown): Promise<AppWriteOperation>;
  create(input: unknown, operationKey: string): Promise<AppDetail>;
  getCreateOperation(
    key: string,
    options?: RequestOptions,
  ): Promise<AppWriteOperation>;
  issueUpdateOperation(
    id: string,
    patch: unknown,
    expectedVersion: number,
  ): Promise<AppWriteOperation>;
  update(
    id: string,
    patch: unknown,
    expectedVersion: number,
    operationKey: string,
  ): Promise<AppDetail>;
  getUpdateOperation(
    key: string,
    options?: RequestOptions,
  ): Promise<AppWriteOperation>;
  issueDeleteOperation(
    id: string,
    expectedVersion: number,
  ): Promise<AppWriteOperation>;
  delete(
    id: string,
    expectedVersion: number,
    operationKey: string,
  ): Promise<void>;
  getDeleteOperation(
    key: string,
    options?: RequestOptions,
  ): Promise<AppWriteOperation>;
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
  const q =
    query.q === undefined
      ? undefined
      : query.q.trim().normalize("NFC") || undefined;
  const subject = query.subject || undefined;
  const grade = query.grade || undefined;
  const limit = query.limit === undefined ? 24 : query.limit;
  const offset = query.offset === undefined ? 0 : query.offset;
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
