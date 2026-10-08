import Ajv from "ajv";
import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import catalog from "../../contracts/catalog.json";
import publicApps from "../src/fixtures/public-apps.json";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const openapi = load(
  readFileSync(path.join(root, "contracts/openapi.yaml"), "utf8"),
);
const validateAppDetail = new Ajv({ allErrors: true }).compile({
  $schema: "http://json-schema.org/draft-07/schema#",
  components: openapi.components,
  $ref: "#/components/schemas/AppDetail",
});

describe("OpenAPI app detail schema", () => {
  it("defines public liveness and readiness outside the API version", () => {
    for (const [path, operation, statuses] of [
      ["/healthz", openapi.paths["/healthz"].get, ["200"]],
      ["/readyz", openapi.paths["/readyz"].get, ["200", "503"]],
    ]) {
      expect(operation.operationId).toBeDefined();
      expect(operation.security).toEqual([]);
      expect(operation.servers).toEqual([{ url: "/" }]);
      expect(Object.keys(operation.responses).sort()).toEqual(statuses);
      expect(path.startsWith("/api/v1")).toBe(false);
    }
    expect(
      openapi.paths["/healthz"].get.responses["200"].content["application/json"]
        .schema.$ref,
    ).toBe("#/components/schemas/LivenessResponse");
    expect(
      openapi.paths["/readyz"].get.responses["200"].content["application/json"]
        .schema.$ref,
    ).toBe("#/components/schemas/ReadyResponse");
    expect(
      openapi.paths["/readyz"].get.responses["503"].content["application/json"]
        .schema.$ref,
    ).toBe("#/components/schemas/NotReadyResponse");
    for (const [name, status] of [
      ["LivenessResponse", "ok"],
      ["ReadyResponse", "ready"],
      ["NotReadyResponse", "not_ready"],
    ]) {
      expect(openapi.components.schemas[name]).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: { type: "string", enum: [status] } },
      });
    }
  });

  it("defines normal authentication flow observation metadata", () => {
    const operation = openapi.paths["/auth/flow-state"].get;
    const response = operation.responses["200"];
    const flow = openapi.components.schemas.AuthFlowState;
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({
        name: "X-EduVibe-Flow-Id",
        in: "header",
        required: true,
      }),
    );
    expect(operation.security).toEqual([{ RecoveryCookie: [] }]);
    expect(response.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/AuthFlowState",
    );
    expect(flow.required).toEqual([
      "flow_id",
      "revision",
      "server_time",
      "expires_at",
      "recovery_ready",
      "session_generation",
      "session_cookie_present",
      "last_identity_change_revision",
      "pending_transition",
      "requested_transition",
      "next_transition_id",
    ]);
    expect(flow.properties.revision.pattern).toBe("^(0|[1-9][0-9]*)$");
    expect(flow.properties.last_identity_change_revision.pattern).toBe(
      "^(0|[1-9][0-9]*)$",
    );
  });

  it("defines explicit recovery and auth-transition operations", () => {
    const paths = openapi.paths;
    const transition = openapi.components.schemas.AuthTransition;
    expect(paths["/auth/flows"].post.responses["201"]).toBeDefined();
    expect(
      paths["/auth/flows/{flow_id}/recovery-cookie"].post.responses["201"],
    ).toBeDefined();
    expect(
      paths["/auth/flows/{flow_id}/ready"].post.responses["200"],
    ).toBeDefined();
    expect(paths["/auth/recovery-context"].get.responses["200"]).toBeDefined();
    expect(paths["/auth/transitions"].post.responses["201"]).toBeDefined();
    expect(
      paths["/auth/transitions/{transition_id}/settle"].post.responses["200"],
    ).toBeDefined();
    expect(
      paths["/auth/transitions/{transition_id}/discard-session"].post.responses[
        "200"
      ],
    ).toBeDefined();
    expect(
      paths["/auth/flows/{flow_id}/reset"].post.responses["200"],
    ).toBeDefined();
    expect(transition.properties.availability.enum).toEqual([
      "available",
      "unavailable",
    ]);
    expect(transition.properties.state.enum).toContain("cancelled");
    expect(transition.properties.transition_id.pattern).toContain("\\.");
  });

  it("defines the Phase 1 authentication and session restore contract", () => {
    expect(openapi.paths["/auth/me"].get.responses["200"]).toBeDefined();
    expect(openapi.paths["/auth/login"].post.requestBody).toBeDefined();
    expect(openapi.paths["/auth/logout"].post.responses["204"]).toBeDefined();
    expect(
      openapi.components.schemas.LoginInput.properties.login_id.pattern,
    ).toBe("^[가-힣A-Za-z0-9_.-]+$");
    expect(openapi.components.schemas.Self.properties.role.$ref).toBe(
      "#/components/schemas/Role",
    );
  });

  it("defines registration without confirmation or contact fields in the response", () => {
    const operation = openapi.paths["/auth/register"].post;
    const registerInput = openapi.components.schemas.RegisterInput;
    expect(
      operation.responses["201"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/RegisteredUser");
    expect(registerInput.required).toEqual([
      "login_id",
      "password",
      "nickname",
    ]);
    expect(registerInput.additionalProperties).toBe(false);
    expect(registerInput.properties).not.toHaveProperty("password_confirm");
    expect(registerInput.description).toContain(
      "versioned local common-password blocklist",
    );
    expect(registerInput.description).toContain(
      "Phase 1 mock does not apply the check",
    );
    expect(
      openapi.components.schemas.RegisteredUser.properties.approved.const,
    ).toBe(false);
    expect(
      openapi.components.schemas.RegisteredUser.properties,
    ).not.toHaveProperty("email");
    expect(
      openapi.components.schemas.RegisteredUser.properties,
    ).not.toHaveProperty("phone");
  });

  it("defines password change only for the authenticated change-only session", () => {
    const operation = openapi.paths["/auth/password"].post;
    const input = openapi.components.schemas.ChangePasswordInput;
    expect(operation.security).toEqual([{ SessionCookie: [] }]);
    expect(operation.parameters).toContainEqual({
      $ref: "#/components/parameters/CsrfToken",
    });
    expect(input.required).toEqual(["password"]);
    expect(input.additionalProperties).toBe(false);
    expect(input.properties.password).toMatchObject({
      minLength: 15,
      maxLength: 128,
    });
    expect(input.properties).not.toHaveProperty("password_confirm");
    expect(input.description).toContain(
      "versioned local common-password blocklist",
    );
    expect(input.description).toContain(
      "Phase 1 mock does not apply this check",
    );
    expect(
      operation.responses["200"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/AuthResult");
  });

  it("defines admin pages, aggregate stats, and contact-free approval targets", () => {
    const list = openapi.paths["/admin/users"].get;
    const user = openapi.components.schemas.AdminUser;
    const params = list.parameters;
    expect(params.find(({ name }) => name === "limit").schema).toMatchObject({
      default: 24,
      minimum: 1,
      maximum: 100,
    });
    expect(user.properties.account_version).toMatchObject({
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(user.properties).not.toHaveProperty("email");
    expect(user.properties).not.toHaveProperty("phone");
    expect(user.properties).not.toHaveProperty("password");
    expect(openapi.components.schemas.AdminUserPage.required).toContain(
      "stats",
    );
    expect(openapi.components.schemas.AdminStats.required).toEqual([
      "total_users",
      "pending_users",
      "total_apps",
      "healthy_apps",
      "next_health_expiry_at",
      "active_health_batch_id",
      "latest_health_batch_id",
    ]);
  });

  it("defines admin health batch acceptance and read contracts", () => {
    const request = openapi.paths["/admin/health-check-batches"].post;
    const read = openapi.paths["/admin/health-check-batches/{id}"].get;
    expect(request.security).toEqual([{ SessionCookie: [] }]);
    expect(
      request.responses["202"].content["application/json"].schema.$ref,
    ).toBe("#/components/schemas/BatchAccepted");
    expect(request.responses["429"]).toBeDefined();
    expect(request.responses["409"]).toBeDefined();
    expect(request.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ $ref: "#/components/parameters/Origin" }),
        expect.objectContaining({ $ref: "#/components/parameters/CsrfToken" }),
        expect.objectContaining({ $ref: "#/components/parameters/AuthFlowId" }),
        expect.objectContaining({
          $ref: "#/components/parameters/AuthRevision",
        }),
        expect.objectContaining({
          $ref: "#/components/parameters/SessionGeneration",
        }),
      ]),
    );
    expect(read.security).toEqual([{ SessionCookie: [] }]);
    expect(read.parameters.find(({ name }) => name === "id")).toMatchObject({
      in: "path",
      required: true,
      schema: { format: "uuid" },
    });
    expect(read.responses["200"].content["application/json"].schema.$ref).toBe(
      "#/components/schemas/HealthBatch",
    );
    expect(read.responses["409"]).toBeDefined();
    expect(openapi.components.schemas.HealthBatchCounts.required).toEqual([
      "queued",
      "running",
      "result_obtained",
      "failed",
      "cancelled",
      "reused",
    ]);
  });

  it("binds approval execution to an explicit value, account version, and operation key", () => {
    const issue = openapi.paths["/write-operations"].post;
    const execute = openapi.paths["/admin/users/{id}/approval"].patch;
    const keyHeader = execute.parameters.find(
      ({ name }) => name === "Idempotency-Key",
    );
    expect(issue.requestBody.required).toBe(true);
    expect(openapi.components.schemas.CreateApprovalOperation.required).toEqual(
      ["kind", "target_id", "expected_account_version", "approved"],
    );
    expect(keyHeader.required).toBe(true);
    expect(execute.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/SetApprovalInput",
    );
    expect(
      openapi.paths["/write-operations/{key}/cancel"].post.responses["200"],
    ).toBeDefined();
    expect(issue.responses["400"]).toBeDefined();
    expect(execute.responses["410"]).toBeDefined();
    expect(openapi.paths["/admin/users"].get.responses["409"]).toBeDefined();
    expect(
      openapi.components.schemas.ApprovalOperation.properties.state.enum,
    ).toEqual(["unresolved", "succeeded", "rejected"]);
  });

  it("binds account deletion to a current app count and durable result key", () => {
    const deletion = openapi.paths["/admin/users/{id}"].delete;
    const issue = openapi.paths["/write-operations"].post;
    const input = openapi.components.schemas.DeleteAdminUserInput;
    const operation = openapi.components.schemas.UserDeleteOperation;
    expect(deletion.parameters).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey",
    });
    expect(deletion.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/DeleteAdminUserInput",
    );
    expect(deletion.responses["204"]).toBeDefined();
    expect(deletion.responses["503"].description).toContain(
      "DELETION_CONFIRMATION_PENDING",
    );
    expect(input.required).toEqual(["expected_app_count"]);
    expect(input.properties.expected_app_count).toMatchObject({
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(issue.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/CreateWriteOperation",
    );
    expect(
      openapi.components.schemas.CreateWriteOperation.oneOf,
    ).toContainEqual({
      $ref: "#/components/schemas/CreateUserDeleteOperation",
    });
    expect(
      openapi.components.schemas.CreateUserDeleteOperation.required,
    ).toEqual(["kind", "target_id", "expected_app_count"]);
    expect(operation.properties.state.enum).toEqual([
      "unresolved",
      "confirming_deletion",
      "succeeded",
      "rejected",
    ]);
  });

  it("binds app deletion to its issued key and expected app version", () => {
    const deletion = openapi.paths["/apps/{id}"].delete;
    const issue = openapi.paths["/write-operations"].post;
    expect(deletion.parameters).toContainEqual({
      $ref: "#/components/parameters/IdempotencyKey",
    });
    expect(deletion.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/DeleteAppInput",
    );
    expect(deletion.responses["204"]).toBeDefined();
    expect(deletion.responses["503"]).toBeDefined();
    expect(issue.requestBody.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/CreateWriteOperation",
    );
    expect(
      openapi.components.schemas.CreateWriteOperation.oneOf,
    ).toContainEqual({ $ref: "#/components/schemas/CreateAppDeleteOperation" });
    expect(
      openapi.components.schemas.CreateAppDeleteOperation.required,
    ).toEqual(["kind", "target_id", "expected_version"]);
    expect(
      openapi.components.schemas.AppWriteOperation.properties.state.enum,
    ).toContain("confirming_deletion");
  });

  it("accepts representative detail fixtures", () => {
    expect(publicApps.every((app) => validateAppDetail(app))).toBe(true);
  });

  it("rejects detail fixtures missing a required field", () => {
    const incomplete = { ...publicApps[0] };
    delete incomplete.prompt;
    expect(validateAppDetail(incomplete)).toBe(false);
  });

  it("keeps public gallery filter values aligned with the catalog", () => {
    const parameters = openapi.paths["/apps"].get.parameters;
    const subject = parameters.find(({ name }) => name === "subject").schema;
    const grade = parameters.find(({ name }) => name === "grade").schema;
    expect(openapi.components.schemas.Subject.enum).toEqual(catalog.subjects);
    expect(openapi.components.schemas.Grade.enum).toEqual(catalog.grades);
    expect(subject.anyOf[0].enum).toEqual([""]);
    expect(subject.anyOf[1].$ref).toBe("#/components/schemas/Subject");
    expect(grade.anyOf[0].enum).toEqual([""]);
    expect(grade.anyOf[1].$ref).toBe("#/components/schemas/Grade");
  });
});

it("documents nullable extensible administrator health identifiers without exposing measurements in other DTOs", () => {
  const schemas = openapi.components.schemas;
  const properties = schemas.AdminHealthResult.properties;
  for (const field of ["error_kind", "error_stage"]) {
    expect(properties[field]).toMatchObject({
      type: ["string", "null"],
      minLength: 1,
      maxLength: 64,
      pattern: "^[A-Za-z][A-Za-z0-9_]{0,63}$",
    });
    expect(properties[field]).not.toHaveProperty("enum");
    for (const word of ["null", "case", "extensible"])
      expect(properties[field].description).toContain(word);
  }
  for (const kind of [
    "DNS_FAILURE",
    "TLS_FAILURE",
    "CONNECT_FAILURE",
    "HTTP_PROTOCOL_ERROR",
    "TIMEOUT",
    "DESTINATION_BLOCKED",
    "RESPONSE_HEADERS_TOO_LARGE",
    "REDIRECT_ERROR",
  ])
    expect(properties.error_kind.description).toContain(kind);
  for (const stage of [
    "url",
    "dns",
    "connect",
    "tls",
    "response_headers",
    "redirect",
    "overall",
  ])
    expect(properties.error_stage.description).toContain(stage);
  expect(properties.error_kind.examples).toContain("DESTINATION_BLOCKED");
  expect(properties.error_stage.examples).toContain("dns");
  expect(Object.keys(schemas.HealthResult.properties)).toEqual([
    "state",
    "checked_at",
    "fresh_until",
  ]);
  expect(schemas.AdminApp.properties.health.$ref).toBe(
    "#/components/schemas/HealthResult",
  );
  for (const name of [
    "HealthResult",
    "AdminApp",
    "Job",
    "HealthBatch",
    "HealthBatchCounts",
  ])
    for (const field of [
      "http_status",
      "response_ms",
      "error_kind",
      "error_stage",
    ])
      expect(schemas[name].properties).not.toHaveProperty(field);
  expect(schemas.Job.properties.failure_code.type).toEqual(["string", "null"]);
});
