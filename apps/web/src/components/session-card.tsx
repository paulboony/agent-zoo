import { useSidebar } from "@/components/ui/sidebar.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { resolveDisplayKind } from "@/lib/mascot-kind.js";
import { pickHeroAgent } from "@/lib/session-hero.js";
import type { SessionState } from "@agent-zoo/shared";
import { Mascot, statusToMascotState } from "./mascot.js";
import { SessionActivity } from "./session-activity.js";
import { StatusBadge } from "./status-badge.js";
import { TimeAgo } from "./time-ago.js";
import { WorktreeBadge } from "./worktree-badge.js";

interface Props {
  session: SessionState;
}

export function SessionCard({ session }: Props) {
  const { state, isMobile } = useSidebar();
  const hero = pickHeroAgent(session);
  const heroKind = hero ? resolveDisplayKind(hero) : "main";
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
          <WorktreeBadge session={session} />
          <span className="shrink-0">
            <StatusBadge status={session.status} />
          </span>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="truncate text-fg/60 text-xs">
              {session.cwd} · <TimeAgo iso={session.started_at} />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" className="max-w-md break-all">
            {session.cwd}
          </TooltipContent>
        </Tooltip>
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="truncate font-mono text-fg/45">{session.id.slice(0, 8)}</span>
            </TooltipTrigger>
            <TooltipContent side="right" className="break-all">
              {session.id}
            </TooltipContent>
          </Tooltip>
          <span className="text-fg/45">·</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-fg/60">
                active <TimeAgo iso={session.last_event_at} />
              </span>
            </TooltipTrigger>
            <TooltipContent side="right">
              Last event: {new Date(session.last_event_at).toLocaleString()}
            </TooltipContent>
          </Tooltip>
        </div>
        <SessionActivity session={session} variant="card" />
      </div>
    </>
  );
}
