import { expect, it } from "vitest";
import {
  discardEditDraft,
  editRecoveryHref,
  isEditRecoveryLocation,
} from "../src/features/submit/edit-draft";

const path = "/apps/00000000-0000-4000-8000-000000000091/edit";
it("retains memory only in the exact edit/recovery corridor", () => {
  const href = editRecoveryHref(path);
  expect(href).toBe(`/auth?mode=login&return_to=${encodeURIComponent(path)}`);
  expect(
    isEditRecoveryLocation({ pathname: path, search: "", hash: "" }, path),
  ).toBe(true);
  expect(
    isEditRecoveryLocation(
      { pathname: "/auth", search: href.slice(5), hash: "" },
      path,
    ),
  ).toBe(true);
  for (const search of [
    "?mode=signup",
    "?return_to=https://evil.test",
    "?return_to=%252Fapps%252Fbad%252Fedit",
    "?mode=login&return_to=%2F",
  ]) {
    expect(
      isEditRecoveryLocation({ pathname: "/auth", search, hash: "" }, path),
    ).toBe(false);
  }
  expect(editRecoveryHref("/apps/bad/edit")).toBeNull();
  expect(
    isEditRecoveryLocation(
      { pathname: path, search: "", hash: "#draft" },
      path,
    ),
  ).toBe(false);
});
it("discards once and exposes only a non-sensitive result for later notices", () => {
  const memory = {
    slot: {
      appId: "sensitive",
      ownerScope: "member",
      recovering: true,
      snapshot: { dirty: true, unknown: true, draft: { name: "secret" } },
    },
  };
  expect(discardEditDraft(memory, "reset")).toEqual({
    reason: "reset",
    dirty: true,
    outcome: "unknown",
  });
  expect(memory.slot).toBeNull();
  expect(memory.notice).toEqual({
    reason: "reset",
    dirty: true,
    outcome: "unknown",
  });
  expect(discardEditDraft(memory, "identity")).toBeNull();
});
