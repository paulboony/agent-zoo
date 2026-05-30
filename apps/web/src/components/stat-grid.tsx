// apps/web/src/components/stat-grid.tsx
import type { ReactNode } from "react";

/** Responsive grid: 1 col (mobile) -> 2 (tablet) -> 4 (wide). */
export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}
