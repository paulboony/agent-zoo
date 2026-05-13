import type { AgentState, SessionState } from "@agent-zoo/shared";
import { statusUrgency } from "@agent-zoo/shared";

/**
 * Pick the "hero" agent to represent a session in compact UI (mascot,
 * status, etc.). Ranks by `statusUrgency` so the displayed agent
 * reflects the same urgency the session-level status badge shows —
 * an erroring sub-agent surfaces even when `main` is idle.
 */
export function pickHeroAgent(session: SessionState): AgentState | null {
  const agents = Object.values(session.agents);
  if (agents.length === 0) return null;
  const ranked = agents.slice().sort((a, b) => statusUrgency(b.status) - statusUrgency(a.status));
  return ranked[0] ?? null;
}
