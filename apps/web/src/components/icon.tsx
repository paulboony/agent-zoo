import { cn } from "@/lib/cn.js";

interface Props {
  name: string;
  className?: string;
}

export function Icon({ name, className }: Props) {
  return (
    <span aria-hidden="true" className={cn("material-symbols-outlined text-[0.85em]", className)}>
      {name}
    </span>
  );
}
