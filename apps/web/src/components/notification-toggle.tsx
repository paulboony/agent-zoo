import { Switch } from "@/components/ui/switch.js";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip.js";
import { isNotificationsEnabled, setNotificationsEnabled } from "@/hooks/use-notifications.js";
import { useEffect, useState } from "react";

type Permission = "default" | "granted" | "denied" | "unsupported";

function readPermission(): Permission {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

export function NotificationToggle() {
  const [permission, setPermission] = useState<Permission>(() => readPermission());
  const [enabled, setEnabled] = useState<boolean>(() => isNotificationsEnabled());

  useEffect(() => {
    setPermission(readPermission());
  }, []);

  async function handleChange(next: boolean) {
    if (permission === "default" && next) {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") return;
    }
    setEnabled(next);
    setNotificationsEnabled(next);
  }

  if (permission === "unsupported") {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Switch disabled aria-label="Notifications" />
          </TooltipTrigger>
          <TooltipContent>Notifications not supported in this browser.</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (permission === "denied") {
    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Switch disabled aria-label="Notifications" />
          </TooltipTrigger>
          <TooltipContent>
            Notifications denied. Update browser site settings to allow.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <Switch
      data-testid="notification-toggle"
      checked={permission === "granted" && enabled}
      onCheckedChange={handleChange}
      aria-label="Notifications"
    />
  );
}
