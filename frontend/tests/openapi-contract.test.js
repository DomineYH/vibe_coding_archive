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
  it("defines normal authentication flow observation metadata", () => {
    const operation = openapi.paths["/auth/flow-state"].get;
    const response = operation.responses["200"];
    const flow = openapi.components.schemas.AuthFlowContext;
    expect(operation.parameters).toContainEqual(
      expect.objectContaining({
        name: "X-EduVibe-Flow-Id",
        in: "header",
        required: true,
      }),
    );
    expect(operation.security).toEqual([{ RecoveryCookie: [] }]);
    expect(response.content["application/json"].schema.$ref).toBe(
      "#/components/schemas/AuthFlowContext",
    );
    expect(flow.required).toEqual([
      "flow_id",
      "revision",
      "session_generation",
      "last_identity_change_revision",
    ]);
    expect(flow.properties.revision.pattern).toBe("^(0|[1-9][0-9]*)$");
    expect(flow.properties.last_identity_change_revision.pattern).toBe(
      "^(0|[1-9][0-9]*)$",
    );
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
