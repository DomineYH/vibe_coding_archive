import type { components } from "./api";
import { contractError } from "../services/service-error";

type Wire = components["schemas"];
type WireMeta = Wire["Meta"];
type WireAppCard = Wire["AppCard"];
type WireAppDetail = Wire["AppDetail"];
type WireHealth = Wire["HealthView"];
type WireHealthResult = Wire["HealthResult"];
type WireReason = Wire["Reason"];
type WireCapability = Wire["Capability"];

export type Theme = Wire["Theme"];
export type Capability = WireCapability;
export type Meta = {
  subjects: string[];
  grades: string[];
  themes: Theme[];
  serverTime: string;
  capabilities: Wire["Capabilities"];
  support: Wire["Support"];
  initialPendingDays: number;
};
export type HealthResult = WireHealthResult;
export type HealthView = {
  result: HealthResult;
  latestJob: WireHealth["latest_job"];
  nextCheckAt: string | null;
};
export type AppCard = {
  id: string;
  ownerId: string;
  owner: string;
  name: string;
  subject: string;
  grades: string[];
  isPublic: boolean;
  themeId: string;
  version: number;
  urlVersion: number;
  health: HealthView;
};
export type AppPage = {
  items: AppCard[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  serverTime: string;
  facets: { subjectsInUse: string[] };
};
export type AppDetail = AppCard & {
  url: string;
  prompt: string;
  description: string;
  stack: {
    db: string | null;
    backend: string | null;
    frontend: string | null;
    hosting: string | null;
  };
  createdAt: string;
  updatedAt: string;
  serverTime: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const REASONS: WireReason[] = [
  "not_implemented",
  "verification_pending",
  "operational_restriction",
  "collection_disabled",
];
const HEALTH_STATES = [
  "unchecked",
  "healthy",
  "http_error",
  "timeout",
  "network_error",
  "blocked",
  "redirect_error",
] as const;

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw contractError();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw contractError();
  return value;
}

function nonEmpty(value: unknown): string {
  const result = string(value);
  if (!result.trim()) throw contractError();
  return result;
}

function dateTime(value: unknown): string {
  const result = string(value);
  if (!DATE_TIME.test(result) || Number.isNaN(Date.parse(result)))
    throw contractError();
  const calendarDate = result.slice(0, 10);
  if (
    new Date(`${calendarDate}T00:00:00.000Z`).toISOString().slice(0, 10) !==
    calendarDate
  )
    throw contractError();
  return result;
}

function nullableDateTime(value: unknown): string | null {
  return value === null ? null : dateTime(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw contractError();
  return value;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw contractError();
  return value.map((item) => string(item));
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

function mapTheme(value: unknown): Theme {
  const item = record(value);
  const ink = item.ink;
  if (ink !== "dark" && ink !== "light") throw contractError();
  const from = string(item.from);
  const to = string(item.to);
  if (!/^#[0-9a-f]{6}$/i.test(from) || !/^#[0-9a-f]{6}$/i.test(to))
    throw contractError();
  return {
    id: nonEmpty(item.id),
    name: nonEmpty(item.name),
    pantone: nonEmpty(item.pantone),
    from,
    to,
    ink,
  };
}

function mapCapability(value: unknown): WireCapability {
  const item = record(value);
  if (typeof item.enabled !== "boolean" || !Array.isArray(item.reasons))
    throw contractError();
  const reasons = item.reasons.map((reason) => {
    if (!REASONS.includes(reason as WireReason)) throw contractError();
    return reason as WireReason;
  });
  if (item.enabled && reasons.length !== 0) throw contractError();
  return { enabled: item.enabled, reasons };
}

const CAPABILITY_KEYS: (keyof Wire["Capabilities"])[] = [
  "apps_read",
  "auth_register",
  "auth_login",
  "auth_logout",
  "auth_password_change",
  "admin_users_read",
  "admin_approval",
  "admin_summary",
  "apps_create",
  "apps_update_own",
  "apps_delete_own",
  "admin_apps_read",
  "admin_apps_manage",
  "admin_reauth",
  "admin_password_reset",
  "admin_user_delete",
  "health_read",
  "health_check",
  "health_batch",
  "email_collection",
  "phone_collection",
];

export function mapMeta(value: unknown): Meta {
  const item = record(value) as unknown as Partial<WireMeta>;
  const themes = item.themes;
  if (
    !Array.isArray(item.subjects) ||
    !Array.isArray(item.grades) ||
    !Array.isArray(themes)
  )
    throw contractError();
  const rawCapabilities = record(item.capabilities);
  const capabilities = Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, mapCapability(rawCapabilities[key])]),
  ) as Wire["Capabilities"];
  const support = record(item.support);
  const initialPendingDays = integer(item.initial_pending_days, 1);
  return {
    subjects: stringArray(item.subjects),
    grades: stringArray(item.grades),
    themes: themes.map(mapTheme),
    serverTime: dateTime(item.server_time),
    capabilities,
    support: {
      email: nullableString(support.email),
      service_url: nullableString(support.service_url),
      announcement_url: nullableString(support.announcement_url),
    },
    initialPendingDays,
  };
}

function mapHealth(value: unknown): HealthView {
  const item = record(value);
  const result = record(item.result);
  const state = result.state;
  if (!HEALTH_STATES.includes(state as (typeof HEALTH_STATES)[number]))
    throw contractError();
  const latestJob = item.latest_job;
  if (latestJob !== null) {
    const job = record(latestJob);
    const statuses = ["queued", "running", "completed", "failed", "cancelled"];
    if (!statuses.includes(string(job.status))) throw contractError();
    if (!UUID.test(nonEmpty(job.id))) throw contractError();
    dateTime(job.created_at);
    nullableDateTime(job.started_at);
    nullableDateTime(job.finished_at);
    nullableString(job.failure_code);
  }
  return {
    result: {
      state: state as WireHealthResult["state"],
      checked_at: nullableDateTime(result.checked_at),
      fresh_until: nullableDateTime(result.fresh_until),
    },
    latestJob: latestJob as WireHealth["latest_job"],
    nextCheckAt: nullableDateTime(item.next_check_at),
  };
}

function mapCard(value: unknown): AppCard {
  const item = record(value);
  const owner = record(item.owner);
  const id = nonEmpty(item.id);
  const ownerId = nonEmpty(owner.id);
  if (
    !UUID.test(id) ||
    !UUID.test(ownerId) ||
    typeof item.is_public !== "boolean"
  )
    throw contractError();
  return {
    id,
    ownerId,
    owner: nonEmpty(owner.nickname),
    name: nonEmpty(item.name),
    subject: nonEmpty(item.subject),
    grades: stringArray(item.grades),
    isPublic: item.is_public,
    themeId: nonEmpty(item.theme_id),
    version: integer(item.version, 1),
    urlVersion: integer(item.url_version, 1),
    health: mapHealth(item.health),
  };
}

export function mapAppPage(value: unknown): AppPage {
  const item = record(value);
  if (!Array.isArray(item.items)) throw contractError();
  const pagination = record(item.pagination);
  const facets = record(item.facets);
  const limit = integer(pagination.limit, 1, 100);
  const offset = integer(pagination.offset, 0);
  const total = integer(pagination.total, 0);
  if (typeof pagination.has_more !== "boolean") throw contractError();
  const items = item.items.map(mapCard);
  if (items.some((app) => !app.isPublic)) throw contractError();
  return {
    items,
    pagination: { limit, offset, total, hasMore: pagination.has_more },
    serverTime: dateTime(item.server_time),
    facets: { subjectsInUse: stringArray(facets.subjects_in_use) },
  };
}

export function mapAppDetailResponse(value: unknown): {
  item: AppDetail;
  serverTime: string;
} {
  const response = record(value);
  const detail = record(response.item) as unknown as Partial<WireAppDetail>;
  const rawUrl = nonEmpty(detail.url);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw contractError();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw contractError();
  return {
    item: {
      ...mapCard(detail),
      url: rawUrl,
      prompt: string(detail.prompt),
      description: string(detail.description),
      stack: {
        db: nullableString(detail.stack_db),
        backend: nullableString(detail.stack_backend),
        frontend: nullableString(detail.stack_frontend),
        hosting: nullableString(detail.stack_hosting),
      },
      createdAt: dateTime(detail.created_at),
      updatedAt: dateTime(detail.updated_at),
      serverTime: dateTime(response.server_time),
    },
    serverTime: dateTime(response.server_time),
  };
}

export type AppCardWire = WireAppCard;
