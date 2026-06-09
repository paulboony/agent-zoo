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

export function StatusBadge({ status }: { status: SessionStatus }) {
  return (
    <Badge
      data-testid={`status-${status}`}
      className={cn("border-transparent")}
      style={{
        backgroundColor: `var(--status-bg-${status})`,
        color: `var(--status-text-${status}, var(--fg))`,
      }}
    >
      {LABELS[status]}
    </Badge>
  );
}
