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
    const t = createActivityTracker();
    const snap = t.snapshot(now);
    expect(snap.buckets).toHaveLength(24);
    expect(snap.buckets.every((b) => b.tool_calls === 0)).toBe(true);
    expect(snap.buckets[23]!.hour_start).toBe("2026-05-30T12:00:00.000Z");
    expect(snap.interruptions_24h).toBe(0);
    expect(snap.failures_by_tool).toEqual([]);
  });

  it("counts PreToolUse as a tool call", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Read" }));
    expect(t.snapshot(now).buckets[23]!.tool_calls).toBe(2);
  });

  it("counts AskUserQuestion as BOTH a tool call and an interruption", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour, { tool_name: "AskUserQuestion" }));
    const snap = t.snapshot(now);
    expect(snap.buckets[23]!.tool_calls).toBe(1);
    expect(snap.interruptions_24h).toBe(1);
  });

  it("counts permission/elicitation notifications, PermissionRequest, Elicitation as interruptions", () => {
    const t = createActivityTracker();
    t.record(env("Notification", thisHour, { notification_type: "permission_prompt" }));
    t.record(env("Notification", thisHour, { notification_type: "elicitation_dialog" }));
    t.record(env("PermissionRequest", thisHour));
    t.record(env("Elicitation", thisHour));
    expect(t.snapshot(now).interruptions_24h).toBe(4);
  });

  it("does NOT count idle_prompt as an interruption", () => {
    const t = createActivityTracker();
    t.record(env("Notification", thisHour, { notification_type: "idle_prompt" }));
    expect(t.snapshot(now).interruptions_24h).toBe(0);
  });

  it("groups PostToolUseFailure by tool with call totals, sorted by failure rate desc", () => {
    const t = createActivityTracker();
    // Bash: 3 calls, 2 fail (67%). Edit: 1 call, 1 fails (100%).
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Bash" }));
    t.record(env("PostToolUseFailure", thisHour, { tool_name: "Bash" }));
    t.record(env("PostToolUseFailure", thisHour, { tool_name: "Bash" }));
    t.record(env("PreToolUse", thisHour, { tool_name: "Edit" }));
    t.record(env("PostToolUseFailure", thisHour, { tool_name: "Edit" }));
    // Edit (100%) sorts before Bash (67%) despite fewer failures.
    expect(t.snapshot(now).failures_by_tool).toEqual([
      { tool: "Edit", count: 1, calls: 1 },
      { tool: "Bash", count: 2, calls: 3 },
    ]);
  });

  it("prunes interruptions and failures older than 24h", () => {
    const t = createActivityTracker();
    const old = new Date(now - 25 * HOUR_MS).toISOString();
    t.record(env("Elicitation", old));
    t.record(env("PostToolUseFailure", old, { tool_name: "Bash" }));
    const snap = t.snapshot(now);
    expect(snap.interruptions_24h).toBe(0);
    expect(snap.failures_by_tool).toEqual([]);
  });

  it("buckets a tool call from 3 hours ago into the right slot", () => {
    const t = createActivityTracker();
    const threeAgo = new Date(now - 3 * HOUR_MS).toISOString();
    t.record(env("PreToolUse", threeAgo, { tool_name: "Bash" }));
    expect(t.snapshot(now).buckets[20]!.tool_calls).toBe(1);
  });
});
