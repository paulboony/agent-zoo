// apps/web/src/components/session-activity.tsx
import { cn } from "@/lib/cn.js";
import { formatDuration } from "@/lib/format-duration.js";
import { useNow } from "@/hooks/use-now.js";
import type { SessionState, SessionStatus } from "@agent-zoo/shared";

const LABEL: Record<SessionStatus, string> = {
  running: "Running",
  blocked: "Waiting",
  awaiting_user: "Idle",
  stale: "Stale",
  ended: "Ended",
  error: "Error",
};

const DOT_VAR: Record<SessionStatus, string> = {
  running: "var(--status-running)",
  blocked: "var(--status-waiting)",
  awaiting_user: "var(--status-idle)",
  stale: "var(--status-stale)",
  ended: "var(--status-ended)",
  error: "var(--status-error)",
};

/** "Bash(rm -rf ...)" -> "ToolName(...)" — treat as a permission prompt. */
const PERMISSION_PROMPT = /^[A-Z]\w+\(/;

function labelFor(session: SessionState): string {
  if (session.status === "blocked" && session.waiting_reason && PERMISSION_PROMPT.test(session.waiting_reason)) {
    return "Waiting · permission";
  }
  return LABEL[session.status];
}

function subTextFor(session: SessionState): string | undefined {
  switch (session.status) {
    case "running":
      return session.current_activity ?? session.agents.main?.current_tool;
    case "blocked":
      return session.waiting_reason;
    case "stale":
      return session.current_activity ?? session.agents.main?.last_tool;
    case "error":
      return session.waiting_reason ?? session.current_activity;
    default:
      return undefined;
  }
}

interface Props {
  session: SessionState;
  variant: "card" | "header";
}

export function SessionActivity({ session, variant }: Props) {
  const now = useNow();
  const lastEventMs = Date.parse(session.last_event_at);
  const showDuration = session.status !== "ended" && Number.isFinite(lastEventMs);
  const duration = showDuration ? formatDuration(now - lastEventMs) : undefined;
  const label = labelFor(session);
  const sub = subTextFor(session);
  const dot = DOT_VAR[session.status];

  // The session card already shows status (StatusBadge) and recency
  // ("active <TimeAgo>"), so the card variant renders only the goal line
  // plus the activity sub-text — no redundant dot/label/duration. The
  // detail header has no other status indicator, so it gets the full chip.
  const textSize = variant === "header" ? "text-sm" : "text-xs";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {session.last_user_prompt && (
        <span
          data-testid="session-goal"
          title={session.last_user_prompt}
          className={cn("min-w-0 truncate italic text-fg/70", textSize)}
        >
          › {session.last_user_prompt}
        </span>
      )}
      {variant === "card"
        ? sub && (
            <span className={cn("min-w-0 truncate text-fg/70", textSize)} title={sub}>
              {sub}
            </span>
          )
        : (
            <div className={cn("flex min-w-0 items-center gap-2", textSize)}>
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: dot }}
              />
              <span
                data-testid="session-status-label"
                className="shrink-0 font-medium"
                style={{ color: dot }}
              >
                {label}
              </span>
              {sub && (
                <span className="min-w-0 flex-1 truncate text-fg/70" title={sub}>
                  · {sub}
                </span>
              )}
              {duration && (
                <span className="shrink-0 tabular-nums text-fg/45">{duration}</span>
              )}
            </div>
          )}
    </div>
  );
}
