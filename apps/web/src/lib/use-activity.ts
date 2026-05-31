// apps/web/src/lib/use-activity.ts
import type { ActivityBucket, ActivityResponse, PermissionSuggestion, ToolFailureCount } from "@agent-zoo/shared";
import { useEffect, useState } from "react";

const POLL_MS = 60_000;

export interface ActivityData {
  buckets: ActivityBucket[];
  interruptions24h: number;
  failuresByTool: ToolFailureCount[];
  permissions: { fixable: number; needs_you: number; suggestions: PermissionSuggestion[] };
}

const EMPTY: ActivityData = {
  buckets: [],
  interruptions24h: 0,
  failuresByTool: [],
  permissions: { fixable: 0, needs_you: 0, suggestions: [] },
};

/**
 * Fetches GET /api/activity on mount and re-polls every 60s. Backs the
 * tool-calls chart, the Interruptions·24h card, and the Failures-by-tool
 * panel. The live cards (Active, Needs attention, Sessions done) read the
 * SSE session map and do not use this hook.
 */
export function useActivity(): ActivityData {
  const [data, setData] = useState<ActivityData>(EMPTY);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const res = await fetch("/api/activity");
        if (!res.ok) return;
        const body = (await res.json()) as ActivityResponse;
        if (cancelled) return;
        setData({
          buckets: body.buckets,
          interruptions24h: body.interruptions_24h,
          failuresByTool: body.failures_by_tool,
          permissions: body.permissions,
        });
      } catch {
        // keep last good data on failure (localhost dashboard, low stakes)
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return data;
}
