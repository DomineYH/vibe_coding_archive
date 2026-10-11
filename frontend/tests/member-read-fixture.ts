import type { CurrentAuthState } from "../src/services/auth-service";
import { captureAuthObservation } from "../src/services/auth-state";

export const memberState: CurrentAuthState = {
  user: {
    id: "00000000-0000-4000-8000-000000000101",
    loginId: "member",
    nickname: "회원",
    role: "user",
    approved: true,
    sessionKind: "full",
    mustChangePassword: false,
    recentAuthUntil: null,
    expiresAt: "2099-01-01T00:00:00Z",
    email: null,
    phone: null,
  },
  flow: {
    flowId: "00000000-0000-4000-8000-000000000200",
    revision: "1",
    sessionGeneration: "2",
    lastIdentityChangeRevision: "0",
  },
  observationGeneration: 0,
  sessionCookiePresent: true,
  status: "ready",
  unresolvedTransitionId: null,
};
export const memberReadContext = captureAuthObservation(
  memberState,
  () => true,
);
export const memberHeaders = {
  "Cache-Control": "private, no-store",
  "X-EduVibe-Flow-Id": memberState.flow.flowId,
  "X-EduVibe-Auth-Revision": memberState.flow.revision,
  "X-EduVibe-Session-Generation": memberState.flow.sessionGeneration!,
};
