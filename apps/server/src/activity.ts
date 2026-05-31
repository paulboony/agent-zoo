// apps/server/src/activity.ts
import type {
  ActivityBucket,
  ActivityResponse,
  HookEnvelope,
  ToolFailureCount,
} from "@agent-zoo/shared";

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;

interface Counts {
  tool_calls: number;
  interruptions: number;
  calls: Record<string, number>; // tool_name -> call count (failure-rate denominator)
  failures: Record<string, number>; // tool_name -> failure count
}

export interface ActivityTracker {
  /** Record a hook event into the current hour's bucket. */
  record(env: HookEnvelope): void;
  /** Roll/prune to `now` (epoch ms) and return the 24h snapshot. */
  snapshot(now: number): ActivityResponse;
}

function hourStart(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function emptyCounts(): Counts {
  return { tool_calls: 0, interruptions: 0, calls: {}, failures: {} };
}

export function createActivityTracker(): ActivityTracker {
  const buckets = new Map<number, Counts>();

  function at(hourMs: number): Counts {
    let c = buckets.get(hourMs);
    if (!c) {
      c = emptyCounts();
      buckets.set(hourMs, c);
    }
    return c;
  }

  return {
    record(env) {
      const t = Date.parse(env.received_at);
      if (Number.isNaN(t)) return;
      const p = env.payload;
      const h = hourStart(t);
      switch (p.hook_event_name) {
        case "PreToolUse": {
          const c = at(h);
          c.tool_calls += 1;
          c.calls[p.tool_name] = (c.calls[p.tool_name] ?? 0) + 1;
          if (p.tool_name === "AskUserQuestion") c.interruptions += 1;
          break;
        }
        case "Notification": {
          if (
            p.notification_type === "permission_prompt" ||
            p.notification_type === "elicitation_dialog"
          ) {
            at(h).interruptions += 1;
          }
          break;
        }
        case "PermissionRequest":
        case "Elicitation":
          at(h).interruptions += 1;
          break;
        case "PostToolUseFailure": {
          const c = at(h);
          c.failures[p.tool_name] = (c.failures[p.tool_name] ?? 0) + 1;
          break;
        }
      }
    },

    snapshot(now) {
      const currentHour = hourStart(now);
      const oldest = currentHour - (WINDOW_HOURS - 1) * HOUR_MS;
      for (const k of buckets.keys()) {
        if (k < oldest) buckets.delete(k);
      }
      const out: ActivityBucket[] = [];
      let interruptions_24h = 0;
      const failureTotals: Record<string, number> = {};
      const callTotals: Record<string, number> = {};
      for (let i = 0; i < WINDOW_HOURS; i++) {
        const h = oldest + i * HOUR_MS;
        const c = buckets.get(h);
        out.push({ hour_start: new Date(h).toISOString(), tool_calls: c?.tool_calls ?? 0 });
        if (c) {
          interruptions_24h += c.interruptions;
          for (const [tool, n] of Object.entries(c.failures)) {
            failureTotals[tool] = (failureTotals[tool] ?? 0) + n;
          }
          for (const [tool, n] of Object.entries(c.calls)) {
            callTotals[tool] = (callTotals[tool] ?? 0) + n;
          }
        }
      }
      // Rate = failures / max(calls, failures): clamps to ≤100% if a
      // failure's PreToolUse fell outside the window. Sort by rate desc,
      // then by failure count as a tiebreak.
      const rate = (f: ToolFailureCount) => f.count / Math.max(f.calls, f.count);
      const failures_by_tool: ToolFailureCount[] = Object.entries(failureTotals)
        .map(([tool, count]) => ({ tool, count, calls: callTotals[tool] ?? 0 }))
        .sort((a, b) => rate(b) - rate(a) || b.count - a.count);
      return { generated_at: new Date(now).toISOString(), buckets: out, interruptions_24h, failures_by_tool };
    },
  };
}
