// apps/web/src/components/stat-card.tsx
import { cn } from "@/lib/cn";

interface Props {
  label: string;
  value: number | string;
  sublabel: string;
  /** Render the number in the attention/amber colour. */
  warn?: boolean;
}

export function StatCard({ label, value, sublabel, warn = false }: Props) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="mb-1.5 font-medium text-fg/60 text-xs uppercase tracking-wide">{label}</p>
      <div className={cn("font-bold text-3xl leading-none", warn && "text-[#e0883c]")}>
        {value}
      </div>
      <p className="mt-2 text-fg/50 text-xs">{sublabel}</p>
    </div>
  );
}
