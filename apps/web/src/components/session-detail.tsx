import { Badge } from "@/components/ui/badge.js";
import { Card } from "@/components/ui/card.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { AgentState, SessionState } from "@agent-zoo/shared";
import { Clock, Cpu } from "lucide-react";
import { Mascot, statusToMascotState } from "./mascot.js";
import { StatusBadge } from "./status-badge.js";

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const ms = Date.now() - t;
  if (ms < 0 || ms < 5000) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function AgentNode({ agent, size }: { agent: AgentState; size: number }) {
  const showTool = agent.current_tool ?? agent.last_tool;
  const showSummary = agent.current_tool
    ? agent.current_tool_input_summary
    : agent.last_tool_input_summary;
  const toolLabel = agent.current_tool ? showTool : showTool ? `last: ${showTool}` : null;

  return (
    <Card className="min-w-40 items-center gap-1.5 rounded-md p-3">
      <Mascot kind={agent.kind} state={statusToMascotState(agent.status)} size={size} />
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm">{agent.agent_type_raw ?? agent.kind}</span>
        <StatusBadge status={agent.status} />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="max-w-32 truncate text-fg/50 text-xs">{agent.id}</span>
        </TooltipTrigger>
        <TooltipContent className="break-all">{agent.id}</TooltipContent>
      </Tooltip>
      {toolLabel && (
        <span className="max-w-40 truncate text-fg/70 text-xs">
          {toolLabel}
          {showSummary ? `: ${showSummary}` : ""}
        </span>
      )}
      <div className="flex flex-wrap justify-center gap-1">
        {agent.model && (
          <Badge variant="outline" className="max-w-40 font-mono">
            <Cpu />
            <span className="truncate">{agent.model}</span>
          </Badge>
        )}
        <Badge variant="outline">
          <Clock />
          {timeAgo(agent.last_event_at)}
        </Badge>
        <Badge variant="outline">
          {agent.tool_calls_count} {agent.tool_calls_count === 1 ? "call" : "calls"}
          {agent.error_count > 0 ? ` · ${agent.error_count} errors` : ""}
        </Badge>
      </div>
    </Card>
  );
}

function AgentTree({ agents }: { agents: AgentState[] }) {
  if (agents.length === 0) {
    return <p className="text-fg/50 text-xs">No agents reported yet.</p>;
  }
  const main = agents.find((a) => a.id === "main") ?? agents[0];
  if (!main) {
    return <p className="text-fg/50 text-xs">No agents reported yet.</p>;
  }
  const subs = agents.filter((a) => a !== main);

  return (
    <div className="flex flex-col items-center gap-0 pt-4">
      <AgentNode agent={main} size={64} />
      {subs.length > 0 && (
        <>
          <div className="h-6 w-px bg-border" />
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-6">
            {subs.map((s, i) => {
              const showLeft = i > 0;
              const showRight = i < subs.length - 1;
              return (
                <div key={s.id} className="flex flex-col items-center">
                  <div className="relative h-6 w-full">
                    {showLeft && <div className="absolute top-0 right-1/2 left-0 h-px bg-border" />}
                    {showRight && (
                      <div className="absolute top-0 right-0 left-1/2 h-px bg-border" />
                    )}
                    <div className="-translate-x-1/2 absolute top-0 left-1/2 h-6 w-px bg-border" />
                  </div>
                  <AgentNode agent={s} size={48} />
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

export function SessionDetail({ session }: { session: SessionState }) {
  const agents = Object.values(session.agents);
  return (
    <div className="flex h-full flex-col">
      <div className="p-4">
        <h2 className="font-semibold text-lg">{session.cwd_basename}</h2>
        <p className="text-fg/60 text-xs">{session.cwd}</p>
        <div className="mt-2 flex items-center gap-2">
          <StatusBadge status={session.status} />
          {session.current_activity && (
            <span className="text-fg/70 text-xs">{session.current_activity}</span>
          )}
        </div>
      </div>
      <Separator />
      <ScrollArea className="flex-1 px-4 pb-6">
        <h3 className="mt-4 font-medium text-sm">Agents</h3>
        <AgentTree agents={agents} />
      </ScrollArea>
    </div>
  );
}
