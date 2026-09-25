import { describe, expect, it } from "vitest";
import { readAuthRoute } from "../src/features/auth/auth-route";

describe("authentication route parameters", () => {
  it("accepts the supported modes and safe internal destinations", () => {
    expect(readAuthRoute("")).toEqual({
      mode: "login",
      returnTo: "/",
      invalid: false,
    });
    expect(
      readAuthRoute(
        "?mode=login&return_to=%2Fapps%2F00000000-0000-4000-8000-000000000001",
      ),
    ).toMatchObject({
      mode: "login",
      returnTo: "/apps/00000000-0000-4000-8000-000000000001",
      invalid: false,
    });
    expect(readAuthRoute("?mode=signup").mode).toBe("signup");
    expect(
      readAuthRoute(
        "?return_to=%2F%3Fsubject%3D%25EC%2588%2598%25ED%2595%2599",
      ),
    ).toMatchObject({ invalid: false });
  });

  it("rejects external, duplicated, malformed, and repeated-decoding routes", () => {
    for (const search of [
      "?mode=unknown",
      "?mode=login&mode=reauth",
      "?mode=login&return_to=https%3A%2F%2Fexample.com",
      "?mode=login&return_to=%2F%2Fevil.example",
      "?mode=login&return_to=%252F%252Fevil.example",
      "?mode=login&return_to=%2Fauth%3Fmode%3Dlogin",
      "?mode=login&return_to=%2F%3Fq%3Done%26q%3Dtwice",
      "?mode=login&return_to=%2F%3Funknown%3Dvalue",
      "?mode=login&return_to=%2Fadmin%3F",
      "?mode=login&return_to=%2Fapps%2F00000000-0000-4000-8000-000000000001%3F",
      "?mode=login&return_to=%2F%C2%85admin",
      "?mode=%E0%A4%A",
    ])
      expect(readAuthRoute(search).invalid).toBe(true);
  });
});
