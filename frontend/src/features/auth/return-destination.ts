import type { CurrentAuthState } from "../../services/auth-service";
import type { AppsService } from "../../services/apps-service";
import {
  assertAuthObservation,
  captureAuthObservation,
} from "../../services/auth-state";
import { ServiceError } from "../../services/service-error";
import { readAuthRoute } from "./auth-route";

export async function recheckReturnDestination(
  destination: string,
  current: CurrentAuthState | null,
  apps: Pick<AppsService, "getMeta" | "get">,
  isCurrent: () => boolean,
): Promise<string> {
  if (readAuthRoute(`?return_to=${encodeURIComponent(destination)}`).invalid)
    throw new ServiceError("VALIDATION_ERROR", "이동할 경로를 확인해 주세요.");
  const meta = await apps.getMeta();
  const full =
    current?.status === "ready" &&
    current.user?.approved &&
    current.user.sessionKind === "full" &&
    !current.user.mustChangePassword;
  const context = full ? captureAuthObservation(current, isCurrent) : undefined;
  if (destination === "/admin") {
    if (context) assertAuthObservation(context);
    if (full && current.user?.role === "user") {
      if (!meta.capabilities.apps_read.enabled)
        throw new ServiceError(
          "FEATURE_UNAVAILABLE",
          "아카이브를 현재 사용할 수 없어요.",
        );
      return "/";
    }
    if (!meta.capabilities.admin_users_read.enabled)
      throw new ServiceError(
        "FEATURE_UNAVAILABLE",
        "관리자 기능을 현재 사용할 수 없어요.",
      );
    if (!full || current.user?.role !== "admin")
      throw new ServiceError("FORBIDDEN", "관리자 권한이 필요해요.");
  } else {
    if (!meta.capabilities.apps_read.enabled)
      throw new ServiceError(
        "FEATURE_UNAVAILABLE",
        "아카이브를 현재 사용할 수 없어요.",
      );
    if (destination === "/apps/new") {
      if (
        !full ||
        (current.user?.role !== "user" && current.user?.role !== "admin")
      )
        throw new ServiceError(
          "FORBIDDEN",
          "승인된 회원만 앱을 등록할 수 있어요.",
        );
      assertAuthObservation(context!);
      if (!meta.capabilities.apps_create.enabled)
        throw new ServiceError(
          "FEATURE_UNAVAILABLE",
          "앱 등록 기능을 현재 사용할 수 없어요.",
        );
    } else if (destination.startsWith("/apps/")) {
      const id = destination.split("/")[2];
      let app;
      try {
        app = await apps.get(id);
      } catch (error) {
        if (
          !(error instanceof ServiceError) ||
          error.code !== "NOT_FOUND" ||
          !context
        )
          throw error;
      }
      if (app?.isPublic) return destination;
      if (!context)
        throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
          httpStatus: 404,
        });
      app = await apps.get(id, { readContext: context });
      assertAuthObservation(context);
      if (!app.isPublic) {
        if (context) assertAuthObservation(context);
        if (
          !full ||
          (current.user?.role !== "admin" && current.user?.id !== app.ownerId)
        )
          throw new ServiceError("NOT_FOUND", "아카이브 앱을 찾을 수 없어요.", {
            httpStatus: 404,
          });
      }
    }
  }
  return destination;
}
