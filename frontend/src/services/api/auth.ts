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
  async getFlowState() {
    throw unavailable();
  },
  async createFlow() {
    throw unavailable();
  },
  async issueRecoveryCookie() {
    throw unavailable();
  },
  async confirmRecoveryCookie() {
    throw unavailable();
  },
  async abandonFlow() {
    throw unavailable();
  },
  async getRecoveryContext() {
    throw unavailable();
  },
  async getRecoveryCsrf() {
    throw unavailable();
  },
  async rotateRecoveryCookie() {
    throw unavailable();
  },
  async getRestartEligibility() {
    throw unavailable();
  },
  async admitTransition() {
    throw unavailable();
  },
  async issueAnonymousSession() {
    throw unavailable();
  },
  async settleTransition() {
    throw unavailable();
  },
  async discardSession() {
    throw unavailable();
  },
  async resetFlow() {
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
  async reauthenticate() {
    throw unavailable();
  },
  async logout() {
    throw unavailable();
  },
};
