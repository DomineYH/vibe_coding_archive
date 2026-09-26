import { describe, expect, it } from "vitest";
import catalog from "../../contracts/catalog.json";
import {
  mapAuthResult,
  mapAuthFlowContext,
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
  mapRegisteredUser,
  mapSelf,
} from "../src/contracts/mappers";

const capability = { enabled: false, reasons: ["not_implemented"] };
const meta = {
  subjects: catalog.subjects,
  grades: catalog.grades,
  themes: [
    {
      id: "sage",
      name: "Sage",
      pantone: "15-6414",
      from: "#A2B187",
      to: "#D0D8B8",
      ink: "dark",
    },
  ],
  server_time: "2026-09-22T00:12:00.000Z",
  capabilities: Object.fromEntries(
    [
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
    ].map((key) => [key, capability]),
  ),
  support: { email: null, service_url: null, announcement_url: null },
  initial_pending_days: 90,
};

const card = {
  id: "00000000-0000-4000-8000-000000000001",
  owner: { id: "00000000-0000-4000-8000-000000000101", nickname: "김 선생님" },
  name: "분수 피자 가게",
  subject: "수학",
  grades: ["초3"],
  is_public: true,
  theme_id: "sage",
  version: 1,
  url_version: 1,
  health: {
    result: {
      state: "healthy",
      checked_at: "2026-09-22T00:12:00.000Z",
      fresh_until: null,
    },
    latest_job: null,
    next_check_at: null,
  },
};

const page = {
  items: [card],
  pagination: { limit: 24, offset: 0, total: 1, has_more: false },
  server_time: "2026-09-22T00:12:00.000Z",
  facets: { subjects_in_use: ["수학"] },
};

describe("response mappers", () => {
  it("maps authentication flow identity and sequence metadata", () => {
    const flow = {
      flow_id: "00000000-0000-4000-8000-000000000200",
      revision: "12",
      session_generation: "4",
      last_identity_change_revision: "9",
    };

    expect(mapAuthFlowContext(flow)).toEqual({
      flowId: flow.flow_id,
      revision: "12",
      sessionGeneration: "4",
      lastIdentityChangeRevision: "9",
    });
    expect(
      mapAuthFlowContext({ ...flow, session_generation: null })
        .sessionGeneration,
    ).toBeNull();
  });

  it("rejects malformed authentication flow sequence metadata", () => {
    const flow = {
      flow_id: "00000000-0000-4000-8000-000000000200",
      revision: "12",
      session_generation: "4",
      last_identity_change_revision: "9",
    };
    for (const invalid of ["01", "-1", 12, "1.0"]) {
      expect(() =>
        mapAuthFlowContext({ ...flow, revision: invalid }),
      ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    }
  });

  it("keeps member ID, login ID, and nickname as separate auth fields", () => {
    const member = {
      id: "00000000-0000-4000-8000-000000000101",
      login_id: "teacher-login",
      nickname: "수학쌤",
      role: "user",
      approved: true,
      must_change_password: false,
      session_kind: "full",
      expires_at: "2026-09-22T08:12:00.000Z",
      email: null,
      phone: null,
      recent_auth_until: null,
    };
    expect(mapSelf(member)).toMatchObject({
      id: member.id,
      loginId: "teacher-login",
      nickname: "수학쌤",
    });
    expect(
      mapAuthResult({ user: member, csrf_token: "mock-token" }).csrfToken,
    ).toBe("mock-token");
  });

  it("rejects inconsistent or incomplete authentication restore responses", () => {
    const valid = {
      id: "00000000-0000-4000-8000-000000000101",
      login_id: "teacher-login",
      nickname: "수학쌤",
      role: "user",
      approved: true,
      must_change_password: false,
      session_kind: "full",
      expires_at: "2026-09-22T08:12:00.000Z",
      email: null,
      phone: null,
      recent_auth_until: null,
    };
    expect(() => mapSelf({ ...valid, id: "not-a-uuid" })).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
    expect(() => mapSelf({ ...valid, login_id: undefined })).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
    expect(() => mapSelf({ ...valid, approved: false })).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
  });

  it("maps only approved change-only sessions without full-session metadata", () => {
    const changeOnly = {
      id: "00000000-0000-4000-8000-000000000107",
      login_id: "temporary-teacher",
      nickname: "임시 계정 교사",
      role: "user",
      approved: true,
      must_change_password: true,
      session_kind: "change_only",
      expires_at: "2026-09-22T00:27:00.000Z",
    };
    expect(mapSelf(changeOnly)).toMatchObject({
      mustChangePassword: true,
      sessionKind: "change_only",
      expiresAt: changeOnly.expires_at,
      email: null,
      phone: null,
      recentAuthUntil: null,
    });
    expect(() => mapSelf({ ...changeOnly, approved: false })).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
  });

  it("maps a strict unapproved registration response without contact fields", () => {
    const registered = {
      id: "00000000-0000-4000-8000-000000000107",
      login_id: "teacher_1",
      nickname: "새 교사",
      approved: false,
      pending_expires_at: "2026-12-21T00:12:00.000Z",
    };
    expect(mapRegisteredUser(registered)).toEqual({
      id: registered.id,
      loginId: "teacher_1",
      nickname: "새 교사",
      approved: false,
      pendingExpiresAt: registered.pending_expires_at,
    });
    expect(() => mapRegisteredUser({ ...registered, approved: true })).toThrow(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
    expect(() =>
      mapRegisteredUser({ ...registered, email: "x@example.invalid" }),
    ).toThrow(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("maps the catalog and snake-case app fields into display data", () => {
    expect(mapMeta(meta).themes[0].id).toBe("sage");
    expect(mapAppPage(page).items[0]).toMatchObject({
      id: card.id,
      ownerId: card.owner.id,
      owner: "김 선생님",
      themeId: "sage",
      health: { result: { state: "healthy" } },
    });
  });

  it("rejects timestamps whose calendar date rolls over", () => {
    expect(() =>
      mapMeta({ ...meta, server_time: "2026-02-30T00:00:00.000Z" }),
    ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("rejects unknown, repeated, or out-of-order gallery catalog values", () => {
    for (const subjects_in_use of [
      ["Unknown"],
      ["수학", "수학"],
      ["과학", "수학"],
    ]) {
      expect(() =>
        mapAppPage({
          ...page,
          facets: { subjects_in_use },
        }),
      ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
    }
    expect(() => mapMeta({ ...meta, grades: ["중4"] })).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
  });

  it("rejects missing fields and unsupported health values instead of supplying normal defaults", () => {
    expect(() => mapAppPage({ ...page, pagination: undefined })).toThrowError(
      expect.objectContaining({ code: "CONTRACT_ERROR" }),
    );
    expect(() =>
      mapAppPage({
        ...page,
        items: [
          {
            ...card,
            health: {
              ...card.health,
              result: { ...card.health.result, state: "ok" },
            },
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "CONTRACT_ERROR" }));
  });

  it("maps detail-only data through the same strict contract", () => {
    const detail = {
      ...card,
      url: "https://example.edu/app",
      prompt: "수업 앱을 만들어 주세요.",
      description: "분수 수업에서 사용합니다.",
      stack_db: null,
      stack_backend: null,
      stack_frontend: "React",
      stack_hosting: "Vercel",
      created_at: "2026-04-01T15:00:00.000Z",
      updated_at: "2026-04-01T15:00:00.000Z",
    };
    expect(
      mapAppDetailResponse({ item: detail, server_time: page.server_time }).item
        .stack,
    ).toEqual({
      db: null,
      backend: null,
      frontend: "React",
      hosting: "Vercel",
    });
  });

  it("rejects missing detail fields and invalid nullable field values", () => {
    const detail = {
      ...card,
      url: "https://example.edu/app",
      prompt: "수업 앱을 만들어 주세요.",
      description: "분수 수업에서 사용합니다.",
      stack_db: null,
      stack_backend: null,
      stack_frontend: "React",
      stack_hosting: null,
      created_at: "2026-04-01T15:00:00.000Z",
      updated_at: "2026-04-01T15:00:00.000Z",
    };
    const response = { item: detail, server_time: page.server_time };

    for (const field of [
      "url",
      "prompt",
      "description",
      "stack_db",
      "stack_backend",
      "stack_frontend",
      "stack_hosting",
      "created_at",
      "updated_at",
    ]) {
      const item: Record<string, unknown> = { ...detail };
      delete item[field];
      expect(() => mapAppDetailResponse({ ...response, item })).toThrowError(
        expect.objectContaining({ code: "CONTRACT_ERROR" }),
      );
    }

    for (const [field, value] of [
      ["url", null],
      ["prompt", null],
      ["description", 42],
      ["stack_db", 42],
      ["stack_hosting", false],
      ["created_at", null],
    ] as const) {
      const item: Record<string, unknown> = { ...detail, [field]: value };
      expect(() => mapAppDetailResponse({ ...response, item })).toThrowError(
        expect.objectContaining({ code: "CONTRACT_ERROR" }),
      );
    }
  });
});
