import { Mascot } from "@/components/mascot.js";
import { useNow } from "@/hooks/use-now.js";
import type { AgentCardProps } from "@/lib-theme/agent-card-props.js";
import { formatDuration } from "@/lib/time.js";

/**
 * Final Fantasy V agent card — battle-menu vibe.
 *
 * Visually proves the `theme.agentCard` hook: the navy + double-white
 * border chrome comes from the theme's existing `mascots.css` rule on
 * `[data-slot="card"]`, and this component layers a JRPG status-menu
 * layout on top — ALL CAPS character header, gold stat labels with
 * dotted-line connectors, JetBrains Mono throughout.
 *
 * Same data as the default card, different rendering.
 */
function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-xs">
      <span className="shrink-0 font-semibold tracking-wider text-[#e9c349] uppercase">
        {label}
      </span>
      <span className="min-w-0 flex-1 border-white/30 border-b border-dotted" />
      <span className="min-w-0 shrink truncate">{value}</span>
    </div>
  );
}

export default function FFAgentCard(props: AgentCardProps) {
  const { agent, isMain, displayKind, mascotState, toolLabel, toolSummary, size } = props;
  const now = useNow();
  const elapsed = formatDuration(now - Date.parse(agent.last_event_at));
  const name = (agent.label ?? agent.agent_type ?? agent.id).toUpperCase();
  const cmd = toolLabel ? `${toolLabel}${toolSummary ? `: ${toolSummary}` : ""}` : "—";
  const status = agent.status.toUpperCase().replace(/_/g, " ");
  const callsValue = `${agent.tool_calls_count}${agent.error_count > 0 ? ` · ${agent.error_count} ERR` : ""}`;

  return (
    <div
      data-slot="card"
      data-testid="ff-agent-card"
      className="relative flex w-full flex-col gap-2 p-3 font-mono text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <Mascot kind={displayKind} state={mascotState} size={size} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold text-sm uppercase tracking-widest">{name}</div>
          <div className="truncate text-[#bfc2ff] text-xs uppercase tracking-wider">
            {isMain ? "PARTY LEADER" : `JOB · ${displayKind.toUpperCase()}`}
          </div>
        </div>
      </div>
      <div className="mt-1 flex flex-col gap-1 border-white/20 border-t pt-2">
        <StatRow label="Status" value={status} />
        <StatRow label="Cmd" value={cmd} />
        <StatRow label="Calls" value={callsValue} />
        <StatRow label="Last" value={elapsed} />
      </div>
    </div>
  );
}
