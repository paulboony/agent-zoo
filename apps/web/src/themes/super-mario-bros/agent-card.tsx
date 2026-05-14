import { Mascot } from "@/components/mascot.js";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js";
import { useNow } from "@/hooks/use-now.js";
import type { AgentCardProps } from "@/lib-theme/agent-card-props.js";
import { formatDuration } from "@/lib/time.js";

/**
 * Super Mario Bros. agent card — SMB1 HUD vibe with honest labels.
 *
 * The top strip mirrors NES SMB1's iconic black status bar styling
 * (black band, white tracking-widest uppercase pixel text, monospace
 * numerals) but uses literal field labels so the values are
 * self-explanatory:
 *
 *   KIND · CALLS · ERRORS · TIME
 *
 * CALLS is zero-padded to six digits like SMB1's score, ERRORS to
 * two like the coin counter, KIND is the resolved mascot kind (or
 * "MAIN" for the session's main agent), TIME is the elapsed
 * since-last-event readout.
 *
 * Below the HUD, the body shows the mascot, agent name, agent_type,
 * status, `?` command line, and an optional prompt — wrapped in the
 * theme's existing card chrome (2px black border + 4px solid gray
 * pixel drop-shadow) inherited via data-slot="card".
 */
function HudStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col leading-tight">
      <div>{label}</div>
      <div className="truncate font-mono">{value}</div>
    </div>
  );
}

export default function SMBAgentCard(props: AgentCardProps) {
  const { agent, isMain, displayKind, mascotState, toolLabel, toolSummary, size } = props;
  const now = useNow();
  const elapsed = formatDuration(now - Date.parse(agent.last_event_at));
  const name = agent.label ?? agent.agent_type ?? agent.id;
  const calls = String(agent.tool_calls_count).padStart(6, "0");
  const errors = String(agent.error_count).padStart(2, "0");
  const kindLabel = isMain ? "MAIN" : displayKind.toUpperCase();
  const status = agent.status.toUpperCase().replace(/_/g, " ");
  const cmd = toolLabel ? `${toolLabel}${toolSummary ? `: ${toolSummary}` : ""}` : null;

  return (
    <div
      data-slot="card"
      data-testid="smb-agent-card"
      className="relative flex w-full flex-col overflow-hidden bg-card p-0 text-card-foreground"
    >
      <div className="grid grid-cols-4 gap-2 bg-black px-2 py-1.5 text-[10px] font-bold tracking-widest text-white uppercase">
        <HudStat label="KIND" value={kindLabel} />
        <HudStat label="CALLS" value={calls} />
        <HudStat label="ERRORS" value={errors} />
        <HudStat label="TIME" value={elapsed} />
      </div>
      <div className="flex flex-col items-center gap-2 p-3">
        <Mascot kind={displayKind} state={mascotState} size={size} />
        <div className="text-center">
          <div className="font-bold text-sm">{name}</div>
          {agent.label && agent.agent_type && (
            <div className="text-fg/60 text-xs">{agent.agent_type}</div>
          )}
        </div>
        <div className="text-fg/70 text-xs">
          Status: <span className="font-bold">{status}</span>
        </div>
        {cmd && (
          <div className="w-full truncate text-center text-fg/70 text-xs">
            <span className="font-bold">?</span> {cmd}
          </div>
        )}
        {agent.prompt && (
          <Popover>
            <PopoverTrigger asChild>
              <p className="line-clamp-2 w-full cursor-pointer whitespace-pre-wrap break-words text-center text-fg/60 text-xs italic transition-colors hover:text-fg/80 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring">
                {agent.prompt}
              </p>
            </PopoverTrigger>
            <PopoverContent
              side="bottom"
              align="center"
              className="max-h-[60vh] w-md max-w-[90vw] overflow-y-auto whitespace-pre-wrap break-words p-3 text-sm"
            >
              {agent.prompt}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
