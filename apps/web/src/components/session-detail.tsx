import { Button } from "@/components/ui/button.js";
import { Card } from "@/components/ui/card.js";
import { ScrollArea } from "@/components/ui/scroll-area.js";
import { Separator } from "@/components/ui/separator.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import { useNow } from "@/hooks/use-now.js";
import { resolveDisplayKind } from "@/lib/mascot-kind.js";
import { useActiveTheme } from "@/lib-theme/context.js";
import { formatDuration } from "@/lib/time.js";
import type { AgentState, AgentStatus, SessionState } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";
import { useState } from "react";
import type { AgentCardProps } from "@/lib-theme/agent-card-props.js";
import { Mascot, statusToMascotState } from "./mascot.js";
import { PromptPopover } from "./prompt-popover.js";
import { StatusBadge } from "./status-badge.js";

/**
 * Per-status visual info for the agent card:
 *  - `glyph`: shape varies so the status reads without colour.
 *  - `varName`: suffix for the matching `--status-<x>` CSS variable
 *    (`blocked` → `waiting`, because the token is `--status-waiting`).
 */
const STATUS_INFO: Record<AgentStatus, { glyph: string; varName: string }> = {
  running: { glyph: "●", varName: "running" },
  blocked: { glyph: "◐", varName: "waiting" },
  awaiting_user: { glyph: "○", varName: "idle" },
  stale: { glyph: "◌", varName: "stale" },
  error: { glyph: "✗", varName: "error" },
  ended: { glyph: "⊘", varName: "ended" },
};

function timeAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return formatDuration(now - t, { suffix: " ago", justNowMs: 5000 });
}

function buildAgentCardProps(agent: AgentState, size: number): AgentCardProps {
  const showTool = agent.current_tool ?? agent.last_tool;
  const toolLabel = agent.current_tool
    ? showTool ?? null
    : showTool
      ? `last: ${showTool}`
      : null;
  const toolSummary = agent.current_tool
    ? agent.current_tool_input_summary ?? null
    : agent.last_tool_input_summary ?? null;
  return {
    agent,
    isMain: agent.id === "main",
    displayKind: resolveDisplayKind(agent),
    mascotState: statusToMascotState(agent.status),
    toolLabel,
    toolSummary,
    size,
  };
}

function AgentNode({ agent, size }: { agent: AgentState; size: number }) {
  const theme = useActiveTheme();
  const props = buildAgentCardProps(agent, size);
  const Custom = theme.agentCard;
  return Custom ? <Custom {...props} /> : <DefaultAgentCard {...props} />;
}

function DefaultAgentCard({
  agent,
  displayKind,
  mascotState,
  toolLabel,
  toolSummary,
}: AgentCardProps) {
  const now = useNow();
  const name = agent.label ?? agent.agent_type ?? agent.id;
  const showId = agent.id !== "main";
  const toolCall = toolLabel ? `${toolLabel}(${toolSummary ?? ""})` : null;
  const statusInfo = STATUS_INFO[agent.status];

  const statParts: string[] = [];
  statParts.push(
    `${agent.tool_calls_count} ${agent.tool_calls_count === 1 ? "call" : "calls"}`,
  );
  if (agent.error_count > 0) {
    statParts.push(
      `${agent.error_count} ${agent.error_count === 1 ? "error" : "errors"}`,
    );
  }
  if (agent.model) statParts.push(agent.model);
  statParts.push(timeAgo(agent.last_event_at, now));
  const stats = statParts.join(" · ");

  return (
    <Card className="flex h-full w-full flex-row items-start gap-3 rounded-md px-3 py-2.5">
      <Mascot kind={displayKind} state={mascotState} size={40} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="shrink-0 leading-none"
                style={{ color: `var(--status-${statusInfo.varName})` }}
                role="img"
                aria-label={agent.status}
              >
                {statusInfo.glyph}
              </span>
            </TooltipTrigger>
            <TooltipContent>{agent.status}</TooltipContent>
          </Tooltip>
          <span className="min-w-0 flex-1 truncate font-medium text-sm">{name}</span>
        </div>
        {(agent.agent_type || showId) && (
          <div className="flex min-w-0 items-baseline gap-1 text-fg/50 text-xs">
            {agent.agent_type && <span className="truncate">{agent.agent_type}</span>}
            {agent.agent_type && showId && <span className="shrink-0">·</span>}
            {showId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block max-w-[12ch] truncate font-mono">{agent.id}</span>
                </TooltipTrigger>
                <TooltipContent className="break-all">{agent.id}</TooltipContent>
              </Tooltip>
            )}
          </div>
        )}
        {toolCall && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="block truncate font-mono text-fg/80 text-xs">
                {toolCall}
              </span>
            </TooltipTrigger>
            <TooltipContent className="break-all">{toolCall}</TooltipContent>
          </Tooltip>
        )}
        {agent.prompt && (
          <PromptPopover
            prompt={agent.prompt}
            prefix="›"
            triggerClassName="line-clamp-2 cursor-pointer text-left text-fg/60 text-xs italic transition-colors hover:text-fg/80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
        )}
        <div className="truncate font-mono text-fg/50 text-xs">{stats}</div>
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
      <div className="grid w-full gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(18rem,100%),1fr))]">
        {active.map((s) => (
          <AgentNode key={s.id} agent={s} size={64} />
        ))}
        {showEnded &&
          ended.map((s) => (
            <div key={s.id} className="h-full opacity-50">
              <AgentNode agent={s} size={64} />
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
      <div className="w-full max-w-md">
        <AgentNode agent={main} size={64} />
      </div>
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
