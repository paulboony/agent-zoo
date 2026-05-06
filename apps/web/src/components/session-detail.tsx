import { Badge } from "@/components/ui/badge.js";
import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { AgentState, SessionState } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { Clock, Code, Cpu } from "lucide-react";
import { useState } from "react";
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
  const toolText = toolLabel ? `${toolLabel}${showSummary ? `: ${showSummary}` : ""}` : "";

  return (
    <Card className="min-w-40 max-w-90 items-center gap-1.5 rounded-md p-3">
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
      <div className="flex flex-wrap justify-center gap-1">
        {toolLabel && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="max-w-48">
                <Code />
                <span className="truncate">{toolText}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="break-all">{toolText}</TooltipContent>
          </Tooltip>
        )}
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

function SubAgentSection({ subs }: { subs: AgentState[] }) {
  const [showEnded, setShowEnded] = useState(false);

  const active = subs
    .filter((s) => s.status !== "ended")
    .sort((a, b) => {
      const ua = statusUrgency(a.status);
      const ub = statusUrgency(b.status);
      if (ua !== ub) return ub - ua;
      return Date.parse(b.last_event_at) - Date.parse(a.last_event_at);
    });

  const ended = subs
    .filter((s) => s.status === "ended")
    .sort((a, b) => {
      const aTs = a.ended_at ?? a.last_event_at;
      const bTs = b.ended_at ?? b.last_event_at;
      return Date.parse(bTs) - Date.parse(aTs);
    });

  return (
    <div className="mt-6 w-full">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-medium text-sm">Sub-agents ({active.length})</h3>
        {ended.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowEnded((v) => !v)}>
            {showEnded ? "Hide ended" : `Show ended (${ended.length})`}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        {active.map((s) => (
          <AgentNode key={s.id} agent={s} size={48} />
        ))}
        {showEnded &&
          ended.map((s) => (
            <div key={s.id} className="opacity-50">
              <AgentNode agent={s} size={48} />
            </div>
          ))}
      </div>
    </div>
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
    <div className="flex flex-col items-center pt-4">
      <AgentNode agent={main} size={64} />
      {subs.length > 0 && <SubAgentSection subs={subs} />}
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
