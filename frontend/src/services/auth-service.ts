import type {
  AuthResult,
  AuthUser,
  CsrfToken,
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
export type AuthRequestOptions = { signal?: AbortSignal };
export type AuthService = {
  getMe(options?: AuthRequestOptions): Promise<AuthUser>;
  getCsrf(options?: AuthRequestOptions): Promise<CsrfToken>;
  register(input: AuthRegisterInput): Promise<RegisteredUser>;
  login(input: AuthLoginInput): Promise<AuthResult>;
  logout(): Promise<void>;
};
