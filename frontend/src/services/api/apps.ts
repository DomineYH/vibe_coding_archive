import {
  mapAppWriteOperation,
  mapAppDetailResponse,
  mapAppPage,
  mapMeta,
  type AppWriteOperation,
} from "../../contracts/mappers";
import { contractError, ServiceError } from "../service-error";
import {
  appPatchToWire,
  appInputToWire,
  normalizeAppInput,
  normalizeQueryForService,
  type AppsService,
} from "../apps-service";
import { authService } from "./auth";
import { assertAuthObservation } from "../auth-state";
import { isUuid } from "../../contracts/uuid";

import { requestJson, apiContractError, type ApiEndpoint } from "./transport";
export async function getJson(
  endpoint: ApiEndpoint,
  path: string,
  {
    signal,
    method = "GET",
    requestBody,
    authenticated = false,
    write = false,
    allowAnonymousWrite = false,
    idempotencyKey,
    uncertain = false,
    noContent = false,
    includeStatus = false,
  }: {
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PATCH" | "DELETE";
    requestBody?: unknown;
    authenticated?: boolean;
    write?: boolean;
    allowAnonymousWrite?: boolean;
    idempotencyKey?: string;
    uncertain?: boolean;
    noContent?: boolean;
    includeStatus?: boolean;
  } = {},
): Promise<unknown> {
  const headers = new Headers({ Accept: "application/json" });
  if (authenticated || write) {
    let auth;
    try {
      auth = await authService.getCurrentAuthState({ signal });
    } catch (error) {
      if (!uncertain) throw error;
      throw new ServiceError(
        "SERVICE_UNAVAILABLE",
        "현재 인증 상태를 확인할 수 없어 저장 결과를 확정할 수 없어요.",
        {
          httpStatus: error instanceof ServiceError ? error.httpStatus : 503,
          outcome: "unknown",
        },
      );
    }
    const user = auth.user;
    if (
      auth.status !== "ready" ||
      (!user && !allowAnonymousWrite) ||
      (user !== null && !user.approved)
    )
      throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
        outcome: uncertain ? "unknown" : "rejected",
        httpStatus: 401,
      });
    if (user?.mustChangePassword || user?.sessionKind === "change_only")
      throw new ServiceError(
        "PASSWORD_CHANGE_REQUIRED",
        "회원 기능을 사용하기 전에 비밀번호를 변경해 주세요.",
        { outcome: uncertain ? "unknown" : "rejected", httpStatus: 403 },
      );
    if (!auth.flow.sessionGeneration)
      throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
        outcome: uncertain ? "unknown" : "rejected",
        httpStatus: 401,
      });
    headers.set("X-EduVibe-Flow-Id", auth.flow.flowId);
    headers.set("X-EduVibe-Auth-Revision", auth.flow.revision);
    headers.set("X-EduVibe-Session-Generation", auth.flow.sessionGeneration);
    if (write) {
      let csrf;
      try {
        csrf = await authService.getCsrf({ signal });
      } catch (error) {
        if (!uncertain) throw error;
        throw new ServiceError(
          "SERVICE_UNAVAILABLE",
          "요청 권한을 확인할 수 없어 저장 결과를 확정할 수 없어요.",
          {
            httpStatus: error instanceof ServiceError ? error.httpStatus : 503,
            outcome: "unknown",
          },
        );
      }
      headers.set("X-CSRF-Token", csrf.csrfToken);
    }
  }
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return requestJson(endpoint, path, {
    signal,
    method,
    requestBody,
    headers,
    uncertain,
    noContent,
    includeStatus,
  });
}

const appFieldAliases = new Map([
  ["theme_id", "themeId"],
  ["is_public", "isPublic"],
  ["stack_db", "stack.db"],
  ["stack_backend", "stack.backend"],
  ["stack_frontend", "stack.frontend"],
  ["stack_hosting", "stack.hosting"],
]);

function mapAppInputFailure(error: unknown): never {
  if (!(error instanceof ServiceError) || !error.fields) throw error;
  const fields = new Map<string, string>();
  for (const [wireField, message] of Object.entries(error.fields)) {
    const field = appFieldAliases.get(wireField) ?? wireField;
    const previous = fields.get(field);
    fields.set(field, previous ? `${previous}\n${message}` : message);
  }
  throw new ServiceError(error.code, error.message, {
    fields: Object.fromEntries(fields),
    outcome: error.outcome,
    httpStatus: error.httpStatus,
    requestId: error.requestId,
    reasons: error.reasons,
    retryAt: error.retryAt,
    serverTime: error.serverTime,
  });
}

function mapWriteResult<T>(mapper: (value: unknown) => T, value: unknown): T {
  try {
    return mapper(value);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "CONTRACT_ERROR")
      throw new ServiceError(
        "CONTRACT_ERROR",
        "서비스 응답 형식을 확인할 수 없어요.",
        { httpStatus: 201, outcome: "unknown" },
      );
    throw error;
  }
}

function requireSucceededOperation(
  operation: AppWriteOperation,
  kind: AppWriteOperation["kind"],
  targetId: string,
) {
  if (
    operation.kind !== kind ||
    (operation.targetId !== null && operation.targetId !== targetId)
  )
    throw new ServiceError(
      "CONTRACT_ERROR",
      "저장 작업 결과를 확인할 수 없어요.",
      { outcome: "unknown" },
    );
  if (operation.state === "rejected")
    throw new ServiceError(
      operation.rejectionCode === "VERSION_CONFLICT"
        ? "VERSION_CONFLICT"
        : "VALIDATION_ERROR",
      "저장 작업이 거절되었어요.",
      { outcome: "rejected" },
    );
  if (operation.state !== "succeeded" || operation.targetId !== targetId)
    throw new ServiceError(
      "SERVICE_UNAVAILABLE",
      "저장 결과가 아직 확정되지 않았어요.",
      { outcome: "unknown" },
    );
}

export const appsService: AppsService = {
  async getMeta({ signal } = {}) {
    return mapMeta(await getJson("GET /meta", "/meta", { signal }));
  },

  async list(query, { signal } = {}) {
    const normalized = normalizeQueryForService(query);
    // ponytail: Browser and Python Unicode versions can differ at the 100-point
    // UX precheck; the server owns matching and limits. Revisit the hint when
    // the client exposes the server's Unicode version.
    const params = new URLSearchParams();
    if (normalized.q) params.set("q", normalized.q);
    if (normalized.subject) params.set("subject", normalized.subject);
    if (normalized.grade) params.set("grade", normalized.grade);
    params.set("limit", String(normalized.limit));
    params.set("offset", String(normalized.offset));
    return mapAppPage(
      await getJson("GET /apps", `/apps?${params}`, { signal }),
    );
  },

  async get(id, { signal, readContext } = {}) {
    const path = `/apps/${encodeURIComponent(id)}`;
    if (!readContext)
      return mapAppDetailResponse(
        await getJson("GET /apps/{id}", path, { signal }),
      ).item;
    assertAuthObservation(readContext);
    const { user, flow, status } = readContext.state;
    if (
      status !== "ready" ||
      !user?.approved ||
      user.sessionKind !== "full" ||
      user.mustChangePassword ||
      !flow.sessionGeneration
    )
      throw new ServiceError("AUTH_REQUIRED", "로그인이 필요해요.", {
        httpStatus: 401,
      });
    try {
      const result = (await requestJson("GET /apps/{id}", path, {
        signal,
        cache: "no-store",
        includeHeaders: true,
        headers: new Headers({
          Accept: "application/json",
          "X-EduVibe-Flow-Id": flow.flowId,
          "X-EduVibe-Auth-Revision": flow.revision,
          "X-EduVibe-Session-Generation": flow.sessionGeneration,
        }),
      })) as { body: unknown; headers: Headers };
      assertAuthObservation(readContext);
      const responseFlow = result.headers.get("X-EduVibe-Flow-Id");
      const revision = result.headers.get("X-EduVibe-Auth-Revision");
      const generation = result.headers.get("X-EduVibe-Session-Generation");
      if (
        !responseFlow ||
        !isUuid(responseFlow) ||
        responseFlow !== responseFlow.toLowerCase() ||
        !revision ||
        !/^(0|[1-9][0-9]*)$/.test(revision) ||
        !generation ||
        !/^(0|[1-9][0-9]*)$/.test(generation) ||
        result.headers.get("Cache-Control") !== "private, no-store"
      )
        throw apiContractError(200, false);
      if (
        responseFlow !== flow.flowId ||
        revision !== flow.revision ||
        generation !== flow.sessionGeneration
      )
        throw new DOMException("Authentication context changed", "AbortError");
      const app = mapAppDetailResponse(result.body).item;
      assertAuthObservation(readContext);
      return app;
    } catch (error) {
      assertAuthObservation(readContext);
      throw error;
    }
  },

  async issueCreateOperation(input) {
    const normalized = normalizeAppInput(input);
    const operation = mapAppWriteOperation(
      await getJson("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        requestBody: {
          kind: "app_create",
          input: appInputToWire(normalized),
        },
      }).catch(mapAppInputFailure),
    );
    if (operation.kind !== "app_create" || operation.state !== "unresolved")
      throw contractError();
    return operation;
  },

  async create(input, operationKey) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(operationKey))
      throw new ServiceError("VALIDATION_ERROR", "저장 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const saved = mapWriteResult(
      (value) => mapAppDetailResponse(value).item,
      await getJson("POST /apps", "/apps", {
        method: "POST",
        write: true,
        uncertain: true,
        idempotencyKey: operationKey,
        requestBody: appInputToWire(input),
      }).catch(mapAppInputFailure),
    );
    const operation = await appsService.getCreateOperation(operationKey);
    requireSucceededOperation(operation, "app_create", saved.id);
    return saved;
  },

  async getCreateOperation(key, { signal } = {}) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(key))
      throw new ServiceError("VALIDATION_ERROR", "저장 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
        { authenticated: true, signal, uncertain: true },
      ),
    );
    if (operation.key !== key || operation.kind !== "app_create")
      throw apiContractError(200, true);
    return operation;
  },

  async issueUpdateOperation(id, patch, expectedVersion) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "수정 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        requestBody: {
          kind: "app_update",
          target_id: id,
          expected_version: expectedVersion,
          input: appPatchToWire(patch),
        },
      }).catch(mapAppInputFailure),
    );
    if (
      operation.kind !== "app_update" ||
      operation.targetId !== id ||
      operation.state !== "unresolved"
    )
      throw contractError();
    return operation;
  },

  async update(id, patch, expectedVersion, operationKey) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(operationKey) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "수정 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    const input = appPatchToWire(patch);
    const saved = mapWriteResult(
      (value) => {
        const app = mapAppDetailResponse(value).item;
        if (app.id !== id) throw contractError();
        return app;
      },
      await getJson("PATCH /apps/{id}", `/apps/${encodeURIComponent(id)}`, {
        method: "PATCH",
        write: true,
        uncertain: true,
        idempotencyKey: operationKey,
        requestBody: { expected_version: expectedVersion, ...input },
      }).catch(mapAppInputFailure),
    );
    const operation = await appsService.getUpdateOperation(operationKey);
    requireSucceededOperation(operation, "app_update", id);
    return saved;
  },

  async getUpdateOperation(key, { signal } = {}) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(key))
      throw new ServiceError("VALIDATION_ERROR", "저장 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
        { authenticated: true, signal, uncertain: true },
      ),
    );
    if (operation.key !== key || operation.kind !== "app_update")
      throw apiContractError(200, true);
    return operation;
  },

  async issueDeleteOperation(id, expectedVersion) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "삭제 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson("POST /write-operations", "/write-operations", {
        method: "POST",
        write: true,
        requestBody: {
          kind: "app_delete",
          target_id: id,
          expected_version: expectedVersion,
        },
      }),
    );
    if (
      operation.kind !== "app_delete" ||
      operation.targetId !== id ||
      operation.state !== "unresolved"
    )
      throw contractError();
    return operation;
  },

  async delete(id, expectedVersion, operationKey) {
    if (
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(id) ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(operationKey) ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 1
    )
      throw new ServiceError("VALIDATION_ERROR", "삭제 요청을 확인해 주세요.", {
        outcome: "rejected",
      });
    await getJson("DELETE /apps/{id}", `/apps/${encodeURIComponent(id)}`, {
      method: "DELETE",
      write: true,
      uncertain: true,
      noContent: true,
      idempotencyKey: operationKey,
      requestBody: { expected_version: expectedVersion },
    });
    const operation = await appsService.getDeleteOperation(operationKey);
    requireSucceededOperation(operation, "app_delete", id);
  },

  async getDeleteOperation(key, { signal } = {}) {
    if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/iu.test(key))
      throw new ServiceError("VALIDATION_ERROR", "삭제 작업을 확인해 주세요.", {
        outcome: "rejected",
      });
    const operation = mapAppWriteOperation(
      await getJson(
        "GET /write-operations/{key}",
        `/write-operations/${encodeURIComponent(key)}`,
        { authenticated: true, signal, uncertain: true },
      ),
    );
    if (operation.key !== key || operation.kind !== "app_delete")
      throw apiContractError(200, true);
    return operation;
  },
};
