import { useLayoutEffect, useRef } from "react";
import { readAuthRoute } from "../features/auth/auth-route";
import { readAdminTab } from "../features/admin/admin-route";

function displayed(element) {
  if (
    !element?.isConnected ||
    element.closest('[hidden], [inert], [aria-hidden="true"]')
  )
    return false;
  for (let node = element; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse"
    )
      return false;
  }
  return true;
}

export function useRouteFocus(rootRef, location) {
  const route =
    location.pathname === "/auth"
      ? readAuthRoute(location.search)
      : location.pathname === "/admin"
        ? readAdminTab(location.search)
        : null;
  const key = `${location.pathname}:${route ? `${route.mode ?? route.tab}:${route.invalid}` : ""}`;
  const state = useRef({
    key,
    initial: true,
    interacted: false,
    pending: false,
    target: null,
  });

  useLayoutEffect(() => {
    const current = state.current;
    if (current.key !== key) {
      current.key = key;
      if (current.interacted) current.initial = false;
      current.pending = !current.initial;
      current.target = null;
    }
    let frame = null;
    let focusing = false;
    const root = rootRef.current;
    const abandon = () => {
      current.pending = false;
    };
    const process = () => {
      frame = null;
      if (
        (!current.initial && !current.pending) ||
        document.visibilityState === "hidden"
      )
        return;
      const main = [...root.querySelectorAll("[data-route-main]")].find(
        displayed,
      );
      if (!main) return;
      const pending = main.dataset.routePending === "true";
      if (current.initial) {
        if (!pending) current.initial = false;
        return;
      }
      const active = document.activeElement;
      const dialog = active?.closest(
        '[role="dialog"], [role="alertdialog"], dialog[open]',
      );
      const trigger = active?.matches('[role="tab"], a[href^="/auth?mode="]');
      if (
        displayed(active) &&
        ((dialog && displayed(dialog)) ||
          (main.contains(active) && active !== main && !trigger))
      ) {
        abandon();
        return;
      }
      focusing = true;
      if (active !== main) main.focus({ preventScroll: true });
      focusing = false;
      current.target = main;
      if (!pending) abandon();
    };
    const schedule = () => {
      if ((current.initial || current.pending) && frame === null)
        frame = requestAnimationFrame(process);
    };
    const interaction = (event) => {
      if (
        event.type === "keydown" &&
        !["Tab", "Enter", " ", "ArrowLeft", "ArrowRight"].includes(event.key)
      )
        return;
      if (
        (event.type === "click" ||
          (event.type === "keydown" && event.key !== "Tab")) &&
        event.target.closest('a[href], header button, [role="tab"]')
      )
        current.interacted = true;
      if (current.pending) abandon();
    };
    const focus = (event) => {
      if (
        !focusing &&
        current.pending &&
        event.target !== current.target &&
        !event.target.matches("[data-route-main]") &&
        displayed(event.target)
      )
        abandon();
    };
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-route-pending",
        "hidden",
        "inert",
        "aria-hidden",
        "class",
        "style",
      ],
    });
    document.addEventListener("pointerdown", interaction, true);
    document.addEventListener("click", interaction, true);
    document.addEventListener("keydown", interaction, true);
    document.addEventListener("focusin", focus, true);
    schedule();
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", interaction, true);
      document.removeEventListener("click", interaction, true);
      document.removeEventListener("keydown", interaction, true);
      document.removeEventListener("focusin", focus, true);
    };
  }, [key, location.key, rootRef]);
}
