import { resolveDisplayKind } from "@/lib/mascot-kind.js";
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
  | "session_start"
  | "session_error"
  | "session_complete"
  | "blocked"
  | "subagent_spawn";

export type NotificationPrefs = Record<NotificationEvent, boolean>;

type NotificationContent = {
  title: string;
  body: string;
  tag?: string;
  /**
   * If true, fire even when the user is currently viewing this session.
   * Used by you-must-act events (errors, blocked-on-user).
   */
  ignoreFocus?: boolean;
  /**
   * Pass-through to the Notification API. When true the banner stays on
   * screen until the user dismisses it instead of auto-fading.
   */
  requireInteraction?: boolean;
};

interface NotificationRule {
  event: NotificationEvent;
  defaultEnabled: boolean;
  /** Compute zero-or-more notifications to fire for this transition. */
  trigger: (t: SessionTransition) => NotificationContent[];
}

/**
 * The set of notification rules, in display order. Adding a new event:
 *   1. add a new entry here,
 *   2. add the literal to the NotificationEvent union above,
 *   3. add a switch row in notifications-section.tsx for the label.
 * `PREF_KEYS`, `DEFAULT_PREFS`, and `getNotificationPrefs` are derived
 * from this array.
 */
const NOTIFICATION_RULES: NotificationRule[] = [
  {
    event: "session_start",
    defaultEnabled: false,
    trigger: ({ session, isNew }) =>
      isNew
        ? [{ title: "Session started", body: session.cwd_basename }]
        : [],
  },
  {
    event: "session_error",
    defaultEnabled: true,
    trigger: ({ session, prevStatus }) =>
      prevStatus !== "error" && session.status === "error"
        ? [
            {
              title: `${session.cwd_basename} error`,
              body:
                session.agents.main?.last_tool_input_summary ??
                "Something went wrong",
              ignoreFocus: true,
              requireInteraction: true,
            },
          ]
        : [],
  },
  {
    event: "session_complete",
    defaultEnabled: false,
    trigger: ({ session, prevStatus }) =>
      prevStatus !== "ended" && session.status === "ended"
        ? [{ title: `${session.cwd_basename} done`, body: "Session ended" }]
        : [],
  },
  {
    event: "blocked",
    defaultEnabled: true,
    trigger: ({ session, prevStatus }) =>
      prevStatus !== "blocked" && session.status === "blocked"
        ? [
            {
              title: `${session.cwd_basename} needs you`,
              body: session.waiting_reason ?? "Waiting for input",
              ignoreFocus: true,
              requireInteraction: true,
            },
          ]
        : [],
  },
  {
    event: "subagent_spawn",
    defaultEnabled: false,
    trigger: ({ session, newAgentIds }) =>
      newAgentIds.flatMap((agentId) => {
        const agent = session.agents[agentId];
        if (!agent) return [];
        return [
          {
            title: `New ${resolveDisplayKind(agent)} agent`,
            body: session.cwd_basename,
            tag: `${session.id}:${agentId}`,
          },
        ];
      }),
  },
];

const PREF_KEYS: Record<NotificationEvent, string> = Object.fromEntries(
  NOTIFICATION_RULES.map((r) => [r.event, `dashboard.notifications.${r.event}`]),
) as Record<NotificationEvent, string>;

const DEFAULT_PREFS: NotificationPrefs = Object.fromEntries(
  NOTIFICATION_RULES.map((r) => [r.event, r.defaultEnabled]),
) as NotificationPrefs;

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
  return Object.fromEntries(
    NOTIFICATION_RULES.map((r) => [r.event, readPref(r.event)]),
  ) as NotificationPrefs;
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

function fire(session: SessionState, content: NotificationContent): void {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  if (!isNotificationsEnabled()) return;

  if (!content.ignoreFocus) {
    const tabVisible = document.visibilityState === "visible";
    const sessionFocused = focusedSessionIdFromUrl() === session.id;
    if (tabVisible && sessionFocused) return;
  }

  try {
    new Notification(content.title, {
      body: content.body,
      tag: content.tag ?? session.id,
      requireInteraction: content.requireInteraction ?? false,
    });
  } catch {
    // permission state can race; ignore
  }
}

export function dispatchNotifications(t: SessionTransition): void {
  const prefs = getNotificationPrefs();
  for (const rule of NOTIFICATION_RULES) {
    if (!prefs[rule.event]) continue;
    for (const content of rule.trigger(t)) {
      fire(t.session, content);
    }
  }
}

export function useNotifications(): void {
  const lastTransition = useStore((s) => s.lastTransition);
  useEffect(() => {
    if (lastTransition) dispatchNotifications(lastTransition);
  }, [lastTransition]);
}
