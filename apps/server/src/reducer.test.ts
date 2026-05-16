import { describe, expect, it } from "vitest";
import { buildEndedSubAgent } from "./reducer.js";

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
