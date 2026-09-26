import type { AuthService } from "../auth-service";
import { ServiceError } from "../service-error";

function unavailable(): ServiceError {
  return new ServiceError(
    "FEATURE_UNAVAILABLE",
    "인증은 Phase 1 mock 모드에서만 사용할 수 있어요.",
  );
}

export const authService: AuthService = {
  async getCurrentAuthState() {
    throw unavailable();
  },
  async getMe() {
    throw unavailable();
  },
  async getCsrf() {
    throw unavailable();
  },
  async register() {
    throw unavailable();
  },
  async login() {
    throw unavailable();
  },
  async changePassword() {
    throw unavailable();
  },
  async logout() {
    throw unavailable();
  },
};
