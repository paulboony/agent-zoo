// apps/web/src/lib/use-activity.ts
import type { ActivityBucket, ActivityResponse } from "@agent-zoo/shared";
import { useEffect, useState } from "react";

const POLL_MS = 60_000;

export interface ActivityData {
  buckets: ActivityBucket[];
  errors24h: number;
}

const EMPTY: ActivityData = { buckets: [], errors24h: 0 };

/**
 * Fetches GET /api/activity on mount and re-polls every 60s. Backs the
 * chart (buckets) and the Errors·24h card (errors24h). The live cards
 * (active / needs-attention) and Sessions-done·24h do NOT use this hook
 * — they read the SSE session map and update instantly.
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
        const errors24h = body.buckets.reduce((s, b) => s + b.errors, 0);
        setData({ buckets: body.buckets, errors24h });
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
