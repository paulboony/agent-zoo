import type { AgentKind, AgentState } from "@agent-zoo/shared";
import type { MascotState } from "./types.js";

/**
 * View-model for a single agent card. The default `<AgentNode>` and any
 * theme-provided `agent-card.tsx` receive the same shape, so the visual
 * can change without re-deriving anything.
 */
export interface AgentCardProps {
  /** The full agent state for this card. */
  agent: AgentState;
  /** True when this is the session's main agent (`id === "main"`). */
  isMain: boolean;
  /** Mascot kind to display (label rules → "general" fallback). */
  displayKind: AgentKind;
  /** Mascot animation state mapped from `agent.status`. */
  mascotState: MascotState;
  /** "Read" / "last: Read" / null — current-tool or last-tool label. */
  toolLabel: string | null;
  /** Summary of the tool input (file, command, pattern, …) or null. */
  toolSummary: string | null;
  /** Sizing hint from the parent — 64 in current callsites. */
  size: number;
}
