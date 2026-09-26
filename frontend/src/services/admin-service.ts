import type {
  AdminUser,
  AdminUserPage,
  ApprovalOperation,
} from "../contracts/mappers";
import { ServiceError } from "./service-error";

export type ListAdminUsersQuery = { limit?: number; offset?: number };
export type AdminRequestOptions = { signal?: AbortSignal };
export type CreateApprovalOperationInput = {
  targetId: string;
  expectedAccountVersion: number;
  approved: boolean;
};

export type AdminService = {
  listUsers(
    query?: ListAdminUsersQuery,
    options?: AdminRequestOptions,
  ): Promise<AdminUserPage>;
  getUser(id: string, options?: AdminRequestOptions): Promise<AdminUser>;
  createApprovalOperation(
    input: CreateApprovalOperationInput,
  ): Promise<ApprovalOperation>;
  setApproval(
    id: string,
    approved: boolean,
    expectedAccountVersion: number,
    operationKey: string,
  ): Promise<AdminUser>;
  getApprovalOperation(key: string): Promise<ApprovalOperation>;
  cancelApprovalOperation(key: string): Promise<ApprovalOperation>;
};

export function normalizeAdminUsersQuery(query: ListAdminUsersQuery = {}) {
  if (
    query === null ||
    typeof query !== "object" ||
    Array.isArray(query) ||
    Object.keys(query).some((key) => key !== "limit" && key !== "offset")
  )
    throw invalidQuery();
  const limit = query.limit ?? 24;
  const offset = query.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw invalidQuery();
  return { limit, offset };
}

function invalidQuery() {
  return new ServiceError(
    "VALIDATION_ERROR",
    "사용자 목록 범위를 확인해 주세요.",
    {
      outcome: "rejected",
    },
  );
}
