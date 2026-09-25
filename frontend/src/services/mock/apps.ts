import catalog from "../../../../contracts/catalog.json";
import {
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
} from "../../contracts/mappers";
import type { components } from "../../contracts/api";
import { ServiceError } from "../service-error";
import { normalizeQuery, type AppsService } from "../apps-service";
import { assertCurrentGeneration, getMockSnapshot } from "./state";

type WireAppDetail = components["schemas"]["AppDetail"];
type MockMeta = components["schemas"]["Meta"];
const fixedTime = "2026-09-22T00:12:00.000Z";
const listDelayMs = 300;
const capabilities = {
  apps_read: { enabled: true, reasons: [] },
  auth_register: { enabled: false, reasons: ["not_implemented"] },
  auth_login: { enabled: false, reasons: ["not_implemented"] },
  auth_logout: { enabled: false, reasons: ["not_implemented"] },
  auth_password_change: { enabled: false, reasons: ["not_implemented"] },
  admin_users_read: { enabled: false, reasons: ["not_implemented"] },
  admin_approval: { enabled: false, reasons: ["not_implemented"] },
  admin_summary: { enabled: false, reasons: ["not_implemented"] },
  apps_create: { enabled: false, reasons: ["not_implemented"] },
  apps_update_own: { enabled: false, reasons: ["not_implemented"] },
  apps_delete_own: { enabled: false, reasons: ["not_implemented"] },
  admin_apps_read: { enabled: false, reasons: ["not_implemented"] },
  admin_apps_manage: { enabled: false, reasons: ["not_implemented"] },
  admin_reauth: { enabled: false, reasons: ["not_implemented"] },
  admin_password_reset: { enabled: false, reasons: ["not_implemented"] },
  admin_user_delete: { enabled: false, reasons: ["not_implemented"] },
  health_read: { enabled: false, reasons: ["not_implemented"] },
  health_check: { enabled: false, reasons: ["not_implemented"] },
  health_batch: { enabled: false, reasons: ["not_implemented"] },
  email_collection: { enabled: false, reasons: ["collection_disabled"] },
  phone_collection: { enabled: false, reasons: ["collection_disabled"] },
} satisfies MockMeta["capabilities"];

const mockMeta: MockMeta = {
  subjects: catalog.subjects,
  grades: catalog.grades,
  themes: catalog.themes as MockMeta["themes"],
  server_time: fixedTime,
  capabilities,
  support: { email: null, service_url: null, announcement_url: null },
  initial_pending_days: 90,
};

function toCard(app: WireAppDetail): components["schemas"]["AppCard"] {
  const {
    id,
    owner,
    name,
    subject,
    grades,
    is_public,
    theme_id,
    version,
    url_version,
    health,
  } = app;
  return {
    id,
    owner,
    name,
    subject,
    grades,
    is_public,
    theme_id,
    version,
    url_version,
    health,
  };
}

function checkSignal(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Request aborted", "AbortError");
}

async function beginRead(signal?: AbortSignal) {
  checkSignal(signal);
  const state = getMockSnapshot();
  await Promise.resolve();
  assertCurrentGeneration(state.generation, signal);
  return state;
}

export const appsService: AppsService = {
  async getMeta({ signal } = {}) {
    checkSignal(signal);
    return mapMeta(mockMeta);
  },

  async list(query, { signal } = {}) {
    let normalized;
    try {
      normalized = normalizeQuery(query);
    } catch {
      throw new ServiceError("VALIDATION_ERROR", "검색 조건을 확인해 주세요.", {
        outcome: "rejected",
      });
    }
    const state = await beginRead(signal);
    if (state.scenario === "list_failure") {
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "목록을 불러오지 못했어요. 다시 시도해 주세요.",
      );
    }
    if (state.scenario === "list_delayed") {
      await new Promise((resolve) => setTimeout(resolve, listDelayMs));
      assertCurrentGeneration(state.generation, signal);
    }
    const publicApps =
      state.scenario === "empty" ? [] : (state.apps as WireAppDetail[]);
    const queryText = normalized.q?.toLocaleLowerCase("ko-KR");
    const matching = publicApps.filter((app) => {
      if (!app.is_public) return false;
      if (normalized.subject && app.subject !== normalized.subject)
        return false;
      if (normalized.grade && !app.grades.includes(normalized.grade))
        return false;
      if (!queryText) return true;
      return `${app.name}${app.owner.nickname}${app.description}`
        .toLocaleLowerCase("ko-KR")
        .includes(queryText);
    });
    const subjectsInUse = [
      ...new Set(
        publicApps.filter((app) => app.is_public).map((app) => app.subject),
      ),
    ];
    const page = {
      items: matching
        .slice(normalized.offset, normalized.offset + normalized.limit)
        .map(toCard),
      pagination: {
        limit: normalized.limit,
        offset: normalized.offset,
        total: matching.length,
        has_more: normalized.offset + normalized.limit < matching.length,
      },
      server_time: fixedTime,
      facets: { subjects_in_use: subjectsInUse },
    };
    return mapAppPage(page);
  },

  async get(id, { signal } = {}) {
    const state = await beginRead(signal);
    const app = (state.apps as WireAppDetail[]).find(
      (item) => item.id === id && item.is_public,
    );
    if (!app)
      throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
        outcome: "rejected",
        httpStatus: 404,
      });
    const result = mapAppDetailResponse({
      item: app,
      server_time: fixedTime,
    }).item;
    return result;
  },
};

export const mockMetaWire = mockMeta;
