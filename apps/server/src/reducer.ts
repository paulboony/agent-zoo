import path from "node:path";
import type { AgentState, HookEnvelope, HookPayload, SessionState } from "@agent-zoo/shared";
import { rollupSessionStatus } from "@agent-zoo/shared";
import type { Store } from "./state.js";
import { omitUndefined } from "./util.js";

/**
 * A pending sub-agent dispatch captured between PreToolUse and
 * SubagentStart. Used internally by the reducer to thread description
 * + prompt from the parent's tool call onto the spawned sub-agent.
 */
export interface PendingSubagent {
  description: string;
  prompt?: string;
  subagent_type: string;
}

/**
 * Reducer-private correlation buffers. Owned by `reduce()`; no other
 * code path should read or write these.
 *
 *   - `pending_subagents`: Task-tool dispatches keyed by tool_use_id.
 *     Task tool uses its tool_use_id as the spawned agent's agent_id,
 *     so id-based correlation works on SubagentStart.
 *   - `pending_agent_dispatches`: FIFO queue of Agent-tool dispatches.
 *     The Agent tool's tool_use_id ("toolu_XXX") differs from the
 *     SDK-side agent_id ("aXXX"), so order-based correlation is used
 *     when the keyed lookup misses.
 */
export interface ReducerState {
  pending_subagents: Map<string, Map<string, PendingSubagent>>;
  pending_agent_dispatches: Map<string, PendingSubagent[]>;
}

export function createReducerState(): ReducerState {
  return {
    pending_subagents: new Map(),
    pending_agent_dispatches: new Map(),
  };
}

/**
 * Construct a sub-agent in the `"ended"` state from data recovered from
 * disk (backfill). The shape mirrors what the live reducer would produce
 * after SubagentStart → SubagentStop, including ended_at and the full
 * set of derived counters. Optional fields (label, prompt, model) are
 * omitted when not provided, not set to undefined.
 *
 * Used by `backfillSessionSubagents` so it doesn't have to synthesise
 * fake hook envelopes to reconstruct sub-agents.
 */
export function buildEndedSubAgent(input: {
  id: string;
  agent_type: string;
  label?: string;
  prompt?: string;
  tool_calls_count: number;
  error_count: number;
  model?: string;
  started_at: string;
  last_event_at: string;
  ended_at: string;
}): AgentState {
  return {
    id: input.id,
    agent_type: input.agent_type,
    ...omitUndefined({
      label: input.label,
      prompt: input.prompt,
      model: input.model,
    }),
    status: "ended",
    started_at: input.started_at,
    last_event_at: input.last_event_at,
    ended_at: input.ended_at,
    tool_calls_count: input.tool_calls_count,
    error_count: input.error_count,
  };
}

/**
 * Extract { description, prompt, subagent_type } from a Task/Agent
 * tool_input. Returns undefined when description is missing — without
 * a description we have nothing useful to attach to the sub-agent.
 */
function readDispatchInput(toolInput: unknown):
  | { description: string; prompt?: string; subagent_type: string }
  | undefined {
  if (!toolInput || typeof toolInput !== "object") return undefined;
  const obj = toolInput as Record<string, unknown>;
  const description = typeof obj.description === "string" ? obj.description : undefined;
  if (!description) return undefined;
  const prompt = typeof obj.prompt === "string" ? obj.prompt : undefined;
  const subagent_type = typeof obj.subagent_type === "string" ? obj.subagent_type : "";
  return {
    description,
    ...(prompt !== undefined ? { prompt } : {}),
    subagent_type,
  };
}

function captureTaskDispatch(
  reducerState: ReducerState,
  sessionId: string,
  toolUseId: string,
  toolInput: unknown,
): void {
  const dispatch = readDispatchInput(toolInput);
  if (!dispatch) return;
  let perSession = reducerState.pending_subagents.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    reducerState.pending_subagents.set(sessionId, perSession);
  }
  perSession.set(toolUseId, dispatch);
}

function captureAgentDispatch(
  reducerState: ReducerState,
  sessionId: string,
  toolInput: unknown,
): void {
  const dispatch = readDispatchInput(toolInput);
  if (!dispatch) return;
  let queue = reducerState.pending_agent_dispatches.get(sessionId);
  if (!queue) {
    queue = [];
    reducerState.pending_agent_dispatches.set(sessionId, queue);
  }
  queue.push(dispatch);
}

/**
 * Resolve a sub-agent's pending dispatch. Tries the keyed map first
 * (Task tool uses tool_use_id == agent_id, so the lookup hits), then
 * falls back to popping the FIFO queue (Agent tool uses an SDK-side
 * agent_id distinct from its API tool_use_id — order-based match).
 */
function consumePendingSubagent(
  reducerState: ReducerState,
  sessionId: string,
  agentId: string,
): { description: string; prompt?: string } | undefined {
  const perSession = reducerState.pending_subagents.get(sessionId);
  const pending = perSession?.get(agentId);
  if (pending) {
    perSession?.delete(agentId);
    return {
      description: pending.description,
      ...omitUndefined({ prompt: pending.prompt }),
    };
  }
  const queue = reducerState.pending_agent_dispatches.get(sessionId);
  const head = queue?.shift();
  if (head) {
    return {
      description: head.description,
      ...omitUndefined({ prompt: head.prompt }),
    };
  }
  return undefined;
}

export function reduce(store: Store, env: HookEnvelope): SessionState | null {
  const { payload, received_at } = env;
  if (!payload?.session_id || !payload?.hook_event_name) return null;

  const sessionId = payload.session_id;
  const existing = store.sessions.get(sessionId);

  // 1. Build a local draft of the session. Every mutation below targets
  //    this draft, never store state, so a throw mid-reduce leaves the
  //    store untouched.
  const sessionDraft: SessionState = existing
    ? { ...existing, agents: { ...existing.agents } }
    : createSession(payload, received_at);

  sessionDraft.last_event_at = received_at;

  const agentId = pickAgentId(payload);
  const existingAgent = sessionDraft.agents[agentId];

  let agent: AgentState;
  if (!existingAgent) {
    const rawAgentType =
      "agent_type" in payload && typeof payload.agent_type === "string"
        ? payload.agent_type
        : undefined;
    const agentType = rawAgentType ? rawAgentType : undefined;
    // Phantom guard: a payload that creates a NEW sub-agent (not "main")
    // but carries no agent_type is Claude Code stream-recovery /
    // background-housekeeping noise (typically a SubagentStop arriving
    // without its SubagentStart). Real sub-agents always carry
    // agent_type on SubagentStart. Drop the event silently — returning
    // null avoids touching the store or broadcasting.
    if (agentId !== "main" && agentType === undefined) {
      return null;
    }
    agent = {
      id: agentId,
      ...omitUndefined({ agent_type: agentType }),
      status: "running",
      started_at: received_at,
      last_event_at: received_at,
      tool_calls_count: 0,
      error_count: 0,
    };
    if (payload.hook_event_name === "SubagentStart") {
      const pending = consumePendingSubagent(store.reducerState, sessionId, agentId);
      if (pending !== undefined) {
        agent.label = pending.description;
        if (pending.prompt !== undefined) agent.prompt = pending.prompt;
      }
    }
  } else {
    agent = { ...existingAgent };
  }

  agent.last_event_at = received_at;
  applyTransition(agent, sessionDraft, payload);
  sessionDraft.agents[agentId] = agent;

  // 2. Reducer-private state changes: capture pending dispatches.
  //    These touch `store.reducerState`, not the session aggregate.
  if (payload.hook_event_name === "PreToolUse") {
    if (payload.tool_name === "Task") {
      captureTaskDispatch(
        store.reducerState,
        sessionId,
        payload.tool_use_id,
        payload.tool_input,
      );
    } else if (payload.tool_name === "Agent") {
      captureAgentDispatch(store.reducerState, sessionId, payload.tool_input);
    }
  }

  sessionDraft.status = rollupSessionStatus(sessionDraft.agents);
  if (sessionDraft.status !== "blocked") {
    // biome-ignore lint/performance/noDelete: local draft, never observed by subscribers
    delete sessionDraft.waiting_reason;
  }
  if (sessionDraft.status === "ended") {
    sessionDraft.ended_at = received_at;
  }

  // 3. Commit. From here down, every write is a no-throw operation.
  store.sessions.set(sessionId, sessionDraft);
  if (payload.hook_event_name === "SessionEnd") {
    store.reducerState.pending_subagents.delete(sessionId);
    store.reducerState.pending_agent_dispatches.delete(sessionId);
  }
  store.recent_events.push(payload);

  return sessionDraft;
}

function pickAgentId(payload: HookPayload): string {
  if ("agent_id" in payload && typeof payload.agent_id === "string") {
    return payload.agent_id;
  }
  return "main";
}

function createSession(payload: HookPayload, received_at: string): SessionState {
  const cwd = payload.cwd ?? "";
  const basename = cwd ? path.basename(cwd) : "(unknown)";
  return {
    id: payload.session_id,
    cwd,
    cwd_basename: basename || cwd || "(unknown)",
    started_at: received_at,
    last_event_at: received_at,
    status: "running",
    agents: {},
  };
}

function applyTransition(agent: AgentState, session: SessionState, payload: HookPayload): void {
  const event = payload.hook_event_name;

  switch (event) {
    case "SessionStart":
      agent.status = "running";
      break;

    case "SessionEnd":
      agent.status = "ended";
      agent.ended_at = session.last_event_at;
      break;

    case "PostToolUseFailure":
      agent.status = "error";
      agent.error_count += 1;
      break;

    case "StopFailure":
      agent.status = "error";
      agent.error_count += 1;
      break;

    case "Notification": {
      const subtype = payload.notification_type;
      if (
        subtype === "permission_prompt" ||
        subtype === "idle_prompt" ||
        subtype === "elicitation_dialog"
      ) {
        agent.status = "blocked";
        session.waiting_reason = payload.message ?? subtype;
      }
      break;
    }

    case "PermissionRequest":
    case "Elicitation":
      agent.status = "blocked";
      session.waiting_reason = payload.message ?? event;
      break;

    case "UserPromptSubmit":
      agent.status = "running";
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete session.waiting_reason;
      break;

    case "PreToolUse": {
      agent.status = "running";
      agent.current_tool = payload.tool_name;
      agent.tool_calls_count += 1;
      const summary = summariseToolInput(payload.tool_name, payload.tool_input);
      if (summary !== undefined) {
        agent.current_tool_input_summary = summary;
      } else {
        // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
        delete agent.current_tool_input_summary;
      }
      session.current_activity = summary ? `${payload.tool_name}: ${summary}` : payload.tool_name;
      break;
    }

    case "PostToolUse": {
      if (agent.current_tool !== undefined) {
        agent.last_tool = agent.current_tool;
      }
      if (agent.current_tool_input_summary !== undefined) {
        agent.last_tool_input_summary = agent.current_tool_input_summary;
      } else {
        // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
        delete agent.last_tool_input_summary;
      }
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete agent.current_tool;
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete agent.current_tool_input_summary;
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete session.current_activity;
      break;
    }

    case "Stop":
      agent.status = "awaiting_user";
      break;

    case "SubagentStart":
      agent.status = "running";
      break;

    case "SubagentStop":
      agent.status = "ended";
      agent.ended_at = session.last_event_at;
      break;

    default: {
      const _exhaustive: never = event;
      void _exhaustive;
    }
  }
}

function summariseToolInput(toolName: string, input: unknown): string | undefined {
  if (input === null || typeof input !== "object") return undefined;
  const obj = input as Record<string, unknown>;
  switch (toolName) {
    case "Bash": {
      const cmd = typeof obj.command === "string" ? obj.command : undefined;
      return cmd ? cmd.slice(0, 80) : undefined;
    }
    case "Edit":
    case "Write":
    case "Read": {
      const fp = typeof obj.file_path === "string" ? obj.file_path : undefined;
      return fp ? path.basename(fp) : undefined;
    }
    case "Glob":
    case "Grep":
      return typeof obj.pattern === "string" ? obj.pattern : undefined;
    case "Task":
    case "Agent": {
      const desc = typeof obj.description === "string" ? obj.description : undefined;
      return desc ? desc.slice(0, 80) : undefined;
    }
    default:
      return undefined;
  }
}
