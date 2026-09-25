import type { AuthResult, AuthUser, CsrfToken } from "../contracts/mappers";

export type AuthLoginInput = { loginId: string; password: string };
export type AuthRequestOptions = { signal?: AbortSignal };
export type AuthService = {
  getMe(options?: AuthRequestOptions): Promise<AuthUser>;
  getCsrf(options?: AuthRequestOptions): Promise<CsrfToken>;
  login(input: AuthLoginInput): Promise<AuthResult>;
  logout(): Promise<void>;
};
