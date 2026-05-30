// apps/server/src/routes/snapshot.test.ts
import type { HookEnvelope, HookEventName } from "@agent-zoo/shared";
import { describe, expect, it } from "vitest";
import { createStore } from "../state.js";
import { snapshotRoutes } from "./snapshot.js";

function env(name: HookEventName, received_at: string): HookEnvelope {
  return {
    received_at,
    payload: {
      hook_event_name: name,
      session_id: "s1",
      cwd: "/x",
      transcript_path: "/x.jsonl",
    } as unknown as HookEnvelope["payload"],
  };
}

describe("GET /api/activity", () => {
  it("returns 24 buckets with recorded activity reflected", async () => {
    const store = createStore();
    store.activity.record(env("PreToolUse", new Date().toISOString()));
    const app = snapshotRoutes(store);

    const res = await app.request("/activity");
    expect(res.status).toBe(200);

    const body = (await res.json()) as { generated_at: string; buckets: { tool_calls: number }[] };
    expect(body.buckets).toHaveLength(24);
    expect(typeof body.generated_at).toBe("string");
    // the newest (current-hour) bucket should have our one tool call
    expect(body.buckets[23]!.tool_calls).toBe(1);
  });
});
