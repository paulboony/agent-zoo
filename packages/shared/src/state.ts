export type AgentStatus = "running" | "waiting_for_human" | "idle" | "ended" | "error";

export type SessionStatus = AgentStatus;

export type AgentKind = "main" | "code-reviewer" | "explorer" | "writer" | "coder" | "general";

export interface AgentState {
  /** SubAgentFields.agent_id from SubagentStart/Stop; "main" for the parent agent. */
  id: string;
  /** `agent_type` from SubAgentFields (e.g. "general-purpose", "code-reviewer"). */
  agent_type?: string;
  /** Human description from the parent's Task tool invocation (`tool_input.description`). */
  label?: string;
  /** Full prompt body from the parent's Task tool invocation (`tool_input.prompt`). */
  prompt?: string;
  /** Current state — derived from the most recent transition event for this agent. */
  status: AgentStatus;
  /** Tool name from the latest PreToolUse; cleared on PostToolUse. */
  current_tool?: string;
  /** Summary of `tool_input` from PreToolUse (see `summariseToolInput`). */
  current_tool_input_summary?: string;
  /** Previous `current_tool` value, captured at PostToolUse. */
  last_tool?: string;
  /** Previous `current_tool_input_summary` value, captured at PostToolUse. */
  last_tool_input_summary?: string;
  /** LLM model name, extracted from JSONL `message.model` during backfill. */
  model?: string;
  /** `received_at` when the agent was first seen. */
  started_at: string;
  /** `received_at` of the most recent payload for this agent. */
  last_event_at: string;
  /** `received_at` when the agent transitioned to ended (SessionEnd / SubagentStop). */
  ended_at?: string;
  /** Incremented on each PreToolUse for this agent. */
  tool_calls_count: number;
  /** Incremented on PostToolUseFailure / StopFailure. */
  error_count: number;
}

export interface SessionState {
  /** `session_id` from every payload. */
  id: string;
  /** `cwd` from every payload. */
  cwd: string;
  /** Last path segment of `cwd` (computed by the reducer). */
  cwd_basename: string;
  /** `received_at` when the session was first seen. */
  started_at: string;
  /** `received_at` when the session ended. */
  ended_at?: string;
  /** Rolled up from the agent map by `rollupSessionStatus`. */
  status: SessionStatus;
  /** Current PreToolUse activity summary (cleared on PostToolUse). */
  current_activity?: string;
  /** `message` from Notification / PermissionRequest / Elicitation while waiting. */
  waiting_reason?: string;
  /** `received_at` of the most recent payload for this session. */
  last_event_at: string;
  /** Per-agent state, keyed by `agent.id`. */
  agents: Record<string, AgentState>;
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
