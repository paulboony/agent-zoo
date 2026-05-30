// apps/server/src/activity.test.ts
import type { HookEnvelope, HookEventName } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { createActivityTracker } from "./activity.js";

const HOUR_MS = 60 * 60 * 1000;

/** Minimal envelope for a given event name at a given time. */
function env(name: HookEventName, received_at: string): HookEnvelope {
  return {
    received_at,
    payload: {
      hook_event_name: name,
      session_id: "s1",
      cwd: "/x",
      transcript_path: "/x.jsonl",
      // extra per-type fields are irrelevant to the tracker; cast through unknown
    } as unknown as HookEnvelope["payload"],
  };
}

describe("createActivityTracker", () => {
  const now = Date.parse("2026-05-30T12:30:00.000Z");
  const thisHour = "2026-05-30T12:05:00.000Z";

  it("returns exactly 24 zero-filled buckets when empty", () => {
    const t = createActivityTracker();
    const snap = t.snapshot(now);
    expect(snap.buckets).toHaveLength(24);
    expect(snap.buckets.every((b) => b.tool_calls === 0 && b.subagents === 0 && b.errors === 0)).toBe(
      true,
    );
    // newest bucket is the current hour
    expect(snap.buckets[23]!.hour_start).toBe("2026-05-30T12:00:00.000Z");
    expect(snap.buckets[0]!.hour_start).toBe("2026-05-29T13:00:00.000Z");
  });

  it("classifies events into the right series and hour", () => {
    const t = createActivityTracker();
    t.record(env("PreToolUse", thisHour));
    t.record(env("PreToolUse", thisHour));
    t.record(env("SubagentStart", thisHour));
    t.record(env("PostToolUseFailure", thisHour));
    t.record(env("StopFailure", thisHour));
    const current = t.snapshot(now).buckets[23];
    expect(current).toMatchObject({ tool_calls: 2, subagents: 1, errors: 2 });
  });

  it("ignores event types outside the three series", () => {
    const t = createActivityTracker();
    t.record(env("PostToolUse", thisHour));
    t.record(env("Stop", thisHour));
    t.record(env("SessionStart", thisHour));
    const current = t.snapshot(now).buckets[23];
    expect(current).toMatchObject({ tool_calls: 0, subagents: 0, errors: 0 });
  });

  it("drops events older than the 24h window", () => {
    const t = createActivityTracker();
    const old = new Date(now - 25 * HOUR_MS).toISOString();
    t.record(env("PreToolUse", old));
    const snap = t.snapshot(now);
    expect(snap.buckets.reduce((s, b) => s + b.tool_calls, 0)).toBe(0);
  });

  it("buckets an event from 3 hours ago into the right slot", () => {
    const t = createActivityTracker();
    const threeAgo = new Date(now - 3 * HOUR_MS).toISOString();
    t.record(env("PreToolUse", threeAgo));
    const snap = t.snapshot(now);
    // index 23 is current hour, so 3h ago is index 20
    expect(snap.buckets[20]!.tool_calls).toBe(1);
  });
});
