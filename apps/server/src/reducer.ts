import path from "node:path";
import type { AgentState, HookEnvelope, HookPayload, SessionState } from "@agent-zoo/shared";
import { resolveAgentKind, rollupSessionStatus } from "@agent-zoo/shared";
import type { Store } from "./state.js";

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
    const agentTypeRaw =
      "agent_type" in payload && typeof payload.agent_type === "string"
        ? payload.agent_type
        : undefined;
    agent = {
      id: agentId,
      kind: agentId === "main" ? "main" : resolveAgentKind(agentTypeRaw),
      ...(agentTypeRaw !== undefined ? { agent_type_raw: agentTypeRaw } : {}),
      status: "running",
      started_at: received_at,
    };
  } else {
    agent = { ...existingAgent };
  }

  applyTransition(agent, session, payload);
  session.agents[agentId] = agent;

  session.status = rollupSessionStatus(session.agents);
  if (session.status !== "waiting_for_human") {
    // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
    delete session.waiting_reason;
  }
  if (session.status === "ended") {
    session.ended_at = received_at;
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
    case "StopFailure":
      agent.status = "error";
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

    case "PostToolUse":
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete agent.current_tool;
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete agent.current_tool_input_summary;
      // biome-ignore lint/performance/noDelete: required by exactOptionalPropertyTypes
      delete session.current_activity;
      break;

    case "Stop":
      agent.status = "idle";
      break;

    case "SubagentStart":
      agent.status = "running";
      break;

    case "SubagentStop":
      agent.status = "idle";
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
    default:
      return undefined;
  }
}
