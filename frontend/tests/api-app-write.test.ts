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
const updateIssued = {
  ...issued,
  kind: "app_update",
  target_id: appId,
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

  it("issues an update key, then PATCHes only supplied fields with the expected version", async () => {
    const updated = {
      ...created,
      item: { ...created.item, is_public: false, version: 2 },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updateIssued), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updated), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);

    const operation = await appsService.issueUpdateOperation(
      appId,
      { isPublic: false, stack: { db: null } },
      1,
    );
    expect(operation).toMatchObject({
      kind: "app_update",
      targetId: appId,
      state: "unresolved",
    });
    await expect(
      appsService.update(
        appId,
        { isPublic: false, stack: { db: null } },
        1,
        key,
      ),
    ).resolves.toMatchObject({ id: appId, isPublic: false, version: 2 });

    const [operationUrl, operationInit] = fetch.mock.calls[0];
    expect(operationUrl).toBe("/api/v1/write-operations");
    expect(JSON.parse(String(operationInit?.body))).toEqual({
      kind: "app_update",
      target_id: appId,
      expected_version: 1,
      input: { is_public: false, stack_db: null },
    });
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe(`/api/v1/apps/${appId}`);
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({
      expected_version: 1,
      is_public: false,
      stack_db: null,
    });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe(key);
  });

  it("deletes only with the issued key and accepts the confirmed 204 result", async () => {
    const deleteIssued = { ...issued, kind: "app_delete", target_id: appId };
    const deleteSucceeded = {
      ...deleteIssued,
      state: "succeeded",
      db_applied_at: issued.server_time,
      finalized_at: issued.server_time,
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(deleteIssued), { status: 201 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(deleteSucceeded), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);

    const operation = await appsService.issueDeleteOperation(appId, 7);
    expect(operation).toMatchObject({
      kind: "app_delete",
      targetId: appId,
      state: "unresolved",
    });
    await expect(appsService.delete(appId, 7, key)).resolves.toBeUndefined();
    await expect(appsService.getDeleteOperation(key)).resolves.toMatchObject({
      kind: "app_delete",
      state: "succeeded",
      targetId: appId,
    });

    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
      kind: "app_delete",
      target_id: appId,
      expected_version: 7,
    });
    expect(fetch.mock.calls[1][0]).toBe(`/api/v1/apps/${appId}`);
    expect(fetch.mock.calls[1][1]?.method).toBe("DELETE");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      expected_version: 7,
    });
    expect(
      new Headers(fetch.mock.calls[1][1]?.headers).get("Idempotency-Key"),
    ).toBe(key);
  });

  it("preserves a pending deletion result as unknown rather than rejection", async () => {
    const deleteIssued = { ...issued, kind: "app_delete", target_id: appId };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify(deleteIssued), { status: 201 }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: {
                code: "DELETION_CONFIRMATION_PENDING",
                message: "앱 삭제 확인을 기다리고 있어요.",
                request_id: null,
              },
            }),
            { status: 503 },
          ),
        ),
    );
    const operation = await appsService.issueDeleteOperation(appId, 1);

    await expect(
      appsService.delete(appId, 1, operation.key),
    ).rejects.toMatchObject({
      code: "DELETION_CONFIRMATION_PENDING",
      outcome: "unknown",
      httpStatus: 503,
    });
  });

  it("reports an expected-version conflict as a confirmed rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "VERSION_CONFLICT",
              message: "앱이 다른 내용으로 수정되었어요.",
              request_id: null,
            },
          }),
          { status: 409 },
        ),
      ),
    );

    await expect(
      appsService.update(appId, { name: "다른 이름" }, 1, key),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", outcome: "rejected" });
    expect(fetch).toHaveBeenCalledTimes(1);
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
