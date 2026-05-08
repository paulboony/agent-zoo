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

export type NotificationEvent =
  | "waiting_for_human"
  | "session_error"
  | "session_start"
  | "session_complete"
  | "subagent_spawn";

export type NotificationPrefs = Record<NotificationEvent, boolean>;

const PREF_KEYS: Record<NotificationEvent, string> = {
  waiting_for_human: "dashboard.notifications.waiting_for_human",
  session_error: "dashboard.notifications.session_error",
  session_start: "dashboard.notifications.session_start",
  session_complete: "dashboard.notifications.session_complete",
  subagent_spawn: "dashboard.notifications.subagent_spawn",
};

const DEFAULT_PREFS: NotificationPrefs = {
  waiting_for_human: true,
  session_error: true,
  session_start: false,
  session_complete: false,
  subagent_spawn: false,
};

function readPref(event: NotificationEvent): boolean {
  try {
    const raw = localStorage.getItem(PREF_KEYS[event]);
    if (raw === null) return DEFAULT_PREFS[event];
    return raw === "true";
  } catch {
    return DEFAULT_PREFS[event];
  }
}

export function getNotificationPrefs(): NotificationPrefs {
  return {
    waiting_for_human: readPref("waiting_for_human"),
    session_error: readPref("session_error"),
    session_start: readPref("session_start"),
    session_complete: readPref("session_complete"),
    subagent_spawn: readPref("subagent_spawn"),
  };
}

export function setNotificationPref(event: NotificationEvent, value: boolean): void {
  try {
    localStorage.setItem(PREF_KEYS[event], value ? "true" : "false");
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
