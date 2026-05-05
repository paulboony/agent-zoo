import { useStore } from "@/lib/store.js";
import type { SessionState } from "@agent-zoo/shared";
import { useEffect } from "react";

const ENABLED_KEY = "dashboard.notifications.enabled";

export function isNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false");
  } catch {
    // private mode etc.
  }
}

function focusedSessionIdFromUrl(): string | null {
  const match = /^\/sessions\/([^/?#]+)/.exec(window.location.pathname);
  return match?.[1] ?? null;
}

function maybeNotify(session: SessionState): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!isNotificationsEnabled()) return;

  const tabVisible = document.visibilityState === "visible";
  const sessionFocused = focusedSessionIdFromUrl() === session.id;
  if (tabVisible && sessionFocused) return;

  const title = `${session.cwd_basename} needs you`;
  const body = session.waiting_reason ?? "Waiting for input";
  try {
    new Notification(title, { body, tag: session.id });
  } catch {
    // permission state can race; ignore
  }
}

export function useNotifications(): void {
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prev) => {
      const t = state.lastTransition;
      if (!t || t === prev.lastTransition) return;
      const wasWaiting = (t.prevStatus ?? null) === "waiting_for_human";
      const isWaiting = t.session.status === "waiting_for_human";
      if (wasWaiting || !isWaiting) return;
      maybeNotify(t.session);
    });
    return unsubscribe;
  }, []);
}
