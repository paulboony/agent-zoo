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

describe("reduce AskUserQuestion handling", () => {
  it("flips the agent to blocked on PreToolUse(AskUserQuestion) with the first question as waiting_reason", () => {
    const store = createStore();
    // Seed the session via SessionStart so the main agent exists.
    reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SessionStart",
        session_id: "s-aq",
        cwd: "/tmp",
        transcript_path: "",
        source: "startup",
      },
    });

    reduce(store, {
      received_at: "2026-05-15T10:00:01.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "s-aq",
        cwd: "/tmp",
        transcript_path: "",
        tool_name: "AskUserQuestion",
        tool_use_id: "toolu_q1",
        tool_input: {
          questions: [
            {
              question: "Which database should we use for persistence?",
              header: "DB choice",
              options: [
                { label: "Postgres", description: "" },
                { label: "SQLite", description: "" },
              ],
              multiSelect: false,
            },
          ],
        },
      },
    });

    const session = store.sessions.get("s-aq");
    expect(session?.status).toBe("blocked");
    expect(session?.agents.main?.status).toBe("blocked");
    expect(session?.waiting_reason).toBe("Which database should we use for persistence?");
    // tool_calls_count still bumps — it's still a tool call.
    expect(session?.agents.main?.tool_calls_count).toBe(1);
    // current_tool is set so the UI can show what's pending.
    expect(session?.agents.main?.current_tool).toBe("AskUserQuestion");
  });

  it("falls back to a sensible waiting_reason when the questions array is missing/malformed", () => {
    const store = createStore();
    reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SessionStart",
        session_id: "s-aq2",
        cwd: "/tmp",
        transcript_path: "",
        source: "startup",
      },
    });
    reduce(store, {
      received_at: "2026-05-15T10:00:01.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "s-aq2",
        cwd: "/tmp",
        transcript_path: "",
        tool_name: "AskUserQuestion",
        tool_use_id: "toolu_q2",
        tool_input: {}, // no questions
      },
    });
    const session = store.sessions.get("s-aq2");
    expect(session?.status).toBe("blocked");
    expect(session?.waiting_reason).toBe("AskUserQuestion");
  });

  it("returns to running and clears waiting_reason on PostToolUse(AskUserQuestion)", () => {
    const store = createStore();
    reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SessionStart",
        session_id: "s-aq3",
        cwd: "/tmp",
        transcript_path: "",
        source: "startup",
      },
    });
    reduce(store, {
      received_at: "2026-05-15T10:00:01.000Z",
      payload: {
        hook_event_name: "PreToolUse",
        session_id: "s-aq3",
        cwd: "/tmp",
        transcript_path: "",
        tool_name: "AskUserQuestion",
        tool_use_id: "toolu_q3",
        tool_input: {
          questions: [
            {
              question: "Ship it?",
              header: "Ship",
              options: [
                { label: "Yes", description: "" },
                { label: "No", description: "" },
              ],
              multiSelect: false,
            },
          ],
        },
      },
    });
    expect(store.sessions.get("s-aq3")?.status).toBe("blocked");

    reduce(store, {
      received_at: "2026-05-15T10:00:30.000Z",
      payload: {
        hook_event_name: "PostToolUse",
        session_id: "s-aq3",
        cwd: "/tmp",
        transcript_path: "",
        tool_name: "AskUserQuestion",
        tool_use_id: "toolu_q3",
        tool_input: {},
      },
    });
    const session = store.sessions.get("s-aq3");
    expect(session?.status).toBe("running");
    expect(session?.agents.main?.status).toBe("running");
    expect(session?.waiting_reason).toBeUndefined();
    // PostToolUse still clears current_tool the usual way.
    expect(session?.agents.main?.current_tool).toBeUndefined();
    // ...and captures it as last_tool.
    expect(session?.agents.main?.last_tool).toBe("AskUserQuestion");
  });
});

describe("reduce UserPromptSubmit handling", () => {
  function seed(sessionId: string) {
    const store = createStore();
    reduce(store, {
      received_at: "2026-05-15T10:00:00.000Z",
      payload: {
        hook_event_name: "SessionStart",
        session_id: sessionId,
        cwd: "/tmp",
        transcript_path: "",
        source: "startup",
      },
    });
    return store;
  }

  function submit(store: ReturnType<typeof createStore>, sessionId: string, prompt: string, at = "2026-05-15T10:00:01.000Z") {
    reduce(store, {
      received_at: at,
      payload: {
        hook_event_name: "UserPromptSubmit",
        session_id: sessionId,
        cwd: "/tmp",
        transcript_path: "",
        prompt,
      },
    });
  }

  it("populates last_user_prompt from the first UserPromptSubmit", () => {
    const store = seed("s-up1");
    submit(store, "s-up1", "fix the install-hooks bug");
    expect(store.sessions.get("s-up1")?.last_user_prompt).toBe("fix the install-hooks bug");
  });

  it("overwrites last_user_prompt on a subsequent UserPromptSubmit", () => {
    const store = seed("s-up2");
    submit(store, "s-up2", "first ask", "2026-05-15T10:00:01.000Z");
    submit(store, "s-up2", "second ask", "2026-05-15T10:00:02.000Z");
    expect(store.sessions.get("s-up2")?.last_user_prompt).toBe("second ask");
  });

  it("does not overwrite when the new prompt is whitespace-only", () => {
    const store = seed("s-up3");
    submit(store, "s-up3", "real ask", "2026-05-15T10:00:01.000Z");
    submit(store, "s-up3", "   \n\t ", "2026-05-15T10:00:02.000Z");
    expect(store.sessions.get("s-up3")?.last_user_prompt).toBe("real ask");
  });

  it("does not set last_user_prompt at all when the very first prompt is whitespace-only", () => {
    const store = seed("s-up3b");
    submit(store, "s-up3b", "   ");
    expect(store.sessions.get("s-up3b")?.last_user_prompt).toBeUndefined();
  });

  it("collapses internal whitespace and trims before assignment", () => {
    const store = seed("s-up4");
    submit(store, "s-up4", "  fix\nthe   install-hooks\tbug  ");
    expect(store.sessions.get("s-up4")?.last_user_prompt).toBe("fix the install-hooks bug");
  });

  it("caps last_user_prompt at 500 characters", () => {
    const store = seed("s-up5");
    const long = "x".repeat(800);
    submit(store, "s-up5", long);
    const got = store.sessions.get("s-up5")?.last_user_prompt;
    expect(got).toBeDefined();
    expect(got?.length).toBe(500);
    expect(got).toBe("x".repeat(500));
  });
});
