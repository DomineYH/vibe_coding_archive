import catalog from "../../../../contracts/catalog.json";
import {
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
} from "../../contracts/mappers";
import type { components } from "../../contracts/api";
import { ServiceError } from "../service-error";
import {
  caseFold,
  normalizeQueryForService,
  type AppsService,
} from "../apps-service";
import { assertCurrentGeneration, getMockSnapshot } from "./state";
import { DEMO_ACCOUNTS } from "./accounts";

type WireAppDetail = components["schemas"]["AppDetail"];
type MockMeta = components["schemas"]["Meta"];
const subjects = catalog.subjects as MockMeta["subjects"];
const grades = catalog.grades as MockMeta["grades"];
const fixedTime = "2026-09-22T00:12:00.000Z";
const readDelayMs = 300;
const longCopy = Array.from(
  { length: 32 },
  (_, index) =>
    `${index + 1}. 학생의 풀이를 먼저 묻고, 개념을 설명한 뒤 새로운 예제로 이해를 확인합니다. 정답보다 풀이 과정을 격려하고, 필요한 경우 단계별 힌트를 제공합니다.`,
).join("\n\n");
const capabilities = {
  apps_read: { enabled: true, reasons: [] },
  auth_register: { enabled: true, reasons: [] },
  auth_login: { enabled: true, reasons: [] },
  auth_logout: { enabled: true, reasons: [] },
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
  subjects,
  grades,
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

function scenarioApps(state: Awaited<ReturnType<typeof beginRead>>) {
  const apps = state.apps as WireAppDetail[];
  if (
    state.scenario === "long_list" ||
    state.scenario === "duplicate_pages" ||
    state.scenario === "no_progress" ||
    state.scenario === "next_page_failure"
  ) {
    const expanded = [
      ...apps,
      ...Array.from({ length: 12 }, (_, index) => {
        const app = apps[index % apps.length];
        const createdAt = new Date(
          Date.parse(fixedTime) - index * 1000,
        ).toISOString();
        return {
          ...app,
          id: `00000000-0000-4000-8000-${String(index + 201).padStart(12, "0")}`,
          name: `${app.name} · 긴 목록 ${index + 1}`,
          created_at: createdAt,
          updated_at: createdAt,
        };
      }),
    ].sort(sortApps);
    if (
      state.scenario === "long_list" ||
      state.scenario === "no_progress" ||
      state.scenario === "next_page_failure"
    )
      return expanded;

    const firstPage = expanded.slice(0, 24);
    const duplicatePage = firstPage.map((app) => ({
      ...app,
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-01-01T00:00:00.000Z",
    }));
    const lastPage = firstPage.slice(0, 4).map((app, index) => ({
      ...app,
      id: `00000000-0000-4000-8000-${String(index + 301).padStart(12, "0")}`,
      name: `${app.name} · 마지막 페이지 ${index + 1}`,
      created_at: "2024-01-01T00:00:00.000Z",
      updated_at: "2024-01-01T00:00:00.000Z",
    }));
    return [...firstPage, ...duplicatePage, ...lastPage];
  }
  if (state.scenario === "long_copy")
    return apps.map((app, index) =>
      index === 0 ? { ...app, description: longCopy, prompt: longCopy } : app,
    );
  return apps;
}

function sortApps(left: WireAppDetail, right: WireAppDetail): number {
  return (
    Date.parse(right.created_at) - Date.parse(left.created_at) ||
    right.id.localeCompare(left.id)
  );
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
    const normalized = normalizeQueryForService(query);
    const state = await beginRead(signal);
    if (
      state.scenario === "list_failure" ||
      state.scenario === "list_refetch_failure"
    ) {
      if (state.scenario === "list_refetch_failure") {
        await new Promise((resolve) => setTimeout(resolve, readDelayMs));
        assertCurrentGeneration(state.generation, signal);
      }
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "목록을 불러오지 못했어요. 다시 시도해 주세요.",
      );
    }
    if (state.scenario === "next_page_failure" && normalized.offset > 0) {
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "다음 목록을 불러오지 못했어요.",
      );
    }
    if (state.scenario === "list_delayed") {
      const ignoreAbort = normalized.q === "slow";
      await new Promise((resolve) =>
        setTimeout(resolve, ignoreAbort ? readDelayMs * 3 : readDelayMs),
      );
      // Exercise query-key isolation even when a transport cannot cancel.
      assertCurrentGeneration(
        state.generation,
        ignoreAbort ? undefined : signal,
      );
    }
    const publicApps = state.scenario === "empty" ? [] : scenarioApps(state);
    const matching = publicApps.filter((app) => {
      if (!app.is_public) return false;
      if (normalized.subject && app.subject !== normalized.subject)
        return false;
      if (normalized.grade && !app.grades.includes(normalized.grade))
        return false;
      if (!normalized.q) return true;
      return [app.name, app.owner.nickname, app.description].some((field) =>
        caseFold(field.normalize("NFC")).includes(normalized.q!),
      );
    });
    const subjectsInUse = new Set(
      publicApps.filter((app) => app.is_public).map((app) => app.subject),
    );
    if (state.scenario !== "visual_fixture") matching.sort(sortApps);
    const offset =
      state.scenario === "no_progress" && normalized.offset > 0
        ? 0
        : normalized.offset;
    const page = {
      items: matching
        .slice(normalized.offset, normalized.offset + normalized.limit)
        .map(toCard),
      pagination: {
        limit: normalized.limit,
        offset,
        total: matching.length,
        has_more: normalized.offset + normalized.limit < matching.length,
      },
      server_time: fixedTime,
      facets: {
        subjects_in_use: subjects.filter((subject) =>
          subjectsInUse.has(subject),
        ),
      },
    };
    return mapAppPage(page);
  },

  async get(id, { signal } = {}) {
    const state = await beginRead(signal);
    if (state.scenario === "detail_delayed") {
      await new Promise((resolve) => setTimeout(resolve, readDelayMs));
      assertCurrentGeneration(state.generation, signal);
    }
    const app = [...scenarioApps(state), ...state.private_apps].find(
      (item) => item.id === id,
    );
    const account = DEMO_ACCOUNTS.find(
      (item) => item.id === state.principal_id,
    );
    const canReadPrivate =
      app?.is_public ||
      (account !== undefined &&
        (account.role === "admin" || app?.owner.id === account.id));
    if (!app || !canReadPrivate)
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
