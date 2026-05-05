import { Card } from "@/components/ui/card.js";
import { cn } from "@/lib/cn.js";
import type { SessionState } from "@agent-zoo/shared";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";

interface Props {
  session: SessionState;
  selected: boolean;
  onSelect: () => void;
}

function pickHeroAgent(session: SessionState) {
  const agents = Object.values(session.agents);
  if (agents.length === 0) return null;
  const ranked = agents.slice().sort((a, b) => agentUrgency(b.status) - agentUrgency(a.status));
  return ranked[0] ?? null;
}

function agentUrgency(status: string): number {
  switch (status) {
    case "error":
      return 4;
    case "waiting_for_human":
      return 3;
    case "running":
      return 2;
    case "idle":
      return 1;
    default:
      return 0;
  }
}

function elapsed(fromIso: string): string {
  const ms = Date.now() - Date.parse(fromIso);
  if (Number.isNaN(ms)) return "";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
}

export function SessionCard({ session, selected, onSelect }: Props) {
  const hero = pickHeroAgent(session);
  const heroKind = hero?.kind ?? "main";
  const heroState = statusToMascotState(session.status);

  return (
    <Card
      data-testid={`session-card-${session.id}`}
      data-status={session.status}
      onClick={onSelect}
      className={cn(
        "flex cursor-pointer gap-3 p-3 transition-colors",
        selected ? "border-accent" : "border-border",
      )}
    >
      <Mascot kind={heroKind} state={heroState} size={56} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="truncate font-medium text-sm">{session.cwd_basename}</span>
          <StatusBadge status={session.status} />
        </div>
        <span className="truncate text-fg/60 text-xs">
          {session.cwd} · {elapsed(session.started_at)}
        </span>
        {session.current_activity && (
          <span className="truncate text-fg/80 text-xs">{session.current_activity}</span>
        )}
        {session.waiting_reason && (
          <span className="truncate text-status-waiting text-xs">{session.waiting_reason}</span>
        )}
      </div>
    </Card>
  );
}
