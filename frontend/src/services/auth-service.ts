import type {
  AuthResult,
  AuthFlowContext,
  AuthFlowCreated,
  AuthFlowState,
  AuthTransitionKind,
  AuthTransitionPermit,
  AnonymousSessionResult,
  AuthUser,
  CsrfToken,
  FlowRevision,
  RecoveryContext,
  RecoveryCookieResult,
  RecoveryCsrf,
  RecoveryReady,
  RestartEligibility,
  SettledAuthTransition,
  RegisteredUser,
} from "../contracts/mappers";

export type AuthLoginInput = { loginId: string; password: string };
export type AuthRegisterInput = {
  loginId: string;
  password: string;
  nickname: string;
  email?: string | null;
  phone?: string | null;
};
export type AuthChangePasswordInput = { password: string };
export type AuthRequestOptions = { signal?: AbortSignal };
export type CurrentAuthState = {
  user: AuthUser | null;
  flow: AuthFlowContext;
  observationGeneration: number;
  sessionCookiePresent: boolean;
  status: "ready" | "unresolved";
  unresolvedTransitionId: string | null;
};
export type CreateAuthFlowInput = { restartFrom: string[] };
export type AuthTransitionAdmissionInput = {
  flowId: string;
  transitionId: string;
  kind: AuthTransitionKind;
  expectedRevision: string;
  expectedSessionGeneration: string | null;
};
export type ExpectedRevisionInput = { expectedRevision: string };
export type RotateRecoveryCookieInput = {
  expectedRevision: string;
  expectedSessionGeneration: string;
};
export type SettleAuthTransitionInput = {
  flowId: string;
  expectedRevision: string;
};
export type DiscardAuthSessionInput = SettleAuthTransitionInput & {
  expectedSessionGeneration: string;
};
export type ResetAuthFlowInput = {
  expectedRevision: string;
  expectedSessionGeneration?: string | null;
};
export type ReauthenticateInput = { password: string };
export type AuthService = {
  getCurrentAuthState(options?: AuthRequestOptions): Promise<CurrentAuthState>;
  getFlowState(
    transitionId?: string,
    options?: AuthRequestOptions,
  ): Promise<AuthFlowState>;
  createFlow(input: CreateAuthFlowInput): Promise<AuthFlowCreated>;
  issueRecoveryCookie(flowId: string): Promise<RecoveryCookieResult>;
  confirmRecoveryCookie(
    flowId: string,
    input: ExpectedRevisionInput,
  ): Promise<RecoveryReady>;
  abandonFlow(flowId: string): Promise<RestartEligibility>;
  getRecoveryContext(): Promise<RecoveryContext>;
  getRecoveryCsrf(flowId: string): Promise<RecoveryCsrf>;
  rotateRecoveryCookie(
    flowId: string,
    input: RotateRecoveryCookieInput,
  ): Promise<RecoveryCookieResult>;
  getRestartEligibility(flowId: string): Promise<RestartEligibility>;
  admitTransition(
    input: AuthTransitionAdmissionInput,
  ): Promise<AuthTransitionPermit>;
  issueAnonymousSession(input: {
    flowId: string;
    expectedRevision: string;
    transitionId: string;
  }): Promise<AnonymousSessionResult>;
  settleTransition(
    transitionId: string,
    input: SettleAuthTransitionInput,
  ): Promise<SettledAuthTransition>;
  discardSession(
    transitionId: string,
    input: DiscardAuthSessionInput,
  ): Promise<FlowRevision>;
  resetFlow(
    flowId: string,
    input: ResetAuthFlowInput,
  ): Promise<RestartEligibility>;
  getMe(options?: AuthRequestOptions): Promise<AuthUser>;
  getCsrf(options?: AuthRequestOptions): Promise<CsrfToken>;
  register(input: AuthRegisterInput): Promise<RegisteredUser>;
  login(input: AuthLoginInput): Promise<AuthResult>;
  changePassword(input: AuthChangePasswordInput): Promise<AuthResult>;
  reauthenticate(input: ReauthenticateInput): Promise<AuthResult>;
  logout(): Promise<void>;
};
