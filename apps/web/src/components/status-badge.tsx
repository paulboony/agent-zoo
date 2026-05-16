import { Badge } from "@/components/ui/badge.js";
import { cn } from "@/lib/cn.js";
import type { SessionStatus } from "@agent-zoo/shared";

const LABELS: Record<SessionStatus, string> = {
  running: "running",
  blocked: "blocked",
  awaiting_user: "awaiting",
  stale: "stale",
  ended: "ended",
  error: "error",
};

const COLOR_VARS: Record<SessionStatus, string> = {
  running: "var(--status-running)",
  blocked: "var(--status-waiting)",
  awaiting_user: "var(--status-idle)",
  stale: "var(--status-stale)",
  ended: "var(--status-ended)",
  error: "var(--status-error)",
};

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge
      data-testid={`status-${status}`}
      className={cn("border-transparent text-fg")}
      style={{ backgroundColor: COLOR_VARS[status] }}
    >
      {LABELS[status]}
    </Badge>
  );
}
