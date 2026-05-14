import path from "node:path";
import type { AgentState, HookEnvelope, HookPayload, SessionState } from "@agent-zoo/shared";
import { rollupSessionStatus } from "@agent-zoo/shared";
import type { Store } from "./state.js";

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
  store: Store,
  sessionId: string,
  toolUseId: string,
  toolInput: unknown,
): void {
  const dispatch = readDispatchInput(toolInput);
  if (!dispatch) return;
  let perSession = store.pending_subagents.get(sessionId);
  if (!perSession) {
    perSession = new Map();
    store.pending_subagents.set(sessionId, perSession);
  }
  perSession.set(toolUseId, dispatch);
}

function captureAgentDispatch(store: Store, sessionId: string, toolInput: unknown): void {
  const dispatch = readDispatchInput(toolInput);
  if (!dispatch) return;
  let queue = store.pending_agent_dispatches.get(sessionId);
  if (!queue) {
    queue = [];
    store.pending_agent_dispatches.set(sessionId, queue);
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
  store: Store,
  sessionId: string,
  agentId: string,
): { description: string; prompt?: string } | undefined {
  const perSession = store.pending_subagents.get(sessionId);
  const pending = perSession?.get(agentId);
  if (pending) {
    perSession?.delete(agentId);
    return {
      description: pending.description,
      ...(pending.prompt !== undefined ? { prompt: pending.prompt } : {}),
    };
  }
  const queue = store.pending_agent_dispatches.get(sessionId);
  const head = queue?.shift();
  if (head) {
    return {
      description: head.description,
      ...(head.prompt !== undefined ? { prompt: head.prompt } : {}),
    };
  }
  return undefined;
}

export function reduce(store: Store, env: HookEnvelope): SessionState | null {
  const { payload, received_at } = env;
  if (!payload?.session_id || !payload?.hook_event_name) return null;

  const sessionId = payload.session_id;
  const existing = store.sessions.get(sessionId);
  const session: SessionState = existing
    ? { ...existing, agents: { ...existing.agents } }
    : createSession(payload, received_at);

  session.last_event_at = received_at;

  const agentId = pickAgentId(payload);
  const existingAgent = session.agents[agentId];
  let agent: AgentState;
  if (!existingAgent) {
    // Some Claude Code phantom events (stream-recovery / background
    // housekeeping) send `agent_type: ""` — treat empty string as
    // missing so the field stays absent for real comparisons.
    const rawAgentType =
      "agent_type" in payload && typeof payload.agent_type === "string"
        ? payload.agent_type
        : undefined;
    const agentType = rawAgentType ? rawAgentType : undefined;
    agent = {
      id: agentId,
      ...(agentType !== undefined ? { agent_type: agentType } : {}),
      status: "running",
      started_at: received_at,
      last_event_at: received_at,
      tool_calls_count: 0,
      error_count: 0,
    };
    // Carry the parent's Task description over to the new sub-agent. Hook
    // ordering is PreToolUse(Task) → SubagentStart, so by the time we reach
    // here the description is already in the pending buffer (if there was one).
    if (payload.hook_event_name === "SubagentStart") {
      const pending = consumePendingSubagent(store, sessionId, agentId);
      if (pending !== undefined) {
        agent.label = pending.description;
        if (pending.prompt !== undefined) agent.prompt = pending.prompt;
      }
    }
  } else {
    agent = { ...existingAgent };
  }

  agent.last_event_at = received_at;
  applyTransition(agent, session, payload);
  session.agents[agentId] = agent;

  // Stash sub-agent dispatch metadata so the eventual SubagentStart can
  // pick it up. The Task tool (Claude Code SDK) uses its tool_use_id as
  // the spawned agent's agent_id → we can correlate by id. The Agent
  // tool (Claude API) uses a Claude API tool_use_id ("toolu_XXX") that
  // does NOT match the SDK-side agent_id ("aXXX"); we queue those and
  // pop FIFO on SubagentStart instead.
  if (payload.hook_event_name === "PreToolUse") {
    if (payload.tool_name === "Task") {
      captureTaskDispatch(store, sessionId, payload.tool_use_id, payload.tool_input);
    } else if (payload.tool_name === "Agent") {
      captureAgentDispatch(store, sessionId, payload.tool_input);
    }
  }

  session.status = rollupSessionStatus(session.agents);
  if (session.status !== "waiting_for_human") {
    // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
    delete session.waiting_reason;
  }
  if (session.status === "ended") {
    session.ended_at = received_at;
  }
  if (payload.hook_event_name === "SessionEnd") {
    store.pending_subagents.delete(sessionId);
    store.pending_agent_dispatches.delete(sessionId);
  }

  store.sessions.set(sessionId, session);
  store.recent_events.push(payload);
  return session;
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
        agent.status = "waiting_for_human";
        session.waiting_reason = payload.message ?? subtype;
      }
      break;
    }

    case "PermissionRequest":
    case "Elicitation":
      agent.status = "waiting_for_human";
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
      agent.status = "idle";
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
