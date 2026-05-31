// apps/web/src/components/failures-by-tool.tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js";
import type { ToolFailureCount } from "@agent-zoo/shared";

const MAX = 6;

/** Failure rate as a 0–100 integer, clamped so a stray out-of-window call can't exceed 100%. */
function ratePct(f: ToolFailureCount): number {
  const denom = Math.max(f.calls, f.count);
  return denom > 0 ? Math.round((f.count / denom) * 100) : 0;
}

export function FailuresByTool({ failures }: { failures: ToolFailureCount[] }) {
  const top = failures.slice(0, MAX);

  return (
    <section data-testid="dash-failures" className="rounded-lg border border-border bg-card p-4">
      <header className="mb-3">
        <h2 className="font-semibold text-sm">Failures by tool · 24h</h2>
      </header>
      {top.length === 0 ? (
        <div className="py-6 text-center text-fg/50 text-sm">No tool failures in the last 24h.</div>
      ) : (
        <ul className="flex flex-col gap-2">
          {top.map((f) => {
            const pct = ratePct(f);
            return (
              <li key={f.tool} className="flex items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="w-36 shrink-0 truncate font-mono text-fg/80 text-xs">
                      {f.tool}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="break-all font-mono">
                    {f.tool}
                  </TooltipContent>
                </Tooltip>
                <div className="relative h-4 flex-1 overflow-hidden rounded bg-muted/40">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-[#d9534f]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="w-20 shrink-0 text-right text-fg/70 text-xs tabular-nums">
                  {f.count}/{f.calls} · {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
