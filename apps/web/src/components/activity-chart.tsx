// apps/web/src/components/activity-chart.tsx
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart.js";
import type { ActivityBucket } from "@agent-zoo/shared";
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

const chartConfig = {
  tool_calls: { label: "Tool calls", color: "#e0883c" },
} satisfies ChartConfig;

/** Format an ISO hour-start to a short local hour label, e.g. "14:00". */
function hourLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:00`;
}

export function ActivityChart({ buckets }: { buckets: ActivityBucket[] }) {
  const hasActivity = buckets.some((b) => b.tool_calls > 0);

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3 flex items-baseline justify-between">
        <h2 className="font-semibold text-sm">Activity — last 24 hours</h2>
      </header>
      {hasActivity ? (
        <ChartContainer config={chartConfig} className="h-[180px] w-full">
          <BarChart data={buckets} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="hour_start"
              tickFormatter={hourLabel}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="tool_calls" fill="var(--color-tool_calls)" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ChartContainer>
      ) : (
        <div className="flex h-[180px] items-center justify-center text-fg/50 text-sm">
          No activity in the last 24h.
        </div>
      )}
    </section>
  );
}
