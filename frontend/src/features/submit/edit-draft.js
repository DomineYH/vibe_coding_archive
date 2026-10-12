import { readAuthRoute } from "../auth/auth-route";

export function editRecoveryHref(path) {
  const search = `?mode=login&return_to=${encodeURIComponent(path)}`;
  return path.endsWith("/edit") && !readAuthRoute(search).invalid
    ? `/auth${search}`
    : null;
}

export function isEditRecoveryLocation(location, path) {
  if (location.hash) return false;
  if (location.pathname === path) return !location.search;
  const route = readAuthRoute(location.search);
  return (
    location.pathname === "/auth" &&
    !route.invalid &&
    route.mode === "login" &&
    route.returnTo === path
  );
}

export function discardEditDraft(memory, reason) {
  const slot = memory.slot;
  if (!slot) return null;
  memory.slot = null;
  const result = {
    reason,
    dirty: slot.snapshot?.dirty === true,
    outcome: slot.snapshot?.unknown ? "unknown" : "rejected",
  };
  if (slot.recovering) memory.notice = result;
  return result;
}
