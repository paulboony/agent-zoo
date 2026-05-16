import { Mascot } from "@/components/mascot.js";
import { PromptPopover } from "@/components/prompt-popover.js";
import { useNow } from "@/hooks/use-now.js";
import type { AgentCardProps } from "@/lib-theme/agent-card-props.js";
import { formatDuration } from "@/lib/time.js";

/**
 * 8-Bit Quest agent card — NES Final Fantasy 1 menu vibe.
 *
 * Visual cues:
 *   * Flat royal-blue panel (chrome inherited from `data-slot="card"`
 *     in the theme's mascots.css — solid bg, double-line white border).
 *   * Hard 2px white horizontal rules between sections — no dotted
 *     connectors. Solid pixel typography only.
 *   * `▶` selection caret in front of the character name (classic
 *     NES menu marker).
 *   * Zero-padded LV / ERR readouts, like FF1's HP/MP numbers.
 *   * Optional dialog block for the prompt body — line-clamped, sits
 *     under another solid rule like an FF1 scene caption.
 *
 * Same data as the default card; rendered as a JRPG status pane.
 */
function Divider() {
  return <div className="my-1 border-white/80 border-t-2" />;
}

export default function FF1AgentCard(props: AgentCardProps) {
  const { agent, isMain, displayKind, mascotState, toolLabel, toolSummary, size } = props;
  const now = useNow();
  const elapsed = formatDuration(now - Date.parse(agent.last_event_at));
  const name = (agent.label ?? agent.agent_type ?? agent.id).toUpperCase();
  const kind = isMain ? "PARTY LEADER" : displayKind.toUpperCase();
  const status = agent.status.toUpperCase().replace(/_/g, " ");
  const cmd = toolLabel ? `${toolLabel}${toolSummary ? `: ${toolSummary}` : ""}` : "—";

  return (
    <div
      data-slot="card"
      data-testid="ff1-agent-card"
      className="relative flex w-full flex-col p-3 text-card-foreground"
    >
      <div className="flex items-start gap-3">
        <Mascot kind={displayKind} state={mascotState} size={size} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-bold text-sm tracking-widest uppercase">
            <span className="shrink-0">▶</span>
            <span className="min-w-0 flex-1 truncate">{name}</span>
          </div>
          <div className="truncate text-xs tracking-wider uppercase">{kind}</div>
        </div>
      </div>
      <Divider />
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs uppercase">
        <div className="truncate">
          CALLS{" "}
          <span className="font-bold">
            {String(agent.tool_calls_count).padStart(2, "0")}
          </span>
        </div>
        <div className="truncate">
          ERRORS{" "}
          <span className="font-bold">{String(agent.error_count).padStart(2, "0")}</span>
        </div>
        <div className="truncate">
          STATUS <span className="font-bold">{status}</span>
        </div>
        <div className="truncate">
          LAST <span className="font-bold">{elapsed}</span>
        </div>
      </div>
      <Divider />
      <div className="truncate text-xs uppercase">▶ {cmd}</div>
      {agent.prompt && (
        <>
          <Divider />
          <PromptPopover
            prompt={agent.prompt}
            triggerClassName="line-clamp-2 cursor-pointer text-left text-xs leading-snug transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-white"
          />
        </>
      )}
    </div>
  );
}
