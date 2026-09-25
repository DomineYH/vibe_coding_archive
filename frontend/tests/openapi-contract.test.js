import Ajv from "ajv";
import { load } from "js-yaml";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
  it("accepts representative detail fixtures", () => {
    expect(publicApps.every((app) => validateAppDetail(app))).toBe(true);
  });

  it("rejects detail fixtures missing a required field", () => {
    const incomplete = { ...publicApps[0] };
    delete incomplete.prompt;
    expect(validateAppDetail(incomplete)).toBe(false);
  });
});
