import { useSidebar } from "@/components/ui/sidebar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { SessionState } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";

interface Props {
  session: SessionState;
}

function pickHeroAgent(session: SessionState) {
  const agents = Object.values(session.agents);
  if (agents.length === 0) return null;
  const ranked = agents.slice().sort((a, b) => statusUrgency(b.status) - statusUrgency(a.status));
  return ranked[0] ?? null;
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

export function SessionCard({ session }: Props) {
  const { state, isMobile } = useSidebar();
  const hero = pickHeroAgent(session);
  const heroKind = hero?.kind ?? "main";
  const heroState = statusToMascotState(session.status);

  if (state === "collapsed" && !isMobile) {
    return <Mascot kind={heroKind} state={heroState} size={20} />;
  }

  return (
    <>
      <Mascot kind={heroKind} state={heroState} size={44} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-medium text-sm">
            {session.cwd_basename}
          </span>
          <span className="shrink-0">
            <StatusBadge status={session.status} />
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-fg/60 text-xs">
              {session.cwd} · {elapsed(session.started_at)}
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-md break-all">
            {session.cwd}
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate font-mono text-fg/45 text-xs">{session.id.slice(0, 8)}</span>
          </TooltipTrigger>
          <TooltipContent side="right" className="break-all">
            {session.id}
          </TooltipContent>
        </Tooltip>
        {session.current_activity && (
          <span className="truncate text-fg/80 text-xs">{session.current_activity}</span>
        )}
        {session.waiting_reason && (
          <span className="truncate text-status-waiting text-xs">{session.waiting_reason}</span>
        )}
      </div>
    </>
  );
}
