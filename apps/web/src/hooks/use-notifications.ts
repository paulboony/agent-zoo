import type { SessionTransition } from "@/lib/store.js";
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

type NotificationContent = { title: string; body: string; tag?: string };

function fire(session: SessionState, content: NotificationContent): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!isNotificationsEnabled()) return;

  const tabVisible = document.visibilityState === "visible";
  const sessionFocused = focusedSessionIdFromUrl() === session.id;
  if (tabVisible && sessionFocused) return;

  try {
    new Notification(content.title, {
      body: content.body,
      tag: content.tag ?? session.id,
    });
  } catch {
    // permission state can race; ignore
  }
}

function dispatchNotifications(t: SessionTransition): void {
  const { session, prevStatus, isNew, newAgentIds } = t;
  const prefs = getNotificationPrefs();

  if (isNew && prefs.session_start) {
    fire(session, { title: "Session started", body: session.cwd_basename });
  }

  if (prefs.session_error && prevStatus !== "error" && session.status === "error") {
    const body =
      session.agents.main?.last_tool_input_summary ?? "Something went wrong";
    fire(session, { title: `${session.cwd_basename} error`, body });
  }

  if (prefs.session_complete && prevStatus !== "ended" && session.status === "ended") {
    fire(session, { title: `${session.cwd_basename} done`, body: "Session ended" });
  }

  if (
    prefs.waiting_for_human &&
    prevStatus !== "waiting_for_human" &&
    session.status === "waiting_for_human"
  ) {
    const body = session.waiting_reason ?? "Waiting for input";
    fire(session, { title: `${session.cwd_basename} needs you`, body });
  }

  if (prefs.subagent_spawn && newAgentIds.length > 0) {
    for (const agentId of newAgentIds) {
      const agent = session.agents[agentId];
      if (!agent) continue;
      fire(session, {
        title: `New ${agent.kind} agent`,
        body: session.cwd_basename,
        tag: `${session.id}:${agentId}`,
      });
    }
  }
}

export function useNotifications(): void {
  useEffect(() => {
    const unsubscribe = useStore.subscribe((state, prev) => {
      const t = state.lastTransition;
      if (!t || t === prev.lastTransition) return;
      dispatchNotifications(t);
    });
    return unsubscribe;
  }, []);
}
