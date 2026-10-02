import type { AuthFlowContext, AuthUser } from "../contracts/mappers";
import type { CurrentAuthState } from "./auth-service";

type AuthScope = {
  user?: AuthUser | null;
  flow?: Partial<AuthFlowContext> | null;
  observationGeneration?: number;
  observationId?: number;
};

export type ProtectedReadContext = {
  readonly state: CurrentAuthState;
  readonly isCurrent: () => boolean;
};

export function captureAuthObservation(
  state: CurrentAuthState,
  isCurrent: () => boolean,
): ProtectedReadContext {
  return Object.freeze({
    state: Object.freeze({
      ...state,
      user: state.user ? Object.freeze({ ...state.user }) : null,
      flow: Object.freeze({ ...state.flow }),
    }),
    isCurrent,
  });
}

export function assertAuthObservation(context: ProtectedReadContext) {
  if (!context.isCurrent())
    throw new DOMException("Authentication observation changed", "AbortError");
}

export function memberCacheScope(auth: AuthScope): string {
  return JSON.stringify([
    auth.user?.id ?? "anonymous",
    auth.user?.role ?? null,
    auth.user?.sessionKind ?? "anonymous",
    auth.flow?.flowId ?? null,
    auth.flow?.revision ?? null,
    auth.flow?.sessionGeneration ?? null,
    auth.flow?.lastIdentityChangeRevision ?? null,
    auth.observationGeneration ?? 0,
    auth.observationId ?? 0,
  ]);
}

export function draftContinuityScope(auth: AuthScope): string | null {
  const user = auth.user;
  const identity = auth.flow?.lastIdentityChangeRevision;
  if (
    !user?.approved ||
    user.sessionKind !== "full" ||
    user.mustChangePassword ||
    !auth.flow?.flowId ||
    typeof identity !== "string" ||
    !/^(0|[1-9][0-9]*)$/.test(identity)
  )
    return null;
  return JSON.stringify([
    user.id,
    user.role,
    user.sessionKind,
    auth.flow.flowId,
    identity,
  ]);
}
