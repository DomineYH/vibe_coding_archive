import { describe, expect, it } from "vitest";
import type { CurrentAuthState } from "../src/services/auth-service";
import {
  captureAuthObservation,
  memberCacheScope,
  draftContinuityScope,
} from "../src/services/auth-state";

export const memberState = (): CurrentAuthState => ({
  user: {
    id: "00000000-0000-4000-8000-000000000100",
    loginId: "member-a",
    nickname: "회원 A",
    role: "user",
    approved: true,
    sessionKind: "full",
    mustChangePassword: false,
    recentAuthUntil: null,
    expiresAt: "2026-10-02T08:00:00Z",
    email: null,
    phone: null,
  },
  flow: {
    flowId: "00000000-0000-4000-8000-000000000200",
    revision: "8",
    sessionGeneration: "3",
    lastIdentityChangeRevision: "6",
  },
  observationGeneration: 2,
  sessionCookiePresent: true,
  status: "ready",
  unresolvedTransitionId: null,
});

describe("captured protected read observation", () => {
  it("freezes caller identity and rejects invalidated late completions", () => {
    const state = memberState();
    let current = true;
    const captured = captureAuthObservation(state, () => current);
    state.flow.revision = "9";
    expect(captured.state.flow.revision).toBe("8");
    expect(captured.isCurrent()).toBe(true);
    current = false;
    expect(captured.isCurrent()).toBe(false);
  });
  it("separates cache identity, session generation, role, flow and observation", () => {
    const state = memberState();
    for (const changed of [
      { ...state, observationGeneration: 3 },
      {
        ...state,
        user: { ...state.user!, id: "00000000-0000-4000-8000-000000000101" },
      },
      { ...state, user: { ...state.user!, role: "admin" as const } },
      { ...state, flow: { ...state.flow, sessionGeneration: "4" } },
      {
        ...state,
        flow: { ...state.flow, flowId: "00000000-0000-4000-8000-000000000201" },
      },
    ])
      expect(memberCacheScope(changed)).not.toBe(memberCacheScope(state));
  });
  it("preserves eligible drafts only across ordinary re-observation", () => {
    const state = memberState();
    expect(
      draftContinuityScope({
        ...state,
        observationGeneration: 3,
        flow: { ...state.flow, revision: "9" },
      }),
    ).toBe(draftContinuityScope(state));
    for (const changed of [
      { ...state, flow: { ...state.flow, lastIdentityChangeRevision: "10" } },
      { ...state, flow: { ...state.flow, lastIdentityChangeRevision: "" } },
      { ...state, user: { ...state.user!, approved: false } },
      {
        ...state,
        user: { ...state.user!, sessionKind: "change_only" as const },
      },
    ])
      expect(draftContinuityScope(changed)).not.toBe(
        draftContinuityScope(state),
      );
  });
});
