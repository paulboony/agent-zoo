// apps/server/src/activity.ts
import type { ActivityBucket, ActivityResponse, HookEnvelope } from "@agent-zoo/shared";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;

interface Counts {
  tool_calls: number;
  subagents: number;
  errors: number;
}

export interface ActivityTracker {
  /** Bump the matching hour bucket for tool-call / subagent / error events. */
  record(env: HookEnvelope): void;
  /** Roll/prune to `now` (epoch ms) and return 24 oldest→newest buckets. */
  snapshot(now: number): ActivityResponse;
}

function hourStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

export function createActivityTracker(): ActivityTracker {
  const buckets = new Map<number, Counts>();

  function bump(hourMs: number, key: keyof Counts): void {
    let c = buckets.get(hourMs);
    if (!c) {
      c = { tool_calls: 0, subagents: 0, errors: 0 };
      buckets.set(hourMs, c);
    }
    c[key] += 1;
  }

  return {
    record(env) {
      const name = env.payload.hook_event_name;
      let key: keyof Counts | null = null;
      if (name === "PreToolUse") key = "tool_calls";
      else if (name === "SubagentStart") key = "subagents";
      else if (name === "PostToolUseFailure" || name === "StopFailure") key = "errors";
      if (!key) return;
      const t = Date.parse(env.received_at);
      if (Number.isNaN(t)) return;
      bump(hourStart(t), key);
    },

    snapshot(now) {
      const currentHour = hourStart(now);
      const oldest = currentHour - (WINDOW_HOURS - 1) * HOUR_MS;
      for (const h of buckets.keys()) {
        if (h < oldest) buckets.delete(h);
      }
      const out: ActivityBucket[] = [];
      for (let i = 0; i < WINDOW_HOURS; i++) {
        const h = oldest + i * HOUR_MS;
        const c = buckets.get(h) ?? { tool_calls: 0, subagents: 0, errors: 0 };
        out.push({
          hour_start: new Date(h).toISOString(),
          tool_calls: c.tool_calls,
          subagents: c.subagents,
          errors: c.errors,
        });
      }
      return { generated_at: new Date(now).toISOString(), buckets: out };
    },
  };
}
