import { describe, expect, it } from "vitest";
import { normalizeQueryForService } from "../src/services/apps-service";

describe("shared query validation", () => {
  it("converts invalid query input to the service validation error", () => {
    expect(() => normalizeQueryForService({ limit: 0 })).toThrowError(
      expect.objectContaining({
        name: "ServiceError",
        code: "VALIDATION_ERROR",
        outcome: "rejected",
      }),
    );
  });
});
