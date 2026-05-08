import { Switch } from "@/components/ui/switch.js";
import {
  type NotificationEvent,
  getNotificationPrefs,
  setNotificationPref,
} from "@/hooks/use-notifications.js";
import { useEffect, useState } from "react";

const EVENTS: { event: NotificationEvent; label: string }[] = [
  { event: "waiting_for_human", label: "Waiting for human input" },
  { event: "session_error", label: "Session errors" },
  { event: "session_start", label: "New session starts" },
  { event: "session_complete", label: "Session completes" },
  { event: "subagent_spawn", label: "Subagent spawned" },
];

function readPermission(): NotificationPermission | "unsupported" {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function NotificationsSection() {
  const [prefs, setPrefs] = useState(() => getNotificationPrefs());
  const [permission, setPermission] = useState(() => readPermission());

  useEffect(() => {
    setPermission(readPermission());
  }, []);

  function handleChange(event: NotificationEvent, value: boolean) {
    setNotificationPref(event, value);
    setPrefs((prev) => ({ ...prev, [event]: value }));
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 className="font-medium text-base">Notifications</h3>
        <p className="text-fg/60 text-sm">
          Browser notifications for session events. Enable the bell in the header to
          receive any of these.
        </p>
      </header>
      {permission !== "granted" && (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-fg/70 text-xs">
          Browser notifications are blocked. Enable the bell in the header first.
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
        {EVENTS.map(({ event, label }) => (
          <li key={event} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <label htmlFor={`notif-${event}`} className="text-sm">
              {label}
            </label>
            <Switch
              id={`notif-${event}`}
              data-testid={`notif-switch-${event}`}
              checked={prefs[event]}
              onCheckedChange={(v) => handleChange(event, v)}
              aria-label={label}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
