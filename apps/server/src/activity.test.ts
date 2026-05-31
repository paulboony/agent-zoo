// apps/server/src/activity.test.ts
import type { HookEnvelope, HookEventName } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { createActivityTracker } from "./activity.js";

const HOUR_MS = 60 * 60 * 1000;

function env(
  name: HookEventName,
  received_at: string,
  extra: Record<string, unknown> = {},
): HookEnvelope {
  return {
    received_at,
    payload: {
      hook_event_name: name,
      session_id: "s1",
      cwd: "/x",
      transcript_path: "/x.jsonl",
      ...extra,
    } as unknown as HookEnvelope["payload"],
  };
}

describe("createActivityTracker", () => {
  const now = Date.parse("2026-05-30T12:30:00.000Z");
  const thisHour = "2026-05-30T12:05:00.000Z";

  it("returns 24 zero buckets and empty aggregates when empty", () => {
    const snap = createActivityTracker().snapshot(now);
    expect(snap.buckets).toHaveLength(24);
    expect(snap.buckets.every((b) => b.tool_calls === 0)).toBe(true);
    expect(snap.buckets[23]!.hour_start).toBe("2026-05-30T12:00:00.000Z");
    expect(snap.interruptions_24h).toBe(0);
    expect(snap.failures_by_tool).toEqual([]);
    expect(snap.permissions).toEqual({ fixable: 0, needs_you: 0, suggestions: [] });
  });

  it("counts PreToolUse as a tool call", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Read" }));
    expect(t.snapshot(now).buckets[23]!.tool_calls).toBe(2);
  });

  it("categorizes AskUserQuestion + elicitation as needs_you, permission prompts as fixable", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "AskUserQuestion" }));
    t.record(env("Elicitation", thisHour));
    t.record(env("Notification", thisHour, { notification_type: "elicitation_dialog" }));
    t.record(env("Notification", thisHour, { notification_type: "permission_prompt" }));
    t.record(env("PermissionRequest", thisHour));
    const snap = t.snapshot(now);
    expect(snap.permissions.fixable).toBe(2);
    expect(snap.permissions.needs_you).toBe(3);
    expect(snap.interruptions_24h).toBe(5);
  });

  it("does NOT count idle_prompt", () => {
    const t = createActivityTracker();
    t.record(env("Notification", thisHour, { notification_type: "idle_prompt" }));
    expect(t.snapshot(now).interruptions_24h).toBe(0);
  });

  it("derives a Bash(prog sub *) rule from the pending PreToolUse command", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash", tool_input: { command: "git push origin main" } }));
    t.record(env("PermissionRequest", thisHour));
    expect(t.snapshot(now).permissions.suggestions).toEqual([{ rule: "Bash(git push *)", count: 1 }]);
  });

  it("derives a single-token Bash rule and a bare tool rule for non-Bash", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash", tool_input: { command: "ls" } }));
    t.record(env("Notification", thisHour, { notification_type: "permission_prompt" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "WebFetch", tool_input: { url: "https://x" } }));
    t.record(env("PermissionRequest", thisHour));
    const rules = t.snapshot(now).permissions.suggestions.map((s) => s.rule).sort();
    expect(rules).toEqual(["Bash(ls *)", "WebFetch"]);
  });

  it("counts a prompt with no pending tool as fixable but yields no suggestion", () => {
    const t = createActivityTracker();
    t.record(env("PermissionRequest", thisHour));
    const snap = t.snapshot(now);
    expect(snap.permissions.fixable).toBe(1);
    expect(snap.permissions.suggestions).toEqual([]);
  });

  it("clears pending on PostToolUse so a later prompt has no suggestion", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash", tool_input: { command: "git push" } }));
    t.record(env("PostToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PermissionRequest", thisHour));
    expect(t.snapshot(now).permissions.suggestions).toEqual([]);
  });

  it("groups PostToolUseFailure by tool with call totals, sorted by failure rate desc", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PostToolUseFailure", thisHour, { tool_name: "Bash" }));
    t.record(env("PostToolUseFailure", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Edit" }));
    t.record(env("PostToolUseFailure", thisHour, { tool_name: "Edit" }));
    expect(t.snapshot(now).failures_by_tool).toEqual([
      { tool: "Edit", count: 1, calls: 1 },
      { tool: "Bash", count: 2, calls: 3 },
    ]);
  });

  it("prunes fixable/needs_you/suggestions older than 24h", () => {
    const t = createActivityTracker();
    const old = new Date(now - 25 * HOUR_MS).toISOString();
    t.record(env("PreToolUse", old, { tool_name: "Bash", tool_input: { command: "git push" } }));
    t.record(env("PermissionRequest", old));
    t.record(env("Elicitation", old));
    const snap = t.snapshot(now);
    expect(snap.interruptions_24h).toBe(0);
    expect(snap.permissions).toEqual({ fixable: 0, needs_you: 0, suggestions: [] });
  });
});
