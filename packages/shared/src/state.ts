export type AgentStatus = "running" | "waiting_for_human" | "idle" | "ended" | "error";

export type SessionStatus = AgentStatus;

export type AgentKind = "main" | "code-reviewer" | "explorer" | "writer" | "general";

export interface AgentState {
  id: string;
  kind: AgentKind;
  agent_type_raw?: string;
  status: AgentStatus;
  current_tool?: string;
  current_tool_input_summary?: string;
  started_at: string;
  ended_at?: string;
}

export interface SessionState {
  id: string;
  cwd: string;
  cwd_basename: string;
  started_at: string;
  ended_at?: string;
  status: SessionStatus;
  current_activity?: string;
  waiting_reason?: string;
  last_event_at: string;
  agents: Record<string, AgentState>;
}

const AGENT_KIND_MAP: Record<string, AgentKind> = {
  "code-reviewer": "code-reviewer",
  Explore: "explorer",
  explorer: "explorer",
  writer: "writer",
  "doc-writer": "writer",
};

export function resolveAgentKind(agentType: string | undefined): AgentKind {
  if (!agentType) return "main";
  return AGENT_KIND_MAP[agentType] ?? "general";
}

const STATUS_RANK: Record<SessionStatus, number> = {
  error: 4,
  waiting_for_human: 3,
  running: 2,
  idle: 1,
  ended: 0,
};

export function rollupSessionStatus(agents: Record<string, AgentState>): SessionStatus {
  let best: SessionStatus = "idle";
  let bestRank = -1;
  for (const a of Object.values(agents)) {
    const r = STATUS_RANK[a.status];
    if (r > bestRank) {
      best = a.status;
      bestRank = r;
    }
  }
  return best;
}

export function statusUrgency(status: SessionStatus): number {
  return STATUS_RANK[status];
}
