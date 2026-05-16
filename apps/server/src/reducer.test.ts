import { describe, expect, it } from "vitest";
import { buildEndedSubAgent, reduce } from "./reducer.js";
import { createStore } from "./state.js";

describe("buildEndedSubAgent", () => {
  it("constructs an ended sub-agent with all optional fields populated", () => {
    const agent = buildEndedSubAgent({
      id: "a1",
      agent_type: "general-purpose",
      label: "Review the design",
      prompt: "Investigate X",
      tool_calls_count: 7,
      error_count: 1,
      model: "claude-opus-4-7",
      started_at: "2026-05-15T10:00:00.000Z",
      last_event_at: "2026-05-15T10:01:00.000Z",
      ended_at: "2026-05-15T10:01:00.000Z",
    });
    expect(agent).toEqual({
      id: "a1",
      agent_type: "general-purpose",
      label: "Review the design",
      prompt: "Investigate X",
      model: "claude-opus-4-7",
      status: "ended",
      started_at: "2026-05-15T10:00:00.000Z",
      last_event_at: "2026-05-15T10:01:00.000Z",
      ended_at: "2026-05-15T10:01:00.000Z",
      tool_calls_count: 7,
      error_count: 1,
    });
  });

  it("omits absent optional fields rather than setting them to undefined", () => {
    const agent = buildEndedSubAgent({
      id: "a2",
      agent_type: "general-purpose",
      tool_calls_count: 0,
      error_count: 0,
      started_at: "2026-05-15T10:00:00.000Z",
      last_event_at: "2026-05-15T10:00:00.000Z",
      ended_at: "2026-05-15T10:00:00.000Z",
    });
    expect(agent.label).toBeUndefined();
    expect("label" in agent).toBe(false);
    expect(agent.prompt).toBeUndefined();
    expect("prompt" in agent).toBe(false);
    expect(agent.model).toBeUndefined();
    expect("model" in agent).toBe(false);
    expect(agent.status).toBe("ended");
  });
});

describe("reduce phantom-agent guard", () => {
  it("drops a sub-agent creation event with no agent_type", () => {
    const store = createStore();
    const result = reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SubagentStop",
        session_id: "s1",
        cwd: "/tmp",
        transcript_path: "",
        agent_id: "a_phantom",
        agent_type: "",
        agent_transcript_path: "",
      },
    });

    expect(result).toBeNull();
    expect(store.sessions.has("s1")).toBe(false);
  });

  it("creates a sub-agent normally when SubagentStart carries agent_type", () => {
    const store = createStore();
    const result = reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SubagentStart",
        session_id: "s1",
        cwd: "/tmp",
        transcript_path: "",
        agent_id: "a_real",
        agent_type: "general-purpose",
        agent_transcript_path: "",
      },
    });

    expect(result).not.toBeNull();
    const agent = store.sessions.get("s1")?.agents["a_real"];
    expect(agent).toBeDefined();
    expect(agent?.agent_type).toBe("general-purpose");
  });

  it("does not drop a payload for an existing sub-agent even if agent_type is empty", () => {
    const store = createStore();
    reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SubagentStart",
        session_id: "s1",
        cwd: "/tmp",
        transcript_path: "",
        agent_id: "a_real",
        agent_type: "general-purpose",
        agent_transcript_path: "",
      },
    });
    const result = reduce(store, {
      received_at: "2026-05-15T10:01:00.000Z",
      payload: {
        hook_event_name: "SubagentStop",
        session_id: "s1",
        cwd: "/tmp",
        transcript_path: "",
        agent_id: "a_real",
        agent_type: "",
        agent_transcript_path: "",
      },
    });
    expect(result).not.toBeNull();
    expect(store.sessions.get("s1")?.agents["a_real"]?.status).toBe("ended");
  });
});
