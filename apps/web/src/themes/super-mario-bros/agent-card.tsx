import { Mascot } from "@/components/mascot.js";
import { PromptPopover } from "@/components/prompt-popover.js";
import { TimeAgo } from "@/components/time-ago.js";
import type { AgentCardProps } from "@/lib-theme/agent-card-props.js";
import type { ReactNode } from "react";

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
 * Below the HUD is the sky-and-ground stage: the mascot, with the agent's
 * status shown in a pixel speech bubble to its right. The body beneath
 * shows the agent name, LLM model, `?` command line, and an optional
 * prompt — wrapped in the theme's existing card chrome (2px black border +
 * 4px solid gray pixel drop-shadow) inherited via data-slot="card". The
 * agent's role (MAIN / mascot kind) is not repeated in the body — the
 * HUD's KIND field already carries it.
 */
function HudStat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col leading-tight">
      <div>{label}</div>
      <div className="truncate font-mono">{value}</div>
    </div>
  );
}

export default function SMBAgentCard(props: AgentCardProps) {
  const { agent, isMain, displayKind, mascotState, toolLabel, toolSummary, size } = props;
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
      className="relative flex h-full w-full flex-col overflow-hidden bg-card p-0 text-card-foreground"
    >
      <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 bg-black px-2 py-1.5 text-[10px] font-bold tracking-widest text-white uppercase">
        <HudStat label="KIND" value={kindLabel} />
        <HudStat label="CALLS" value={calls} />
        <HudStat label="ERRORS" value={errors} />
        <HudStat label="TIME" value={<TimeAgo iso={agent.last_event_at} />} />
      </div>
      {/* Sky-and-ground stage: the mascot stands on a brown ground strip
          whose top edge meets the bottom of its feet. The mascot is lifted
          by exactly the ground's height (mb-2.5 === h-2.5) so it rests on
          the surface rather than sinking into it. */}
      <div className="relative flex w-full items-end justify-center gap-2 overflow-hidden bg-[#5c94fc] pt-4">
        <Mascot
          kind={displayKind}
          state={mascotState}
          size={size}
          className="relative z-10 mb-2.5"
        />
        {/* Status speech bubble — square pixel bubble (the theme squares
            corners anyway) with a dark, left-pointing tail aimed at the
            mascot. White-on-sky for contrast; the rotated-square tail
            inherits the bubble's fill + border. */}
        <div className="relative z-10 mt-1 self-start whitespace-nowrap border-2 border-[#291715] bg-white px-2 py-0.5 font-bold text-[#291715] text-[10px] uppercase tracking-wide">
          {status}
          <div
            aria-hidden
            className="absolute top-1/2 -left-[5px] size-2 -translate-y-1/2 rotate-45 border-[#291715] border-b-2 border-l-2 bg-white"
          />
        </div>
        <div aria-hidden className="absolute inset-x-0 bottom-0 h-2.5 bg-[#9c5a3c]" />
      </div>
      {/* Earth section — same brown as the ground strip so it reads as one
          mass below the mascot's feet. White-based text (like the HUD) keeps
          contrast readable on the brown; dark text would only hit ~3.2:1. */}
      <div className="flex flex-1 flex-col items-start gap-2 bg-[#9c5a3c] p-3 text-white">
        <div className="w-full text-left">
          <div className="truncate font-bold text-sm">{name}</div>
          <div className="truncate text-white/70 text-[10px]">{agent.model ?? "—"}</div>
        </div>
        {cmd && (
          <div className="w-full truncate text-left text-white/90 text-xs">
            <span className="font-bold">?</span> {cmd}
          </div>
        )}
        {agent.prompt && (
          <PromptPopover
            prompt={agent.prompt}
            side="bottom"
            align="center"
            triggerClassName="line-clamp-2 w-full cursor-pointer text-left text-white/90 text-xs italic transition-colors hover:text-white focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
          />
        )}
      </div>
    </div>
  );
}
