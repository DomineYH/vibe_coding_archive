import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getCurrentAuthState: vi.fn(),
  getCsrf: vi.fn(),
}));

vi.mock("../src/services/api/auth", () => ({ authService: authMock }));

import { appsService } from "../src/services/api/apps";
import { ServiceError } from "../src/services/service-error";

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
const createSucceeded = {
  ...issued,
  state: "succeeded",
  target_id: appId,
  db_applied_at: issued.server_time,
  finalized_at: issued.server_time,
  result_version: 1,
};
const updateSucceeded = {
  ...updateIssued,
  state: "succeeded",
  db_applied_at: issued.server_time,
  finalized_at: issued.server_time,
  result_version: 2,
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
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(createSucceeded), { status: 200 }),
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
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("does not treat a successful write response as success without a succeeded operation record", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(issued), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(appsService.create(input, key)).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      outcome: "unknown",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe(`/api/v1/write-operations/${key}`);
  });

  it("does not confirm a write from a different operation key's record", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(created), { status: 201 }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...createSucceeded,
            key: "00000000-0000-4000-8000-000000000202",
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetch);

    await expect(appsService.create(input, key)).rejects.toMatchObject({
      code: "CONTRACT_ERROR",
      outcome: "unknown",
    });
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
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(updateSucceeded), { status: 200 }),
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
    expect(fetch.mock.calls[2][0]).toBe(`/api/v1/write-operations/${key}`);
    expect(fetch).toHaveBeenCalledTimes(3);
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
      )
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
    expect(fetch.mock.calls[2][0]).toBe(`/api/v1/write-operations/${key}`);
    expect(fetch).toHaveBeenCalledTimes(4);
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

  it.each([
    { status: 401, code: "AUTH_REQUIRED" },
    { status: 503, code: "SERVICE_UNAVAILABLE" },
    { status: 410, code: "OPERATION_EXPIRED" },
  ])("keeps a retry's $code result unknown", async ({ status, code }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code,
              message: "결과를 확정할 수 없어요.",
              request_id: null,
            },
          }),
          { status },
        ),
      ),
    );

    await expect(appsService.create(input, key)).rejects.toMatchObject({
      code,
      outcome: "unknown",
      httpStatus: status,
    });
  });

  it.each([
    { status: 401, code: "AUTH_REQUIRED" },
    { status: 404, code: "OPERATION_NOT_FOUND" },
    { status: 410, code: "OPERATION_EXPIRED" },
    { status: 503, code: "SERVICE_UNAVAILABLE" },
  ])(
    "keeps a $code result lookup failure unknown",
    async ({ status, code }) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              error: {
                code,
                message: "작업 결과를 확인할 수 없어요.",
                request_id: null,
              },
            }),
            { status },
          ),
        ),
      );

      await expect(appsService.getCreateOperation(key)).rejects.toMatchObject({
        code,
        outcome: "unknown",
        httpStatus: status,
      });
    },
  );

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

const errorMetadata = {
  request_id: "request-151",
  reasons: ["not_implemented"],
  retry_at: "2026-09-22T00:13:00.000Z",
  server_time: "2026-09-22T00:12:00.000Z",
};
const preservedMetadata = {
  requestId: "request-151",
  reasons: ["not_implemented"],
  retryAt: "2026-09-22T00:13:00.000Z",
  serverTime: "2026-09-22T00:12:00.000Z",
};
const createStages = [
  {
    stage: "issuance",
    run: () => appsService.issueCreateOperation(input),
    uncertain: false,
  },
  {
    stage: "create",
    run: () => appsService.create(input, key),
    uncertain: true,
  },
];

function respondWithError(
  status: number,
  error: Record<string, unknown>,
  envelope = {},
) {
  const fetch = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ error, ...envelope }), { status }),
    );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe.each(createStages)(
  "app-create $stage errors",
  ({ run, uncertain }) => {
    it.each([
      { status: 400, code: "BAD_REQUEST" },
      { status: 413, code: "PAYLOAD_TOO_LARGE" },
      { status: 503, code: "FEATURE_UNAVAILABLE" },
    ])(
      "preserves contract-listed $status $code and metadata without retrying",
      async ({ status, code }) => {
        const fetch = respondWithError(status, {
          code,
          message: "서버의 원래 안내",
          ...errorMetadata,
          fields: { name: "이름 안내" },
        });
        await expect(run()).rejects.toMatchObject({
          code,
          message: "서버의 원래 안내",
          httpStatus: status,
          outcome: uncertain && status === 503 ? "unknown" : "not_applicable",
          fields: { name: "이름 안내" },
          ...preservedMetadata,
        });
        expect(fetch).toHaveBeenCalledTimes(1);
      },
    );

    it("maps every wire field to its form key while preserving same-name, form and unknown fields", async () => {
      const fields = {
        theme_id: "테마 안내",
        is_public: "공개 안내",
        stack_db: "DB 안내",
        stack_backend: "백엔드 안내",
        stack_frontend: "프론트엔드 안내",
        stack_hosting: "호스팅 안내",
        name: "이름 안내",
        url: "URL 안내",
        prompt: "프롬프트 안내",
        description: "설명 안내",
        subject: "과목 안내",
        grades: "학년 안내",
        form: "전체 양식 안내",
        future_field: "새 필드 안내",
        constructor: "알 수 없는 키 안내",
      };
      respondWithError(422, {
        code: "VALIDATION_ERROR",
        message: "서버 검증 안내",
        ...errorMetadata,
        fields,
      });
      await expect(run()).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: "서버 검증 안내",
        httpStatus: 422,
        outcome: "not_applicable",
        ...preservedMetadata,
        fields: {
          themeId: "테마 안내",
          isPublic: "공개 안내",
          "stack.db": "DB 안내",
          "stack.backend": "백엔드 안내",
          "stack.frontend": "프론트엔드 안내",
          "stack.hosting": "호스팅 안내",
          name: "이름 안내",
          url: "URL 안내",
          prompt: "프롬프트 안내",
          description: "설명 안내",
          subject: "과목 안내",
          grades: "학년 안내",
          form: "전체 양식 안내",
          future_field: "새 필드 안내",
          constructor: "알 수 없는 키 안내",
        },
      });
    });

    it("keeps already normalized field names", async () => {
      const fields = { themeId: "테마", isPublic: "공개", "stack.db": "DB" };
      respondWithError(422, {
        code: "VALIDATION_ERROR",
        message: "검증",
        request_id: null,
        fields,
      });
      await expect(run()).rejects.toMatchObject({ fields });
    });

    it("preserves both messages if wire and normalized field names collide", async () => {
      respondWithError(422, {
        code: "VALIDATION_ERROR",
        message: "검증",
        request_id: null,
        fields: { theme_id: "wire 안내", themeId: "form 안내" },
      });
      const error = await run().catch((error: unknown) => error);
      expect(error).toMatchObject({
        fields: { themeId: expect.stringContaining("wire 안내") },
      });
      expect(error).toMatchObject({
        fields: { themeId: expect.stringContaining("form 안내") },
      });
    });

    it("preserves accepted errors without fields", async () => {
      respondWithError(422, {
        code: "VALIDATION_ERROR",
        message: "검증",
        ...errorMetadata,
      });
      await expect(run()).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        fields: undefined,
        ...preservedMetadata,
      });
    });

    it("passes AbortError through", async () => {
      const error = new DOMException("Cancelled", "AbortError");
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
      await expect(run()).rejects.toBe(error);
    });

    it.each([
      {
        label: "missing request_id",
        error: { code: "VALIDATION_ERROR", message: "검증" },
        envelope: {},
      },
      {
        label: "extra envelope key",
        error: { code: "VALIDATION_ERROR", message: "검증", request_id: null },
        envelope: { extra: true },
      },
      {
        label: "non-string field",
        error: {
          code: "VALIDATION_ERROR",
          message: "검증",
          request_id: null,
          fields: { name: 151 },
        },
        envelope: {},
      },
    ])("rejects a malformed $label envelope", async ({ error, envelope }) => {
      respondWithError(422, error, envelope);
      await expect(run()).rejects.toMatchObject({
        code: "CONTRACT_ERROR",
        httpStatus: 422,
        outcome: uncertain ? "unknown" : "not_applicable",
      });
    });

    it.each([
      { status: 400, code: "FEATURE_UNAVAILABLE" },
      { status: 413, code: "BAD_REQUEST" },
      { status: 503, code: "PAYLOAD_TOO_LARGE" },
    ])("rejects the unlisted $status $code tuple", async ({ status, code }) => {
      respondWithError(status, { code, message: "안내", request_id: null });
      await expect(run()).rejects.toMatchObject({
        code: "CONTRACT_ERROR",
        httpStatus: status,
        outcome: uncertain ? "unknown" : "not_applicable",
      });
    });
  },
);

describe.each([
  {
    stage: "issuance",
    run: () => appsService.issueUpdateOperation(appId, input, 1),
    path: "/api/v1/write-operations",
    method: "POST",
  },
  {
    stage: "update",
    run: () => appsService.update(appId, input, 1, key),
    path: `/api/v1/apps/${appId}`,
    method: "PATCH",
  },
])("app-update $stage errors", ({ run, path, method }) => {
  it("maps every wire field exactly and preserves metadata without another write or result lookup", async () => {
    const fetch = respondWithError(422, {
      code: "VALIDATION_ERROR",
      message: "서버 검증 안내",
      ...errorMetadata,
      fields: {
        theme_id: "테마 안내",
        is_public: "공개 안내",
        stack_db: "DB 안내",
        stack_backend: "백엔드 안내",
        stack_frontend: "프론트엔드 안내",
        stack_hosting: "호스팅 안내",
        name: "이름 안내",
        form: "전체 양식 안내",
        future_field: "새 필드 안내",
      },
    });
    const error = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ServiceError);
    if (!(error instanceof ServiceError)) throw error;
    expect(fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [path, method],
    ]);
    expect(error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "서버 검증 안내",
      httpStatus: 422,
      outcome: "not_applicable",
      ...preservedMetadata,
    });
    expect(error.fields).toEqual({
      themeId: "테마 안내",
      isPublic: "공개 안내",
      "stack.db": "DB 안내",
      "stack.backend": "백엔드 안내",
      "stack.frontend": "프론트엔드 안내",
      "stack.hosting": "호스팅 안내",
      name: "이름 안내",
      form: "전체 양식 안내",
      future_field: "새 필드 안내",
    });
  });

  it("keeps already mapped field names", async () => {
    const fields = { themeId: "테마", isPublic: "공개", "stack.db": "DB" };
    respondWithError(422, {
      code: "VALIDATION_ERROR",
      message: "검증",
      request_id: null,
      fields,
    });
    const error = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ServiceError);
    if (!(error instanceof ServiceError)) throw error;
    expect(error.fields).toEqual(fields);
  });

  it("joins both messages when wire and form names collide", async () => {
    respondWithError(422, {
      code: "VALIDATION_ERROR",
      message: "검증",
      request_id: null,
      fields: { theme_id: "wire 안내", themeId: "form 안내" },
    });
    const error = await run().catch((error: unknown) => error);
    expect(error).toBeInstanceOf(ServiceError);
    if (!(error instanceof ServiceError)) throw error;
    expect(error.fields).toEqual({ themeId: "wire 안내\nform 안내" });
  });

  it("preserves version-conflict errors without fields", async () => {
    const fetch = respondWithError(409, {
      code: "VERSION_CONFLICT",
      message: "앱이 다른 내용으로 수정되었어요.",
      ...errorMetadata,
    });
    await expect(run()).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      message: "앱이 다른 내용으로 수정되었어요.",
      httpStatus: 409,
      outcome: "rejected",
      fields: undefined,
      ...preservedMetadata,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes AbortError through without retrying", async () => {
    const error = new DOMException("Cancelled", "AbortError");
    const fetch = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetch);
    await expect(run()).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("does not extend app POST error acceptance to GET /apps", async () => {
  respondWithError(400, {
    code: "BAD_REQUEST",
    message: "안내",
    request_id: null,
  });
  await expect(appsService.list({})).rejects.toMatchObject({
    code: "CONTRACT_ERROR",
    httpStatus: 400,
    outcome: "not_applicable",
  });
});

it.each([
  [400, "BAD_REQUEST"],
  [413, "PAYLOAD_TOO_LARGE"],
  [503, "FEATURE_UNAVAILABLE"],
] as const)(
  "recognizes PATCH %s %s and retains uncertain execution",
  async (status, code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code, message: "편집 오류", request_id: null },
          }),
          { status },
        ),
      ),
    );
    await expect(
      appsService.update(appId, { name: "편집" }, 1, key),
    ).rejects.toMatchObject({
      code,
      httpStatus: status,
      outcome: status >= 500 ? "unknown" : "not_applicable",
    });
  },
);
