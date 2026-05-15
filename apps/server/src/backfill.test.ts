import { describe, expect, it } from "vitest";
import { parseSubagentMeta } from "./backfill.js";

describe("parseSubagentMeta", () => {
  it("returns agentType and description from valid meta", () => {
    const result = parseSubagentMeta("a1234567", {
      agentType: "general-purpose",
      description: "Review the design",
    });
    expect(result).toEqual({
      agentType: "general-purpose",
      description: "Review the design",
    });
  });

  it("returns undefined fields when meta keys are missing", () => {
    expect(parseSubagentMeta("a1234567", {})).toEqual({});
  });

  it("ignores non-string field values", () => {
    expect(
      parseSubagentMeta("a1234567", { agentType: 123, description: null }),
    ).toEqual({});
  });

  it("returns null for non-object input", () => {
    expect(parseSubagentMeta("a1234567", null)).toBeNull();
    expect(parseSubagentMeta("a1234567", "string")).toBeNull();
    expect(parseSubagentMeta("a1234567", 42)).toBeNull();
  });
});

import { parseSubagentTranscript } from "./backfill.js";

describe("parseSubagentTranscript", () => {
  it("returns zeros for empty input", () => {
    expect(parseSubagentTranscript([])).toEqual({
      tool_calls_count: 0,
      error_count: 0,
    });
  });

  it("counts tool_use entries", () => {
    const result = parseSubagentTranscript([
      { type: "tool_use", id: "t1" },
      { type: "tool_use", id: "t2" },
      { type: "text", text: "hi" },
    ]);
    expect(result.tool_calls_count).toBe(2);
    expect(result.error_count).toBe(0);
  });

  it("counts errored tool_result entries", () => {
    const result = parseSubagentTranscript([
      { type: "tool_result", is_error: false },
      { type: "tool_result", is_error: true },
      { type: "tool_result", is_error: true },
    ]);
    expect(result.error_count).toBe(2);
    expect(result.tool_calls_count).toBe(0);
  });

  it("extracts model from an assistant entry", () => {
    const result = parseSubagentTranscript([
      { type: "user", message: { content: "hello" } },
      { type: "assistant", message: { model: "claude-opus-4-7" } },
    ]);
    expect(result.model).toBe("claude-opus-4-7");
  });

  it("extracts prompt from the first user message (string content)", () => {
    const result = parseSubagentTranscript([
      { type: "user", message: { content: "Investigate X" } },
      { type: "assistant", message: { model: "x" } },
    ]);
    expect(result.prompt).toBe("Investigate X");
  });

  it("extracts prompt from the first user message (content blocks)", () => {
    const result = parseSubagentTranscript([
      {
        type: "user",
        message: {
          content: [
            { type: "text", text: "First chunk." },
            { type: "text", text: "Second chunk." },
          ],
        },
      },
    ]);
    expect(result.prompt).toBe("First chunk.\nSecond chunk.");
  });

  it("derives earliest/latest timestamps", () => {
    const result = parseSubagentTranscript([
      { type: "user", timestamp: "2026-05-15T10:00:00.000Z" },
      { type: "assistant", timestamp: "2026-05-15T10:01:00.000Z" },
      { type: "tool_use", timestamp: "2026-05-15T10:00:30.000Z" },
    ]);
    expect(result.started_at).toBe("2026-05-15T10:00:00.000Z");
    expect(result.last_event_at).toBe("2026-05-15T10:01:00.000Z");
  });

  it("skips malformed entries without throwing", () => {
    const result = parseSubagentTranscript([
      null,
      "not an object",
      42,
      { type: "tool_use" },
    ]);
    expect(result.tool_calls_count).toBe(1);
  });
});
