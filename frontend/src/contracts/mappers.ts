import type { components } from "./api";
import catalog from "../../../contracts/catalog.json";
import { contractError } from "../services/service-error";

type Wire = components["schemas"];
type WireMeta = Wire["Meta"];
type WireAppCard = Wire["AppCard"];
type WireAppDetail = Wire["AppDetail"];
type WireHealth = Wire["HealthView"];
type WireHealthResult = Wire["HealthResult"];
type WireReason = Wire["Reason"];
type WireCapability = Wire["Capability"];
type WireSelf = Wire["Self"];
type WireAuthFlowContext = Pick<
  Wire["AuthFlowState"],
  | "flow_id"
  | "revision"
  | "session_generation"
  | "last_identity_change_revision"
>;
type WireAuthFlowState = Wire["AuthFlowState"];
type WireAuthTransition = Wire["AuthTransition"];
type WireAuthFlowCreated = Wire["AuthFlowCreated"];
type WireRecoveryCookieResult = Wire["RecoveryCookieResult"];
type WireRecoveryReady = Wire["RecoveryReady"];
type WireRestartEligibility = Wire["RestartEligibility"];
type WireRecoveryContext = Wire["RecoveryContext"];
type WireRecoveryCsrf = Wire["RecoveryCsrf"];
type WireAuthTransitionPermit = Wire["AuthTransitionPermit"];
type WireSettledAuthTransition = Wire["SettledAuthTransition"];
type WireAnonymousSessionResult = Wire["AnonymousSessionResult"];
type WireAuthResult = Wire["AuthResult"];
type WireCsrfToken = Wire["CsrfToken"];
type WireRegisteredUser = Wire["RegisteredUser"];
type WireAdminUser = Wire["AdminUser"];
type WireAdminStats = Wire["AdminStats"];
type WireAdminUserPage = Wire["AdminUserPage"];
type WireApprovalOperation = Wire["ApprovalOperation"];
type WireAppWriteOperation = Wire["AppWriteOperation"];

export type Theme = Wire["Theme"];
export type Subject = Wire["Subject"];
export type Grade = Wire["Grade"];
export type Capability = WireCapability;
export type Meta = {
  subjects: Subject[];
  grades: Grade[];
  themes: Theme[];
  serverTime: string;
  capabilities: Wire["Capabilities"];
  support: Wire["Support"];
  initialPendingDays: number;
};
export type HealthResult = WireHealthResult;
export type HealthView = {
  result: HealthResult;
  latestJob: WireHealth["latest_job"];
  nextCheckAt: string | null;
};
export type AppCard = {
  id: string;
  ownerId: string;
  owner: string;
  name: string;
  subject: Subject;
  grades: Grade[];
  isPublic: boolean;
  themeId: string;
  version: number;
  urlVersion: number;
  health: HealthView;
};
export type AppPage = {
  items: AppCard[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  serverTime: string;
  facets: { subjectsInUse: Subject[] };
};
export type AppDetail = AppCard & {
  url: string;
  prompt: string;
  description: string;
  stack: {
    db: string | null;
    backend: string | null;
    frontend: string | null;
    hosting: string | null;
  };
  createdAt: string;
  updatedAt: string;
  serverTime: string;
};
export type AppWriteOperation = {
  key: string;
  kind: "app_create";
  targetId: string | null;
  issuedAt: string;
  expiresAt: string;
  state: "unresolved" | "succeeded" | "rejected";
  dbAppliedAt: string | null;
  finalizedAt: string | null;
  resultVersion: number | null;
  rejectionCode: string | null;
  serverTime: string;
};
export type AuthUser = {
  id: string;
  loginId: string;
  nickname: string;
  role: Wire["Role"];
  approved: boolean;
  mustChangePassword: boolean;
  sessionKind: Wire["SessionKind"];
  expiresAt: string;
  email: string | null;
  phone: string | null;
  recentAuthUntil: string | null;
};
export type AuthFlowContext = {
  flowId: string;
  revision: string;
  sessionGeneration: string | null;
  lastIdentityChangeRevision: string;
};
export type AuthTransitionKind = Wire["AuthTransition"]["kind"] & string;
export type AuthTransitionState = Wire["AuthTransition"]["state"] & string;
export type AuthTransition = {
  transitionId: string;
  availability: "available" | "unavailable";
  executionBlocked: boolean | null;
  kind: AuthTransitionKind | null;
  state: AuthTransitionState | null;
  permitExpiresAt: string | null;
  resultSessionGeneration: string | null;
  failureCode: string | null;
};
export type AuthFlowState = {
  flowId: string;
  revision: string;
  serverTime: string;
  expiresAt: string;
  recoveryReady: boolean;
  sessionGeneration: string | null;
  sessionCookiePresent: boolean;
  lastIdentityChangeRevision: string;
  pendingTransition: AuthTransition | null;
  requestedTransition: AuthTransition | null;
  nextTransitionId: string | null;
};
export type AuthFlowCreated = {
  flowId: string;
  revision: string;
  expiresAt: string;
};
export type FlowRevision = { flowId: string; revision: string };
export type RecoveryCookieResult = FlowRevision & {
  recoveryCsrfToken: string;
  expiresAt: string;
};
export type RecoveryReady = FlowRevision & {
  expiresAt: string;
  ready: true;
};
export type RestartEligibility = { restartEligible: boolean };
export type RecoveryContext = {
  items: Array<{
    flowId: string;
    revision: string;
    proofKind: "recovery" | "session";
  }>;
};
export type RecoveryCsrf = FlowRevision & {
  recoveryCsrfToken: string;
  expiresAt: string;
};
export type AuthTransitionPermit = FlowRevision & {
  transitionId: string;
  kind: AuthTransitionKind;
  permitExpiresAt: string;
};
export type SettledAuthTransition = FlowRevision & {
  transitionId: string;
  transition: AuthTransition;
};
export type AnonymousSessionResult = FlowRevision & {
  sessionGeneration: string;
  csrfToken: string;
  expiresAt: string;
};
export type AuthResult = { user: AuthUser; csrfToken: string };
export type CsrfToken = { csrfToken: string; expiresAt: string };
export type RegisteredUser = {
  id: string;
  loginId: string;
  nickname: string;
  approved: false;
  pendingExpiresAt: string;
};
export type AdminUser = {
  id: string;
  loginId: string;
  nickname: string;
  role: Wire["Role"];
  approved: boolean;
  accountVersion: number;
  createdAt: string;
  firstApprovedAt: string | null;
  pendingExpiresAt: string | null;
};
export type AdminStats = {
  totalUsers: number;
  pendingUsers: number;
  totalApps: number;
  healthyApps: number;
};
export type AdminUserPage = {
  items: AdminUser[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
  stats: AdminStats;
  serverTime: string;
};
export type ApprovalOperation = {
  key: string;
  kind: "user_approval";
  targetId: string;
  issuedAt: string;
  expiresAt: string;
  state: "unresolved" | "succeeded" | "rejected";
  appliedAccountVersion: number | null;
  appliedApproved: boolean | null;
  finalizedAt: string | null;
  rejectionCode: string | null;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const REASONS: WireReason[] = [
  "not_implemented",
  "verification_pending",
  "operational_restriction",
  "collection_disabled",
];
const HEALTH_STATES = [
  "unchecked",
  "healthy",
  "http_error",
  "timeout",
  "network_error",
  "blocked",
  "redirect_error",
] as const;
const SUBJECTS = catalog.subjects as Subject[];
const GRADES = catalog.grades as Grade[];

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw contractError();
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw contractError();
  return value;
}

function nonEmpty(value: unknown): string {
  const result = string(value);
  if (!result.trim()) throw contractError();
  return result;
}

export function isDateTime(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !DATE_TIME.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    return false;
  const calendarDate = value.slice(0, 10);
  return (
    new Date(`${calendarDate}T00:00:00.000Z`).toISOString().slice(0, 10) ===
    calendarDate
  );
}

function dateTime(value: unknown): string {
  if (!isDateTime(value)) throw contractError();
  return value;
}

function nullableDateTime(value: unknown): string | null {
  return value === null ? null : dateTime(value);
}

function integer(
  value: unknown,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw contractError();
  return value;
}

function sequence(value: unknown): string {
  const result = string(value);
  if (!/^(0|[1-9][0-9]*)$/.test(result)) throw contractError();
  return result;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) throw contractError();
  return value.map((item) => string(item));
}

function catalogValues<T extends string>(
  value: unknown,
  allowed: readonly T[],
  complete = false,
): T[] {
  const values = stringArray(value);
  const unique = new Set(values);
  const ordered = allowed.filter((item) => unique.has(item));
  if (
    unique.size !== values.length ||
    ordered.length !== values.length ||
    ordered.some((item, index) => item !== values[index]) ||
    (complete && values.length !== allowed.length)
  )
    throw contractError();
  return ordered;
}

function catalogValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T {
  return catalogValues([value], allowed)[0]!;
}

function nullableString(value: unknown): string | null {
  return value === null ? null : string(value);
}

export function mapSelf(value: unknown): AuthUser {
  const item = record(value) as unknown as Partial<WireSelf>;
  const id = nonEmpty(item.id);
  const loginId = nonEmpty(item.login_id);
  const nickname = nonEmpty(item.nickname);
  const role = item.role;
  const sessionKind = item.session_kind;
  if (
    !UUID.test(id) ||
    (role !== "user" && role !== "admin") ||
    (sessionKind !== "full" && sessionKind !== "change_only") ||
    typeof item.approved !== "boolean" ||
    typeof item.must_change_password !== "boolean"
  )
    throw contractError();

  const expiresAt = dateTime(item.expires_at);
  const fullSession = sessionKind === "full";
  if (
    (fullSession && (!item.approved || item.must_change_password)) ||
    (!fullSession && (!item.approved || !item.must_change_password))
  )
    throw contractError();
  if (
    fullSession !==
    (Object.hasOwn(item, "email") &&
      Object.hasOwn(item, "phone") &&
      Object.hasOwn(item, "recent_auth_until"))
  )
    throw contractError();
  const email = fullSession ? nullableString(item.email) : null;
  const phone = fullSession ? nullableString(item.phone) : null;
  const recentAuthUntil = fullSession
    ? nullableDateTime(item.recent_auth_until)
    : null;
  if (role === "user" && recentAuthUntil !== null) throw contractError();
  return {
    id,
    loginId,
    nickname,
    role,
    approved: item.approved,
    mustChangePassword: item.must_change_password,
    sessionKind,
    expiresAt,
    email,
    phone,
    recentAuthUntil,
  };
}

export function mapAuthFlowContext(value: unknown): AuthFlowContext {
  const item = record(value) as unknown as Partial<WireAuthFlowContext>;
  if (
    Object.keys(item).some(
      (key) =>
        ![
          "flow_id",
          "revision",
          "session_generation",
          "last_identity_change_revision",
        ].includes(key),
    )
  )
    throw contractError();
  const flowId = nonEmpty(item.flow_id);
  if (!UUID.test(flowId)) throw contractError();
  return {
    flowId,
    revision: sequence(item.revision),
    sessionGeneration:
      item.session_generation === null
        ? null
        : sequence(item.session_generation),
    lastIdentityChangeRevision: sequence(item.last_identity_change_revision),
  };
}

function mapAuthTransition(value: unknown, flowId: string): AuthTransition {
  const item = record(value) as unknown as Partial<WireAuthTransition>;
  if (
    !hasOnlyKeys(item, [
      "transition_id",
      "availability",
      "execution_blocked",
      "kind",
      "state",
      "permit_expires_at",
      "result_session_generation",
      "failure_code",
    ])
  )
    throw contractError();
  const transitionId = nonEmpty(item.transition_id);
  if (!transitionId.startsWith(`${flowId}.`)) throw contractError();
  sequence(transitionId.slice(flowId.length + 1));

  if (item.availability === "unavailable") {
    if (
      typeof item.execution_blocked !== "boolean" ||
      item.kind !== null ||
      item.state !== null ||
      item.permit_expires_at !== null ||
      item.result_session_generation !== null ||
      item.failure_code !== null
    )
      throw contractError();
    return {
      transitionId,
      availability: "unavailable",
      executionBlocked: item.execution_blocked,
      kind: null,
      state: null,
      permitExpiresAt: null,
      resultSessionGeneration: null,
      failureCode: null,
    };
  }
  if (
    item.availability !== "available" ||
    item.execution_blocked !== null ||
    (item.kind !== "anonymous_session" &&
      item.kind !== "login" &&
      item.kind !== "logout" &&
      item.kind !== "password_change" &&
      item.kind !== "reauthenticate") ||
    (item.state !== "admitted" &&
      item.state !== "executing" &&
      item.state !== "succeeded" &&
      item.state !== "failed" &&
      item.state !== "cancelled" &&
      item.state !== "expired")
  )
    throw contractError();
  return {
    transitionId,
    availability: "available",
    executionBlocked: null,
    kind: item.kind,
    state: item.state,
    permitExpiresAt: dateTime(item.permit_expires_at),
    resultSessionGeneration:
      item.result_session_generation === null
        ? null
        : sequence(item.result_session_generation),
    failureCode:
      item.failure_code === null ? null : nonEmpty(item.failure_code),
  };
}

export function mapAuthFlowState(value: unknown): AuthFlowState {
  const item = record(value) as unknown as Partial<WireAuthFlowState>;
  if (
    !hasOnlyKeys(item, [
      "flow_id",
      "revision",
      "server_time",
      "expires_at",
      "recovery_ready",
      "session_generation",
      "session_cookie_present",
      "last_identity_change_revision",
      "pending_transition",
      "requested_transition",
      "next_transition_id",
    ])
  )
    throw contractError();
  const flowId = nonEmpty(item.flow_id);
  if (
    !UUID.test(flowId) ||
    typeof item.recovery_ready !== "boolean" ||
    typeof item.session_cookie_present !== "boolean" ||
    (item.session_generation === null && item.session_cookie_present)
  )
    throw contractError();
  const revision = sequence(item.revision);
  const lastIdentityChangeRevision = sequence(
    item.last_identity_change_revision,
  );
  if (BigInt(lastIdentityChangeRevision) > BigInt(revision))
    throw contractError();
  const pendingTransition =
    item.pending_transition === null
      ? null
      : mapAuthTransition(item.pending_transition, flowId);
  if (
    pendingTransition &&
    (pendingTransition.availability !== "available" ||
      (pendingTransition.state !== "admitted" &&
        pendingTransition.state !== "executing"))
  )
    throw contractError();
  const requestedTransition =
    item.requested_transition === null
      ? null
      : mapAuthTransition(item.requested_transition, flowId);
  const nextTransitionId = nullableString(item.next_transition_id);
  if (nextTransitionId !== null) {
    if (!nextTransitionId.startsWith(`${flowId}.`)) throw contractError();
    if (sequence(nextTransitionId.slice(flowId.length + 1)) !== revision)
      throw contractError();
  }
  return {
    flowId,
    revision,
    serverTime: dateTime(item.server_time),
    expiresAt: dateTime(item.expires_at),
    recoveryReady: item.recovery_ready,
    sessionGeneration:
      item.session_generation === null
        ? null
        : sequence(item.session_generation),
    sessionCookiePresent: item.session_cookie_present,
    lastIdentityChangeRevision,
    pendingTransition,
    requestedTransition,
    nextTransitionId,
  };
}

export function mapFlowRevision(value: unknown): FlowRevision {
  const item = record(value);
  if (!hasOnlyKeys(item, ["flow_id", "revision"])) throw contractError();
  const flowId = nonEmpty(item.flow_id);
  if (!UUID.test(flowId)) throw contractError();
  return { flowId, revision: sequence(item.revision) };
}

export function mapAuthFlowCreated(value: unknown): AuthFlowCreated {
  const item = record(value) as unknown as Partial<WireAuthFlowCreated>;
  if (!hasOnlyKeys(item, ["flow_id", "revision", "expires_at"]))
    throw contractError();
  const flow = mapFlowRevision({
    flow_id: item.flow_id,
    revision: item.revision,
  });
  return { ...flow, expiresAt: dateTime(item.expires_at) };
}

export function mapRecoveryCookieResult(value: unknown): RecoveryCookieResult {
  const item = record(value) as unknown as Partial<WireRecoveryCookieResult>;
  if (
    !hasOnlyKeys(item, [
      "flow_id",
      "revision",
      "recovery_csrf_token",
      "expires_at",
    ])
  )
    throw contractError();
  return {
    ...mapFlowRevision({
      flow_id: item.flow_id,
      revision: item.revision,
    }),
    recoveryCsrfToken: nonEmpty(item.recovery_csrf_token),
    expiresAt: dateTime(item.expires_at),
  };
}

export function mapRecoveryReady(value: unknown): RecoveryReady {
  const item = record(value) as unknown as Partial<WireRecoveryReady>;
  if (
    !hasOnlyKeys(item, ["flow_id", "revision", "expires_at", "ready"]) ||
    item.ready !== true
  )
    throw contractError();
  return {
    ...mapFlowRevision({
      flow_id: item.flow_id,
      revision: item.revision,
    }),
    expiresAt: dateTime(item.expires_at),
    ready: true,
  };
}

export function mapRestartEligibility(value: unknown): RestartEligibility {
  const item = record(value) as unknown as Partial<WireRestartEligibility>;
  if (
    !hasOnlyKeys(item, ["restart_eligible"]) ||
    typeof item.restart_eligible !== "boolean"
  )
    throw contractError();
  return { restartEligible: item.restart_eligible };
}

export function mapRecoveryContext(value: unknown): RecoveryContext {
  const item = record(value) as unknown as Partial<WireRecoveryContext>;
  if (!hasOnlyKeys(item, ["items"]) || !Array.isArray(item.items))
    throw contractError();
  const items = item.items.map((raw) => {
    const entry = record(raw);
    if (
      !hasOnlyKeys(entry, ["flow_id", "revision", "proof_kind"]) ||
      (entry.proof_kind !== "recovery" && entry.proof_kind !== "session")
    )
      throw contractError();
    return {
      ...mapFlowRevision({
        flow_id: entry.flow_id,
        revision: entry.revision,
      }),
      proofKind: entry.proof_kind as "recovery" | "session",
    };
  });
  if (new Set(items.map((entry) => entry.flowId)).size !== items.length)
    throw contractError();
  return { items };
}

export function mapRecoveryCsrf(value: unknown): RecoveryCsrf {
  const item = record(value) as unknown as Partial<WireRecoveryCsrf>;
  if (
    !hasOnlyKeys(item, [
      "flow_id",
      "revision",
      "recovery_csrf_token",
      "expires_at",
    ])
  )
    throw contractError();
  return {
    ...mapFlowRevision({
      flow_id: item.flow_id,
      revision: item.revision,
    }),
    recoveryCsrfToken: nonEmpty(item.recovery_csrf_token),
    expiresAt: dateTime(item.expires_at),
  };
}

export function mapAuthTransitionPermit(value: unknown): AuthTransitionPermit {
  const item = record(value) as unknown as Partial<WireAuthTransitionPermit>;
  if (
    !hasOnlyKeys(item, [
      "flow_id",
      "transition_id",
      "kind",
      "revision",
      "permit_expires_at",
    ]) ||
    (item.kind !== "anonymous_session" &&
      item.kind !== "login" &&
      item.kind !== "logout" &&
      item.kind !== "password_change" &&
      item.kind !== "reauthenticate")
  )
    throw contractError();
  const flow = mapFlowRevision({
    flow_id: item.flow_id,
    revision: item.revision,
  });
  const transitionId = nonEmpty(item.transition_id);
  if (
    !transitionId.startsWith(`${flow.flowId}.`) ||
    BigInt(transitionId.slice(flow.flowId.length + 1)) + 1n !==
      BigInt(flow.revision)
  )
    throw contractError();
  sequence(transitionId.slice(flow.flowId.length + 1));
  return {
    ...flow,
    transitionId,
    kind: item.kind,
    permitExpiresAt: dateTime(item.permit_expires_at),
  };
}

export function mapSettledAuthTransition(
  value: unknown,
): SettledAuthTransition {
  const item = record(value) as unknown as Partial<WireSettledAuthTransition>;
  if (!hasOnlyKeys(item, ["flow_id", "revision", "transition_id", "result"]))
    throw contractError();
  const flow = mapFlowRevision({
    flow_id: item.flow_id,
    revision: item.revision,
  });
  const transitionId = nonEmpty(item.transition_id);
  const transition = mapAuthTransition(item.result, flow.flowId);
  if (transition.transitionId !== transitionId) throw contractError();
  return { ...flow, transitionId, transition };
}

export function mapAnonymousSessionResult(
  value: unknown,
): AnonymousSessionResult {
  const item = record(value) as unknown as Partial<WireAnonymousSessionResult>;
  if (
    !hasOnlyKeys(item, [
      "flow_id",
      "revision",
      "session_generation",
      "csrf_token",
      "expires_at",
    ])
  )
    throw contractError();
  return {
    ...mapFlowRevision({
      flow_id: item.flow_id,
      revision: item.revision,
    }),
    sessionGeneration: sequence(item.session_generation),
    csrfToken: nonEmpty(item.csrf_token),
    expiresAt: dateTime(item.expires_at),
  };
}

export function mapAuthResult(value: unknown): AuthResult {
  const item = record(value) as unknown as Partial<WireAuthResult>;
  return {
    user: mapSelf(item.user),
    csrfToken: nonEmpty(item.csrf_token),
  };
}

export function mapCsrfToken(value: unknown): CsrfToken {
  const item = record(value) as unknown as Partial<WireCsrfToken>;
  return {
    csrfToken: nonEmpty(item.csrf_token),
    expiresAt: dateTime(item.expires_at),
  };
}

export function mapRegisteredUser(value: unknown): RegisteredUser {
  const item = record(value) as unknown as Partial<WireRegisteredUser>;
  if (
    Object.keys(item).some(
      (key) =>
        ![
          "id",
          "login_id",
          "nickname",
          "approved",
          "pending_expires_at",
        ].includes(key),
    )
  )
    throw contractError();
  const id = nonEmpty(item.id);
  if (!UUID.test(id) || item.approved !== false) throw contractError();
  return {
    id,
    loginId: nonEmpty(item.login_id),
    nickname: nonEmpty(item.nickname),
    approved: false,
    pendingExpiresAt: dateTime(item.pending_expires_at),
  };
}

function hasOnlyKeys(item: Record<string, unknown>, keys: readonly string[]) {
  return Object.keys(item).every((key) => keys.includes(key));
}

export function mapAdminUser(value: unknown): AdminUser {
  const item = record(value) as unknown as Partial<WireAdminUser>;
  if (
    !hasOnlyKeys(item, [
      "id",
      "login_id",
      "nickname",
      "role",
      "approved",
      "account_version",
      "created_at",
      "first_approved_at",
      "pending_expires_at",
    ])
  )
    throw contractError();
  const id = nonEmpty(item.id);
  if (
    !UUID.test(id) ||
    (item.role !== "admin" && item.role !== "user") ||
    typeof item.approved !== "boolean"
  )
    throw contractError();
  return {
    id,
    loginId: nonEmpty(item.login_id),
    nickname: nonEmpty(item.nickname),
    role: item.role,
    approved: item.approved,
    accountVersion: integer(item.account_version, 1),
    createdAt: dateTime(item.created_at),
    firstApprovedAt: nullableDateTime(item.first_approved_at),
    pendingExpiresAt: nullableDateTime(item.pending_expires_at),
  };
}

export function mapAdminStats(value: unknown): AdminStats {
  const item = record(value) as unknown as Partial<WireAdminStats>;
  if (
    !hasOnlyKeys(item, [
      "total_users",
      "pending_users",
      "total_apps",
      "healthy_apps",
    ])
  )
    throw contractError();
  const totalUsers = integer(item.total_users, 0);
  const pendingUsers = integer(item.pending_users, 0);
  const totalApps = integer(item.total_apps, 0);
  const healthyApps = integer(item.healthy_apps, 0);
  if (pendingUsers > totalUsers || healthyApps > totalApps)
    throw contractError();
  return { totalUsers, pendingUsers, totalApps, healthyApps };
}

export function mapAdminUserPage(value: unknown): AdminUserPage {
  const item = record(value) as unknown as Partial<WireAdminUserPage>;
  if (
    !hasOnlyKeys(item, ["items", "pagination", "stats", "server_time"]) ||
    !Array.isArray(item.items)
  )
    throw contractError();
  const pagination = record(item.pagination);
  if (
    !hasOnlyKeys(pagination, ["limit", "offset", "total", "has_more"]) ||
    typeof pagination.has_more !== "boolean"
  )
    throw contractError();
  const limit = integer(pagination.limit, 1, 100);
  const offset = integer(pagination.offset, 0);
  const total = integer(pagination.total, 0);
  const items = item.items.map(mapAdminUser);
  if (
    items.length > limit ||
    pagination.has_more !== offset + items.length < total
  )
    throw contractError();
  return {
    items,
    pagination: { limit, offset, total, hasMore: pagination.has_more },
    stats: mapAdminStats(item.stats),
    serverTime: dateTime(item.server_time),
  };
}

export function mapApprovalOperation(value: unknown): ApprovalOperation {
  const item = record(value) as unknown as Partial<WireApprovalOperation>;
  if (
    !hasOnlyKeys(item, [
      "key",
      "kind",
      "target_id",
      "issued_at",
      "expires_at",
      "state",
      "applied_account_version",
      "applied_approved",
      "finalized_at",
      "rejection_code",
    ]) ||
    item.kind !== "user_approval" ||
    !["unresolved", "succeeded", "rejected"].includes(String(item.state))
  )
    throw contractError();
  const key = nonEmpty(item.key);
  const targetId = nonEmpty(item.target_id);
  if (!UUID.test(key) || !UUID.test(targetId)) throw contractError();
  const state = item.state as ApprovalOperation["state"];
  const appliedAccountVersion =
    item.applied_account_version === null
      ? null
      : integer(item.applied_account_version, 1);
  const appliedApproved = item.applied_approved;
  const finalizedAt = nullableDateTime(item.finalized_at);
  const rejectionCode = nullableString(item.rejection_code);
  if (
    (appliedApproved !== null && typeof appliedApproved !== "boolean") ||
    (state === "unresolved" &&
      (appliedAccountVersion !== null ||
        appliedApproved !== null ||
        finalizedAt !== null ||
        rejectionCode !== null)) ||
    (state === "succeeded" &&
      (appliedAccountVersion === null ||
        appliedApproved === null ||
        finalizedAt === null ||
        rejectionCode !== null)) ||
    (state === "rejected" &&
      (appliedAccountVersion !== null ||
        appliedApproved !== null ||
        finalizedAt === null ||
        rejectionCode === null))
  )
    throw contractError();
  return {
    key,
    kind: "user_approval",
    targetId,
    issuedAt: dateTime(item.issued_at),
    expiresAt: dateTime(item.expires_at),
    state,
    appliedAccountVersion,
    appliedApproved,
    finalizedAt,
    rejectionCode,
  };
}

export function mapAppWriteOperation(value: unknown): AppWriteOperation {
  const item = record(value) as unknown as Partial<WireAppWriteOperation>;
  if (
    !hasOnlyKeys(item, [
      "key",
      "kind",
      "target_id",
      "issued_at",
      "expires_at",
      "state",
      "db_applied_at",
      "finalized_at",
      "result_version",
      "rejection_code",
      "server_time",
    ]) ||
    item.kind !== "app_create" ||
    !["unresolved", "succeeded", "rejected"].includes(String(item.state))
  )
    throw contractError();

  const key = nonEmpty(item.key);
  const targetId = nullableString(item.target_id);
  if (!UUID.test(key) || (targetId !== null && !UUID.test(targetId)))
    throw contractError();
  const issuedAt = dateTime(item.issued_at);
  const expiresAt = dateTime(item.expires_at);
  const state = item.state as AppWriteOperation["state"];
  const dbAppliedAt = nullableDateTime(item.db_applied_at);
  const finalizedAt = nullableDateTime(item.finalized_at);
  const resultVersion =
    item.result_version === null ? null : integer(item.result_version, 1);
  const rejectionCode = nullableString(item.rejection_code);
  if (
    (rejectionCode !== null && !rejectionCode) ||
    Date.parse(expiresAt) <= Date.parse(issuedAt) ||
    (state === "unresolved" &&
      (targetId !== null ||
        dbAppliedAt !== null ||
        finalizedAt !== null ||
        resultVersion !== null ||
        rejectionCode !== null)) ||
    (state === "succeeded" &&
      (targetId === null ||
        dbAppliedAt === null ||
        finalizedAt === null ||
        resultVersion === null ||
        rejectionCode !== null)) ||
    (state === "rejected" &&
      (targetId !== null ||
        dbAppliedAt !== null ||
        finalizedAt === null ||
        resultVersion !== null ||
        rejectionCode === null))
  )
    throw contractError();
  return {
    key,
    kind: "app_create",
    targetId,
    issuedAt,
    expiresAt,
    state,
    dbAppliedAt,
    finalizedAt,
    resultVersion,
    rejectionCode,
    serverTime: dateTime(item.server_time),
  };
}

function mapTheme(value: unknown): Theme {
  const item = record(value);
  const ink = item.ink;
  if (ink !== "dark" && ink !== "light") throw contractError();
  const from = string(item.from);
  const to = string(item.to);
  if (!/^#[0-9a-f]{6}$/i.test(from) || !/^#[0-9a-f]{6}$/i.test(to))
    throw contractError();
  return {
    id: nonEmpty(item.id),
    name: nonEmpty(item.name),
    pantone: nonEmpty(item.pantone),
    from,
    to,
    ink,
  };
}

function mapCapability(value: unknown): WireCapability {
  const item = record(value);
  if (typeof item.enabled !== "boolean" || !Array.isArray(item.reasons))
    throw contractError();
  const reasons = item.reasons.map((reason) => {
    if (!REASONS.includes(reason as WireReason)) throw contractError();
    return reason as WireReason;
  });
  if (item.enabled && reasons.length !== 0) throw contractError();
  return { enabled: item.enabled, reasons };
}

const CAPABILITY_KEYS: (keyof Wire["Capabilities"])[] = [
  "apps_read",
  "auth_register",
  "auth_login",
  "auth_logout",
  "auth_password_change",
  "admin_users_read",
  "admin_approval",
  "admin_summary",
  "apps_create",
  "apps_update_own",
  "apps_delete_own",
  "admin_apps_read",
  "admin_apps_manage",
  "admin_reauth",
  "admin_password_reset",
  "admin_user_delete",
  "health_read",
  "health_check",
  "health_batch",
  "email_collection",
  "phone_collection",
];

export function mapMeta(value: unknown): Meta {
  const item = record(value) as unknown as Partial<WireMeta>;
  const themes = item.themes;
  if (!Array.isArray(themes)) throw contractError();
  const rawCapabilities = record(item.capabilities);
  const capabilities = Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [key, mapCapability(rawCapabilities[key])]),
  ) as Wire["Capabilities"];
  const support = record(item.support);
  const initialPendingDays = integer(item.initial_pending_days, 1);
  return {
    subjects: catalogValues(item.subjects, SUBJECTS, true),
    grades: catalogValues(item.grades, GRADES, true),
    themes: themes.map(mapTheme),
    serverTime: dateTime(item.server_time),
    capabilities,
    support: {
      email: nullableString(support.email),
      service_url: nullableString(support.service_url),
      announcement_url: nullableString(support.announcement_url),
    },
    initialPendingDays,
  };
}

function mapHealth(value: unknown): HealthView {
  const item = record(value);
  const result = record(item.result);
  const state = result.state;
  if (!HEALTH_STATES.includes(state as (typeof HEALTH_STATES)[number]))
    throw contractError();
  const latestJob = item.latest_job;
  if (latestJob !== null) {
    const job = record(latestJob);
    const statuses = ["queued", "running", "completed", "failed", "cancelled"];
    if (!statuses.includes(string(job.status))) throw contractError();
    if (!UUID.test(nonEmpty(job.id))) throw contractError();
    dateTime(job.created_at);
    nullableDateTime(job.started_at);
    nullableDateTime(job.finished_at);
    nullableString(job.failure_code);
  }
  return {
    result: {
      state: state as WireHealthResult["state"],
      checked_at: nullableDateTime(result.checked_at),
      fresh_until: nullableDateTime(result.fresh_until),
    },
    latestJob: latestJob as WireHealth["latest_job"],
    nextCheckAt: nullableDateTime(item.next_check_at),
  };
}

function mapCard(value: unknown): AppCard {
  const item = record(value);
  const owner = record(item.owner);
  const id = nonEmpty(item.id);
  const ownerId = nonEmpty(owner.id);
  if (
    !UUID.test(id) ||
    !UUID.test(ownerId) ||
    typeof item.is_public !== "boolean"
  )
    throw contractError();
  return {
    id,
    ownerId,
    owner: nonEmpty(owner.nickname),
    name: nonEmpty(item.name),
    subject: catalogValue(item.subject, SUBJECTS),
    grades: catalogValues(item.grades, GRADES),
    isPublic: item.is_public,
    themeId: nonEmpty(item.theme_id),
    version: integer(item.version, 1),
    urlVersion: integer(item.url_version, 1),
    health: mapHealth(item.health),
  };
}

export function mapAppPage(value: unknown): AppPage {
  const item = record(value);
  if (!Array.isArray(item.items)) throw contractError();
  const pagination = record(item.pagination);
  const facets = record(item.facets);
  const limit = integer(pagination.limit, 1, 100);
  const offset = integer(pagination.offset, 0);
  const total = integer(pagination.total, 0);
  if (typeof pagination.has_more !== "boolean") throw contractError();
  const items = item.items.map(mapCard);
  if (items.some((app) => !app.isPublic)) throw contractError();
  return {
    items,
    pagination: { limit, offset, total, hasMore: pagination.has_more },
    serverTime: dateTime(item.server_time),
    facets: { subjectsInUse: catalogValues(facets.subjects_in_use, SUBJECTS) },
  };
}

export function mapAppDetailResponse(value: unknown): {
  item: AppDetail;
  serverTime: string;
} {
  const response = record(value);
  const detail = record(response.item) as unknown as Partial<WireAppDetail>;
  const rawUrl = nonEmpty(detail.url);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw contractError();
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw contractError();
  return {
    item: {
      ...mapCard(detail),
      url: rawUrl,
      prompt: string(detail.prompt),
      description: string(detail.description),
      stack: {
        db: nullableString(detail.stack_db),
        backend: nullableString(detail.stack_backend),
        frontend: nullableString(detail.stack_frontend),
        hosting: nullableString(detail.stack_hosting),
      },
      createdAt: dateTime(detail.created_at),
      updatedAt: dateTime(detail.updated_at),
      serverTime: dateTime(response.server_time),
    },
    serverTime: dateTime(response.server_time),
  };
}

export type AppCardWire = WireAppCard;
