import { useStore } from "@/lib/store.js";
import { useActivity } from "@/lib/use-activity.js";
import { useMemo } from "react";
import { ActivityChart } from "./activity-chart.js";
import { FailuresByTool } from "./failures-by-tool.js";
import { PermissionPrompts } from "./permission-prompts.js";
import { StatCard } from "./stat-card.js";
import { StatGrid } from "./stat-grid.js";

export function DashboardOverview() {
  const sessions = useStore((s) => s.sessions);
  const { attentionCount, activeCount, completed24h } = useMemo(() => {
    const all = Object.values(sessions);
    const attentionCount = all.filter(
      (s) => s.status === "blocked" || s.status === "error",
    ).length;
    // "Active" = live (not ended). A session is only momentarily "running"
    // (mid tool-call), so non-ended is the useful headline of how many
    // sessions are ongoing.
    const activeCount = all.filter((s) => s.status !== "ended").length;
    // "Sessions done · 24h" = sessions that ended within the last 24h.
    // ended_at isn't always set on backfilled sessions, so fall back to
    // last_event_at (which for an ended session ≈ when it ended).
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const completed24h = all.filter(
      (s) => s.status === "ended" && Date.parse(s.ended_at ?? s.last_event_at) >= dayAgo,
    ).length;
    return { attentionCount, activeCount, completed24h };
  }, [sessions]);

  const activity = useActivity();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div data-testid="dash-stats">
        <StatGrid>
          <StatCard label="Active sessions" value={activeCount} sublabel="currently open" />
          <StatCard
            label="Needs attention"
            value={attentionCount}
            sublabel="blocked or errored"
            warn={attentionCount > 0}
          />
          <StatCard label="Sessions done" value={completed24h} sublabel="ended in last 24h" />
          <StatCard
            label="Interruptions"
            value={activity.interruptions24h}
            sublabel="blocked on you · last 24h"
          />
        </StatGrid>
      </div>

      <ActivityChart buckets={activity.buckets} />

      <PermissionPrompts
        fixable={activity.permissions.fixable}
        needsYou={activity.permissions.needs_you}
        suggestions={activity.permissions.suggestions}
      />

      <FailuresByTool failures={activity.failuresByTool} />
    </div>
  );
}
