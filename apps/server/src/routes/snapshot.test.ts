// apps/server/src/routes/snapshot.test.ts
import type { HookEnvelope, HookEventName } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { createStore } from "../state.js";
import { snapshotRoutes } from "./snapshot.js";

function env(name: HookEventName, received_at: string, extra: Record<string, unknown> = {}): HookEnvelope {
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

describe("GET /api/activity", () => {
  it("returns buckets, interruptions, failures and permission suggestions", async () => {
    const store = createStore();
    const now = new Date().toISOString();
    store.activity.record(
      env("PreToolUse", now, { tool_name: "Bash", tool_input: { command: "git push origin main" } }),
    );
    store.activity.record(env("PermissionRequest", now));
    store.activity.record(env("PostToolUseFailure", now, { tool_name: "Bash" }));
    const app = snapshotRoutes(store);

    const res = await app.request("/activity");
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      buckets: { tool_calls: number }[];
      interruptions_24h: number;
      failures_by_tool: { tool: string; count: number; calls: number }[];
      permissions: { fixable: number; needs_you: number; suggestions: { rule: string; count: number }[] };
    };
    expect(body.buckets).toHaveLength(24);
    expect(body.buckets[23]!.tool_calls).toBe(1);
    expect(body.interruptions_24h).toBe(1);
    expect(body.failures_by_tool).toEqual([{ tool: "Bash", count: 1, calls: 1 }]);
    expect(body.permissions.fixable).toBe(1);
    expect(body.permissions.suggestions).toEqual([{ rule: "Bash(git push *)", count: 1 }]);
  });
});
