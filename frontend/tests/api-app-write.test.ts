import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getCurrentAuthState: vi.fn(),
  getCsrf: vi.fn(),
}));

vi.mock("../src/services/api/auth", () => ({ authService: authMock }));

import { appsService } from "../src/services/api/apps";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const key = "00000000-0000-4000-8000-000000000201";
const ownerId = "00000000-0000-4000-8000-000000000101";
const appId = "00000000-0000-4000-8000-000000000301";
const input = {
  name: "  새 수업 도구  ",
  url: " https://example.com/class#intro ",
  prompt: "질문\r\n답변",
  description: "수업 설명",
  subject: "수학" as const,
  grades: ["중1", "초3"] as const,
  isPublic: true,
  themeId: "niagara",
  stack: { db: "", backend: "", frontend: "React", hosting: "Vercel" },
};
const issued = {
  key,
  kind: "app_create",
  target_id: null,
  issued_at: "2026-09-22T00:12:00.000Z",
  expires_at: "2026-09-23T00:12:00.000Z",
  state: "unresolved",
  db_applied_at: null,
  finalized_at: null,
  result_version: null,
  rejection_code: null,
  server_time: "2026-09-22T00:12:00.000Z",
};
const created = {
  item: {
    id: appId,
    owner: { id: ownerId, nickname: "교사김코딩" },
    name: "새 수업 도구",
    subject: "수학",
    grades: ["초3", "중1"],
    is_public: true,
    theme_id: "niagara",
    version: 1,
    url_version: 1,
    health: {
      result: { state: "unchecked", checked_at: null, fresh_until: null },
      latest_job: null,
      next_check_at: null,
    },
    url: "https://example.com/class#intro",
    prompt: "질문\n답변",
    description: "수업 설명",
    stack_db: null,
    stack_backend: null,
    stack_frontend: "React",
    stack_hosting: "Vercel",
    created_at: "2026-09-22T00:12:00.000Z",
    updated_at: "2026-09-22T00:12:00.000Z",
  },
  server_time: "2026-09-22T00:12:00.000Z",
};

beforeEach(() => {
  authMock.getCurrentAuthState.mockResolvedValue({
    status: "ready",
    user: {
      id: ownerId,
      role: "user",
      approved: true,
      sessionKind: "full",
      mustChangePassword: false,
    },
    flow: {
      flowId: "00000000-0000-4000-8000-000000000200",
      revision: "4",
      sessionGeneration: "2",
    },
  });
  authMock.getCsrf.mockResolvedValue({ csrfToken: "csrf-test-token" });
});

describe("app write API", () => {
  it("issues an operation key without treating issuance as a saved app", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(issued), { status: 201 }),
        ),
    );

    await expect(
      appsService.issueCreateOperation(input),
    ).resolves.toMatchObject({
      key,
      state: "unresolved",
      targetId: null,
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("/api/v1/write-operations");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "app_create",
      input: {
        name: "새 수업 도구",
        url: "https://example.com/class#intro",
        prompt: "질문\n답변",
        description: "수업 설명",
        subject: "수학",
        grades: ["초3", "중1"],
        is_public: true,
        theme_id: "niagara",
        stack_db: null,
        stack_backend: null,
        stack_frontend: "React",
        stack_hosting: "Vercel",
      },
    });
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe(
      "csrf-test-token",
    );
  });

  it("creates once with the issued key and maps the confirmed detail", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(issued), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), { status: 201 }),
      );
    vi.stubGlobal("fetch", fetch);

    const operation = await appsService.issueCreateOperation(input);
    await expect(
      appsService.create(input, operation.key),
    ).resolves.toMatchObject({
      id: appId,
      ownerId,
      version: 1,
      urlVersion: 1,
      health: { result: { state: "unchecked", checked_at: null } },
    });
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("/api/v1/apps");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(key);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves an unknown create outcome and never retries automatically", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetch);

    await expect(appsService.create(input, key)).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      outcome: "unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats an already-resolved key as an instruction to check its result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "OPERATION_ALREADY_RESOLVED",
              message: "Check the result",
              request_id: null,
            },
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(appsService.create(input, key)).rejects.toMatchObject({
      code: "OPERATION_ALREADY_RESOLVED",
      outcome: "unknown",
    });
  });
});
