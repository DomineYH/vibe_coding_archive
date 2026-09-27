import type {
  AdminAppPage,
  AdminUser,
  AdminUserPage,
  ApprovalOperation,
  PasswordResetOperation,
} from "../contracts/mappers";
import { ServiceError } from "./service-error";

export type ListAdminUsersQuery = { limit?: number; offset?: number };
export type ListAdminAppsQuery = ListAdminUsersQuery;
export type AdminRequestOptions = { signal?: AbortSignal };
export type CreateApprovalOperationInput = {
  targetId: string;
  expectedAccountVersion: number;
  approved: boolean;
};
export type CreatePasswordResetOperationInput = {
  targetId: string;
  expectedAccountVersion: number;
  newPassword: string;
};

export type AdminService = {
  listUsers(
    query?: ListAdminUsersQuery,
    options?: AdminRequestOptions,
  ): Promise<AdminUserPage>;
  listApps(
    query?: ListAdminAppsQuery,
    options?: AdminRequestOptions,
  ): Promise<AdminAppPage>;
  getUser(id: string, options?: AdminRequestOptions): Promise<AdminUser>;
  createApprovalOperation(
    input: CreateApprovalOperationInput,
  ): Promise<ApprovalOperation>;
  createPasswordResetOperation(
    input: CreatePasswordResetOperationInput,
  ): Promise<PasswordResetOperation>;
  setApproval(
    id: string,
    approved: boolean,
    expectedAccountVersion: number,
    operationKey: string,
  ): Promise<AdminUser>;
  getApprovalOperation(key: string): Promise<ApprovalOperation>;
  cancelApprovalOperation(key: string): Promise<ApprovalOperation>;
  setPasswordReset(
    id: string,
    newPassword: string,
    expectedAccountVersion: number,
    operationKey: string,
  ): Promise<void>;
  getPasswordResetOperation(key: string): Promise<PasswordResetOperation>;
  cancelPasswordResetOperation(key: string): Promise<PasswordResetOperation>;
};

export function normalizeResetPassword(password: string): string {
  const normalized =
    typeof password === "string" ? password.normalize("NFC") : "";
  const length = Array.from(normalized).length;
  if (length < 15 || length > 128)
    throw new ServiceError(
      "VALIDATION_ERROR",
      "임시 비밀번호는 15~128자로 입력해 주세요.",
      {
        httpStatus: 422,
        outcome: "rejected",
        fields: { new_password: "임시 비밀번호는 15~128자로 입력해 주세요." },
      },
    );
  return normalized;
}

export function normalizeAdminUsersQuery(query: ListAdminUsersQuery = {}) {
  return normalizeAdminListQuery(query, "사용자 목록 범위를 확인해 주세요.");
}

export function normalizeAdminAppsQuery(query: ListAdminAppsQuery = {}) {
  return normalizeAdminListQuery(query, "앱 목록 범위를 확인해 주세요.");
}

function normalizeAdminListQuery(query: ListAdminUsersQuery, message: string) {
  if (
    query === null ||
    typeof query !== "object" ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => key !== "limit" && key !== "offset")
  )
    throw invalidQuery(message);
  const limit = query.limit ?? 24;
  const offset = query.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw invalidQuery(message);
  return { limit, offset };
}

function invalidQuery(message: string) {
  return new ServiceError("VALIDATION_ERROR", message, {
    outcome: "rejected",
  });
}
